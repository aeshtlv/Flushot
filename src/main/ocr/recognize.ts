/**
 * Turning the captured picture into text.
 *
 * Three things decide the accuracy, and all of them are handled here: how large the
 * glyphs are when the engine sees them, which language the engine was trained for,
 * and how many independent readings of the same line are compared. The picture is
 * cropped out of the card (never the frame or the shadow), a region can be cut out
 * of it, it is enlarged when that measurably helps, every installed engine reads it
 * three times — at the chosen size, at two thirds of it, and once more with the pixels
 * reduced to black and white — and `merge.ts` combines the readings. Word boxes are
 * mapped back to picture coordinates so the caller never has to know about any of it.
 */
import { randomUUID } from 'node:crypto'
import { unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import type { FrameLayout } from '../imaging/layout'
import type { Raster } from '../imaging/raster'
import type { OcrOutcome } from '../../shared/types'
import { mergeReadings, type MergedReading, type OcrBox } from './merge'
import { ocrLanguages, recognizeRaw, type OcrRawResult } from './worker'
import type { OcrLine } from '../../shared/types'

/**
 * How much to enlarge before recognition.
 *
 * The engine is trained on photographs of text, and small glyphs are simply too
 * few pixels wide. Measured on this machine (`.tmp/ocr-bench*.cjs`) as character
 * error rate against known text, at the size the rule picks for each case:
 *
 * | picture      | 1×    | 1.5×  | 2×    | 3×    |
 * |--------------|-------|-------|-------|-------|
 * | 640 × 140    | 3.0 % |       | 1.0 % | 0.0 % |
 * | 900 × 260    | 2.3 % |       | 0.8 % | 0.0 % |
 * | 1920 × 1080  | 2.3 % |       | 0.8 % | 0.8 % |
 * | 2560 × 1440  | 2.3 % |       | 0.8 % | 0.8 % |
 * | 3840 × 2160  | 2.3 % | 0.8 % | 0.0 % (3.4 s) | |
 *
 * So enlargement helps almost everywhere — the old rule left anything above
 * 1200 px at 1× and cost a third of the characters — but it stops paying above
 * roughly twenty megapixels: a 4K picture at 2× is 33 MP and takes 3.4 s, while
 * 1.5× gives the same reading in one second.
 *
 * Hence: three times for a small picture, twice for a medium one, one and a half
 * for a large one, and never more pixels than the engine handles comfortably.
 */
const SMALL_MP = 1
const MEDIUM_MP = 5
const LARGE_SCALE = 1.5
/** Above this the engine slows down faster than its accuracy improves. */
const MAX_OUTPUT_MP = 20
/** `OcrEngine.MaxImageDimension` on Windows 10 and 11. */
const MAX_ENGINE_SIDE = 10_000
/** At most this many engines, so five language packs cannot make one click take 4 s. */
const MAX_ENGINES = 3

export function ocrScale(width: number, height: number): number {
  const megapixels = (width * height) / 1e6
  if (!(megapixels > 0)) return 1

  const wanted = megapixels < SMALL_MP ? 3 : megapixels < MEDIUM_MP ? 2 : LARGE_SCALE
  const sideFits = Math.floor(MAX_ENGINE_SIDE / Math.max(width, height))
  const pixelsFit = Math.sqrt(MAX_OUTPUT_MP / megapixels)
  return Math.max(1, Math.min(wanted, Math.max(1, sideFits), pixelsFit))
}

/** A rectangle of the picture to recognize, in picture pixels. */
export type OcrRegion = OcrBox

/**
 * One preparation of the picture: how much to enlarge it and how to resample.
 *
 * Two readings of the same line are only worth comparing if they are genuinely
 * different, so the second one changes both the size and the resampling kernel. A
 * different kernel puts different grey values on every edge, and the engine's
 * confusions are decided at the edges — that is why `Iines` in one reading is
 * `lines` in the other.
 */
export interface OcrVariant {
  /** Short name, used to tell two readings by the same engine apart. */
  name: string
  /** Enlargement relative to the picture. */
  scale: number
  /** Resampling kernel for the enlargement. */
  kernel: 'lanczos3' | 'lanczos2' | 'mitchell' | 'cubic' | 'nearest'
  /**
   * Extra treatment of the pixels before the engine sees them.
   *
   * The engine is trained on photographs, where ink is darker than paper but both
   * vary; a screenshot is flat white and flat black with two-pixel antialiased edges.
   * Whether that difference helps or hurts is a question for measurement, so this is
   * a knob rather than a decision baked into the pipeline.
   */
  preprocess?: 'grayscale' | 'sharpen' | 'gray+sharpen' | 'threshold'
}

/**
 * Which preparations to read, for a picture of this size.
 *
 * Three readings, and each one was chosen by measuring rather than by taste. On the
 * realistic page set (four text sizes, twenty lines of Russian, English, mixed and code)
 * the mean character error rate over four sizes is:
 *
 *   one reading at the chosen scale                      3.50 %
 *   plus a second at two thirds with a different kernel  3.35 %
 *   plus a hard-thresholded copy of the first            3.22 %
 *
 * The second reading sits at two thirds, not half: the first rule already picked the
 * size where the engine does best, so the second is meant to be close enough to still be
 * readable and far enough to fail differently. Going further away reads worse than the
 * first reading and only adds noise to the vote.
 *
 * The third is the same enlargement as the first with the pixels reduced to pure black
 * and white. It is the only preparation that helps at the smallest size — 12 px text
 * goes from 4.1 % to 3.3 % — which makes sense: thresholding removes the antialiased
 * grey that a two-pixel-wide stroke is entirely made of, and grey edges are where
 * `Iines`/`lines` and `O`/`0` are decided.
 *
 * Grayscale alone and sharpening were measured too and made things worse (4.08 % and
 * 5.11 %), so they are not here.
 *
 * Variants are dropped when they would coincide with one already planned — a picture the
 * engine already sees at 1× has nothing smaller to offer — and the second never falls
 * below 1×, where detail would be thrown away.
 */
export function planVariants(width: number, height: number): OcrVariant[] {
  const base = ocrScale(width, height)
  const variants: OcrVariant[] = [{ name: 'base', scale: base, kernel: 'lanczos3' }]

  const finer = Math.max(1, Math.round(base * (2 / 3) * 4) / 4)
  if (finer >= 1 && Math.abs(finer - base) > 0.01) {
    variants.push({ name: 'finer', scale: finer, kernel: 'mitchell' })
  }
  variants.push({ name: 'threshold', scale: base, kernel: 'lanczos3', preprocess: 'threshold' })
  return variants
}

/**
 * Crop the picture out of the finished card and recognize it.
 *
 * A temporary file is the only way in: the engine takes a path. It is written to
 * the system temp folder with a random name and removed in a `finally`, so a
 * failure never leaves the user's screen lying around on disk.
 *
 * `region` narrows the work to a part of the picture — that is the "select a
 * fragment, get its text" gesture — and the word boxes are still reported in the
 * coordinates of the whole picture, so nothing downstream has to care.
 *
 * `plan` exists for the benchmark, which has to compare preparations; the shipping
 * caller leaves it out and gets `planVariants`.
 */
export async function recognizeCardPicture(
  raster: Raster,
  layout: FrameLayout,
  region?: OcrRegion,
  plan?: OcrVariant[]
): Promise<OcrOutcome> {
  const pictureLeft = Math.max(0, Math.min(raster.width - 1, Math.round(layout.x)))
  const pictureTop = Math.max(0, Math.min(raster.height - 1, Math.round(layout.y)))
  const pictureWidth = Math.max(1, Math.min(raster.width - pictureLeft, Math.round(layout.width)))
  const pictureHeight = Math.max(1, Math.min(raster.height - pictureTop, Math.round(layout.height)))

  const left = pictureLeft + clamp(Math.round(region?.x ?? 0), 0, pictureWidth - 1)
  const top = pictureTop + clamp(Math.round(region?.y ?? 0), 0, pictureHeight - 1)
  const width = Math.max(
    1,
    Math.min(pictureLeft + pictureWidth - left, Math.round(region?.width ?? pictureWidth))
  )
  const height = Math.max(
    1,
    Math.min(pictureTop + pictureHeight - top, Math.round(region?.height ?? pictureHeight))
  )

  const variants = plan ?? planVariants(width, height)
  const offsetX = left - pictureLeft
  const offsetY = top - pictureTop
  const leftovers: string[] = []

  try {
    const langs = await ocrLanguages()
    if (!langs || langs.length === 0) {
      return { ok: false, lines: [], error: 'Распознавание текста недоступно на этом компьютере' }
    }
    const engines = langs.slice(0, MAX_ENGINES)

    const readings: OcrRawResult[] = []
    let lastError: string | null = null

    for (const variant of variants) {
      const file = path.join(tmpdir(), `flushot-ocr-${randomUUID()}.png`)
      leftovers.push(file)
      try {
        await writeFile(file, await preparePicture(raster, { left, top, width, height }, variant))
        const raw = await recognizeRaw(file, engines)
        if (!raw.ok) {
          lastError = raw.error ?? lastError
          continue
        }
        readings.push(
          ...raw.results.map((result) => ({
            ...toPictureSpace(result, variant.scale, offsetX, offsetY),
            variant: variant.name
          }))
        )
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'Не удалось подготовить снимок к распознаванию'
      } finally {
        // The file has been read; removing it now keeps the user's screen on disk for
        // the shortest time possible rather than for the whole recognition.
        await unlink(file).catch(() => undefined)
        leftovers.pop()
      }
    }

    if (readings.length === 0) {
      return {
        ok: false,
        lines: [],
        error: lastError ?? 'Распознать текст не удалось'
      }
    }

    // The readings are already in picture coordinates, so the merge does not need to
    // divide anything: `finish` is asked for the identity mapping.
    const merged = mergeReadings(readings, langs[0])
    return finish(merged.lines, merged, langs[0], { offsetX: 0, offsetY: 0, scale: 1 })
  } finally {
    for (const file of leftovers) await unlink(file).catch(() => undefined)
  }
}


/**
 * Bring one reading's word boxes from its enlarged crop back into picture pixels.
 *
 * Done per reading rather than once at the end, because the readings no longer share
 * an enlargement: the second variant is a different size, and the merge has to
 * compare boxes from both. In one coordinate system the comparison is a plain
 * geometric overlap, with no scale factor anywhere in the merge.
 */
function toPictureSpace(result: OcrRawResult, scale: number, offsetX: number, offsetY: number): OcrRawResult {
  return {
    ...result,
    lines: result.lines.map((line) => ({
      ...line,
      words: line.words.map((word) => ({
        ...word,
        x: word.x / scale + offsetX,
        y: word.y / scale + offsetY,
        width: word.width / scale,
        height: word.height / scale
      }))
    }))
  }
}

/** Enlarge one variant of the crop and encode it as the PNG the engine reads. */
async function preparePicture(
  raster: Raster,
  crop: { left: number; top: number; width: number; height: number },
  variant: OcrVariant
): Promise<Buffer> {
  let pipeline = sharp(Buffer.from(raster.data.buffer, raster.data.byteOffset, raster.data.byteLength), {
    raw: { width: raster.width, height: raster.height, channels: 4 }
  }).extract({ left: crop.left, top: crop.top, width: crop.width, height: crop.height })

  if (variant.scale > 1) {
    pipeline = pipeline.resize({
      width: Math.max(1, Math.round(crop.width * variant.scale)),
      height: Math.max(1, Math.round(crop.height * variant.scale)),
      kernel: variant.kernel
    })
  }

  switch (variant.preprocess) {
    case 'grayscale':
      pipeline = pipeline.grayscale()
      break
    case 'sharpen':
      pipeline = pipeline.sharpen({ sigma: 1 })
      break
    case 'gray+sharpen':
      pipeline = pipeline.grayscale().sharpen({ sigma: 1 })
      break
    case 'threshold':
      pipeline = pipeline.grayscale().threshold(170)
      break
    default:
      break
  }

  // Level 1: the file is written once, read once and deleted, so squeezing it
  // would only add time to a step the user is waiting for.
  return pipeline.png({ compressionLevel: 1 }).toBuffer()
}

/** Recognize a picture file that is already prepared. Used by the self-test. */
export async function recognizePictureFile(
  file: string,
  geometry: { offsetX: number; offsetY: number; scale: number } = { offsetX: 0, offsetY: 0, scale: 1 }
): Promise<OcrOutcome> {
  const langs = await ocrLanguages()
  if (!langs || langs.length === 0) {
    return { ok: false, lines: [], error: 'Распознавание текста недоступно на этом компьютере' }
  }

  const raw = await recognizeRaw(file, langs.slice(0, MAX_ENGINES))
  if (!raw.ok) return { ok: false, lines: [], error: raw.error }

  const merged = mergeReadings(raw.results, langs[0])
  return finish(merged.lines, merged, langs[0], geometry)
}

/**
 * Map the merged lines back to the coordinates the caller thinks in, and pack them
 * into the outcome.
 *
 * The mapping is applied here, once, and never inside the merge: every reading has
 * already been brought into picture coordinates by `toPictureSpace`, so the merge
 * compares boxes from two different enlargements directly and has no scale factor in
 * it anywhere. What is left is the shift from the cropped region to the whole picture,
 * which is a constant for all readings.
 */
function finish(
  lines: OcrLine[],
  merged: MergedReading,
  preferred: string,
  geometry: { offsetX: number; offsetY: number; scale: number }
): OcrOutcome {
  const { offsetX, offsetY, scale } = geometry

  const mapped = lines.map((line) => ({
    ...line,
    words: line.words.map((word) => ({
      ...word,
      x: Math.round(word.x / scale) + offsetX,
      y: Math.round(word.y / scale) + offsetY,
      width: Math.round(word.width / scale),
      height: Math.round(word.height / scale)
    }))
  }))

  return {
    ok: true,
    lines: mapped,
    text: mapped.map((line) => line.text).join('\n'),
    lang: merged.primary ?? preferred,
    languages: merged.contributors
  }
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}
