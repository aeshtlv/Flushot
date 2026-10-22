import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { ocrScale, planVariants, recognizeCardPicture, recognizePictureFile } from '../src/main/ocr/recognize'
import { isOcrSupported, stopOcr } from '../src/main/ocr/worker'
import { ocrSampleSvg } from '../src/main/ocr/sample'
import { computeFrameLayout } from '../src/main/imaging/layout'
import type { Raster } from '../src/main/imaging/raster'

/**
 * These run against the real engine that ships with Windows, so they are the
 * only tests in the suite whose result depends on the machine. They are written
 * to skip — not fail — where the engine is missing, because a Windows install
 * without a language pack is a supported configuration and the app says so in the
 * UI rather than crashing.
 */

/** Render text into a picture, so the test does not depend on any stored image. */
async function textPicture(text: string, size = 34): Promise<Raster> {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="220">
    <rect width="900" height="220" fill="#ffffff"/>
    <text x="40" y="130" font-family="Segoe UI, Arial" font-size="${size}" fill="#111111">${escaped}</text>
  </svg>`
  const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data: new Uint8Array(data), width: info.width, height: info.height }
}

/** A card: the picture inside a solid frame, exactly as the app composes it. */
async function cardOf(picture: Raster, frame = 64): Promise<{ raster: Raster; layout: ReturnType<typeof computeFrameLayout> }> {
  const layout = computeFrameLayout(picture.width, picture.height, frame)
  const data = new Uint8Array(layout.canvasWidth * layout.canvasHeight * 4)
  for (let index = 0; index < data.length; index += 4) {
    data[index] = 245
    data[index + 1] = 245
    data[index + 2] = 247
    data[index + 3] = 255
  }
  for (let y = 0; y < picture.height; y++) {
    const from = y * picture.width * 4
    const to = ((y + layout.y) * layout.canvasWidth + layout.x) * 4
    data.set(picture.data.subarray(from, from + picture.width * 4), to)
  }
  return { raster: { data, width: layout.canvasWidth, height: layout.canvasHeight }, layout }
}

describe('ocr — how much the picture is enlarged before recognition', () => {
  it('triples a small picture and doubles a medium one', () => {
    // Measured against known text (`.tmp/ocr-bench*.cjs`): a 640 × 140 fragment
    // reads at 3.0 % character error at 1× and 0.0 % at 3×; a 900 × 260 picture
    // goes from 2.3 % to 0.0 %. The old rule left anything above 1200 px at 1×,
    // which cost a third of the characters on a full-screen capture.
    expect(ocrScale(640, 140)).toBe(3)
    expect(ocrScale(840, 945)).toBe(3)
    expect(ocrScale(1600, 1000)).toBe(2)
  })

  it('grows a large picture by half, not by double', () => {
    // Measured (`.tmp/ocr-bench3.cjs`): a 2560 × 1440 capture at 2× is 14.7 MP and
    // takes 516 ms — fine. A 4K capture at 2× is 33 MP and takes 3.4 s, while 1.5×
    // gives the same reading in one second, so the rule stops doubling there.
    expect(ocrScale(1920, 1080)).toBe(2)
    expect(ocrScale(2560, 1440)).toBe(2)
    expect(ocrScale(3840, 2160)).toBeCloseTo(1.5, 5)
  })

  it('never enlarges more than three times', () => {
    expect(ocrScale(120, 90)).toBe(3)
    expect(ocrScale(200, 200)).toBe(3)
  })

  it('never asks the engine for more than it accepts', () => {
    // `OcrEngine.MaxImageDimension` is 10000, and past about twenty megapixels
    // the engine slows down faster than it improves. Both limits hold for any
    // input — a picture that is already enormous is simply not enlarged, because
    // there is nothing below 1×.
    for (const [width, height] of [
      [6000, 4000],
      [5000, 3000],
      [3840, 2160],
      [9000, 5000],
      [10_000, 1000]
    ]) {
      const scale = ocrScale(width, height)
      expect(scale).toBeGreaterThanOrEqual(1)
      expect(Math.max(width, height) * scale).toBeLessThanOrEqual(10_000)
      if (scale > 1) expect((width * scale * height * scale) / 1e6).toBeLessThanOrEqual(20.001)
    }
  })
})

describe('ocr — how many readings of the picture are taken', () => {
  it('reads a picture three times, at two sizes and two treatments', () => {
    // Measured on the realistic page set (`.tmp/ocr-lab.cjs`, four sizes, twenty lines
    // of Russian, English, mixed and code): one reading gives 3.50 % mean character
    // error, adding the two-thirds reading gives 3.35 %, adding the black-and-white
    // copy gives 3.22 %. Both additions were kept because both were measured to help.
    const plan = planVariants(760, 1200)
    expect(plan.map((variant) => variant.name)).toEqual(['base', 'finer', 'threshold'])
    expect(plan[0].scale).toBe(3)
    expect(plan[1].scale).toBe(2)
    expect(plan[1].kernel).not.toBe(plan[0].kernel)
    // The threshold copy is the same size as the base: what changes is the pixels, not
    // the scale, so it fails differently instead of being a repeat.
    expect(plan[2].scale).toBe(plan[0].scale)
    expect(plan[2].preprocess).toBe('threshold')
  })

  it('drops the second reading when it would coincide with the first', () => {
    // A picture the engine already sees at 1× has nothing smaller to offer, and asking
    // for 0.67× would mean shrinking it and throwing detail away.
    const plan = planVariants(6000, 4000)
    expect(plan.filter((variant) => variant.name === 'finer')).toHaveLength(0)
    for (const variant of plan) expect(variant.scale).toBeGreaterThanOrEqual(1)
  })

  it('never plans a reading at a scale the picture cannot support', () => {
    for (const [width, height] of [
      [640, 140],
      [1920, 1080],
      [2560, 1440],
      [3840, 2160]
    ]) {
      for (const variant of planVariants(width, height)) {
        expect(variant.scale).toBeGreaterThanOrEqual(1)
        expect(Math.max(width, height) * variant.scale).toBeLessThanOrEqual(10_000)
      }
    }
  })
})

const supported = isOcrSupported()
describe.skipIf(!supported)('ocr — the real Windows engine', () => {
  it('reads a line of text out of a framed card', async () => {
    const { raster, layout } = await cardOf(await textPicture('Flushot reads text'))
    const outcome = await recognizeCardPicture(raster, layout)
    stopOcr()

    if (!outcome.ok) {
      // No language pack: the app reports that, it does not crash.
      expect(outcome.error).toBeTruthy()
      return
    }
    const all = outcome.lines.map((line) => line.text).join(' ').toLowerCase()
    expect(all).toContain('flushot')
    expect(all).toContain('text')
    expect(outcome.lang).toBeTruthy()
  }, 60_000)

  it('never reads the frame, only the picture', async () => {
    // The frame is a solid colour, and a picture of a single word is small: if the
    // crop were wrong, the engine would be handed mostly empty border and would
    // find nothing at all.
    const picture = await textPicture('Отчёт', 48)
    const { raster, layout } = await cardOf(picture, 96)
    const outcome = await recognizeCardPicture(raster, layout)
    stopOcr()
    if (!outcome.ok) return
    expect(outcome.lines.length).toBeGreaterThan(0)
  }, 60_000)

  it('maps word boxes back into picture coordinates', async () => {
    const picture = await textPicture('Hello world', 44)
    const { raster, layout } = await cardOf(picture)
    const outcome = await recognizeCardPicture(raster, layout)
    stopOcr()
    if (!outcome.ok) return

    for (const line of outcome.lines) {
      for (const word of line.words) {
        // Inside the picture, not inside the frame and not scaled up.
        expect(word.x).toBeGreaterThanOrEqual(0)
        expect(word.y).toBeGreaterThanOrEqual(0)
        expect(word.x + word.width).toBeLessThanOrEqual(picture.width + 2)
        expect(word.y + word.height).toBeLessThanOrEqual(picture.height + 2)
      }
    }
  }, 60_000)
})

describe('the self-test sample', () => {
  it.skipIf(!isOcrSupported())('is readable by the real engine', async () => {
    // The self-test gates the whole report on this picture coming back with the
    // word "Flushot" in it. If the sample were unreadable, that gate would fail
    // for a reason that has nothing to do with the app.
    const file = path.join(os.tmpdir(), `flushot-ocr-sample-${process.pid}.png`)
    try {
      await sharp(Buffer.from(ocrSampleSvg())).png({ compressionLevel: 1 }).toFile(file)
      const outcome = await recognizePictureFile(file)
      const text = outcome.lines.map((line) => line.text).join(' ')
      expect(outcome.ok).toBe(true)
      expect(text.toLowerCase()).toContain('flushot')
    } finally {
      await fs.rm(file, { force: true }).catch(() => undefined)
      stopOcr()
    }
  })
})
