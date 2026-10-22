import sharp from 'sharp'
import { resolveBackgroundColor } from '../../shared/settings'
import type { ScreenshotSettings } from '../../shared/types'
import { computeFrameLayout, type FrameLayout } from './layout'
import { composeCardRaster, type Raster } from './raster'

export { parseHexColor } from './color'

export interface ComposeOptions {
  backgroundColor: string
  /** Width of the background frame around the screenshot (px). */
  frameWidth: number
  /** Corner radius of the picture inside the frame (px). */
  cornerRadius: number
  shadowEnabled: boolean
  /** 0–60, percentage of black. */
  shadowIntensity: number
  /** Blur radius in output pixels, 0–48. */
  shadowBlur: number
  shadowOffsetY: number
}

/** Pixels straight from the frozen screen, no PNG round trip. */
export interface RawImage {
  data: Buffer | Uint8Array
  width: number
  height: number
}

/** PNG encoder settings; the output is lossless for any value. */
export interface PngEncode {
  compressionLevel?: number
  adaptiveFiltering?: boolean
}

/**
 * What a save actually costs. Measured on a real 1920 × 1080 desktop capture,
 * encoded without a redundant alpha channel:
 *
 * | setting              | time    | size    |
 * |----------------------|---------|---------|
 * | level 9 + adaptive   | 1291 ms | 2001 KB |
 * | level 6 + adaptive   |  202 ms | 1829 KB |
 * | level 5 + adaptive   |  163 ms | 1845 KB |
 * | level 4 + adaptive   |  152 ms | 1854 KB |
 * | level 3 + adaptive   |  137 ms | 1878 KB |
 *
 * Level 9 with adaptive filtering — the old default — spends over a second of the
 * user's time to make the file *bigger* than level 5 does, because adaptive
 * filtering already picks per-row strategies and the extra deflate passes do not
 * pay for themselves on screen content. Level 5 is the knee: eight times faster
 * and 8 % smaller than before. PNG is lossless at every level; only the deflate
 * strategy changes.
 */
export const FAST_PNG: PngEncode = { compressionLevel: 5, adaptiveFiltering: true }

/**
 * Above this the card is downscaled before being handed to the renderer.
 *
 * The preview travels over IPC as base64, so it grows by a third on the way; a
 * megabyte of PNG is fine, several are not. Every ordinary selection — a window,
 * a region, a 1080p screen — lands far below this.
 */
const DIRECT_PREVIEW_LIMIT = 1024 * 1024

export type ImageSource = Buffer | RawImage

function isRaw(source: ImageSource): source is RawImage {
  return !Buffer.isBuffer(source)
}

/** Clamp a requested crop to the image, so selection math can never overflow. */
function clampRect(
  rect: { x: number; y: number; width: number; height: number },
  imageWidth: number,
  imageHeight: number
): { left: number; top: number; width: number; height: number } {
  if (rect.width <= 0 || rect.height <= 0) throw new Error('Пустая область выделения')
  const left = Math.max(0, Math.min(Math.round(rect.x), imageWidth - 1))
  const top = Math.max(0, Math.min(Math.round(rect.y), imageHeight - 1))
  const width = Math.max(1, Math.min(Math.round(rect.width), imageWidth - left))
  const height = Math.max(1, Math.min(Math.round(rect.height), imageHeight - top))
  return { left, top, width, height }
}

export function composeOptionsFromSettings(settings: ScreenshotSettings): ComposeOptions {
  return {
    backgroundColor: resolveBackgroundColor(settings),
    frameWidth: settings.frameWidth,
    cornerRadius: settings.cornerRadius,
    shadowEnabled: settings.shadowEnabled,
    shadowIntensity: settings.shadowIntensity,
    shadowBlur: settings.shadowBlur,
    shadowOffsetY: settings.shadowOffsetY
  }
}

/** Crop the selected region from the frozen screenshot at native resolution. */
export async function cropImage(image: Buffer, rect: { x: number; y: number; width: number; height: number }): Promise<Buffer> {
  const metadata = await sharp(image).metadata()
  if (!metadata.width || !metadata.height) throw new Error('Не удалось прочитать снимок экрана')
  const area = clampRect(rect, metadata.width, metadata.height)
  return sharp(image).extract(area).png().toBuffer()
}

/** Pixels as a plain RGBA raster: decoded once if the caller passed an encoded image. */
async function toRaster(source: ImageSource): Promise<Raster> {
  if (isRaw(source)) {
    const data = source.data instanceof Uint8Array ? source.data : new Uint8Array(source.data)
    return { data, width: source.width, height: source.height }
  }
  const decoded = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  if (decoded.info.channels !== 4) throw new Error('Не удалось прочитать выделенную область')
  return { data: decoded.data, width: decoded.info.width, height: decoded.info.height }
}

/**
 * Crop and frame a selection.
 *
 * The whole card — crop, rounded corners, shadow, background — is assembled on a
 * single pixel buffer, so nothing is encoded or decoded in between. That is what
 * makes the difference: the old pipeline rasterised the shadow as a full-size SVG
 * and ran two PNG round trips through libvips, ~300 ms on a two-monitor capture.
 */
async function buildCanvas(
  source: ImageSource,
  rect: { x: number; y: number; width: number; height: number },
  layout: FrameLayout,
  options: ComposeOptions
): Promise<Raster> {
  const raster = await toRaster(source)
  const area = clampRect(rect, raster.width, raster.height)
  return composeCardRaster(raster, { x: area.left, y: area.top, width: area.width, height: area.height }, layout, options)
}

/**
 * Crop a raw bitmap and build the card in one pipeline.
 *
 * The PNG round trip that a full-screen buffer would need (encode ~100 ms,
 * decode ~25 ms) is skipped entirely: sharp reads the pixels it is given and
 * only the final card is encoded.
 */
export async function composeRawScreenshot(
  raw: RawImage,
  rect: { x: number; y: number; width: number; height: number },
  options: ComposeOptions,
  encode: PngEncode = {}
): Promise<Buffer> {
  const area = clampRect(rect, raw.width, raw.height)
  const layout = computeFrameLayout(area.width, area.height, options.frameWidth, options.cornerRadius)
  const canvas = await buildCanvas(raw, { x: area.left, y: area.top, width: area.width, height: area.height }, layout, options)
  return encodeCanvas(canvas, encode)
}

/** A finished card plus the downscaled copy the overlay shows. */
export interface ComposedCard {
  png: Buffer
  preview: string
  width: number
  height: number
}

/** A finished card as pixels, ready to be annotated and then encoded once. */
export interface RawCard {
  raster: Raster
  layout: FrameLayout
  /** Downscaled `data:` URL the result card displays. */
  preview: string
}

/**
 * Crop, frame and finish a selection, returning pixels and the preview.
 *
 * The full-size PNG is deliberately not produced here. It is only needed when
 * something is written to disk or to the clipboard, and by then the user may have
 * drawn on the card — in which case it would have been encoded once and thrown
 * away. Encoding at the moment of the save means the file is built from the
 * finished picture, in the format that was actually asked for.
 */
export async function composeRawCard(
  raw: RawImage,
  rect: { x: number; y: number; width: number; height: number },
  options: ComposeOptions,
  previewWidth = 720
): Promise<RawCard> {
  const area = clampRect(rect, raw.width, raw.height)
  const layout = computeFrameLayout(area.width, area.height, options.frameWidth, options.cornerRadius)
  const raster = await buildCanvas(raw, { x: area.left, y: area.top, width: area.width, height: area.height }, layout, options)
  const preview = await previewFromRaster(raster, previewWidth)
  return { raster, layout, preview }
}

/**
 * Crop, frame and finish a selection in one pass, returning the file and the
 * preview together.
 *
 * The preview used to be produced from the encoded PNG, which meant decoding the
 * very buffer that had just been encoded. Both now come from the same raw canvas.
 *
 * For most captures the card is small enough that the encoded PNG *is* the
 * preview: the browser scales it down for display, and a downscale + second
 * encode would cost ~97 ms and often produce a *larger* file (screen content
 * resampled to 2/3 size compresses worse than it did at full size). Only a big
 * card — a full 4K screen, where the base64 payload would run to megabytes — is
 * downscaled, and then only once.
 */
export async function composeRawScreenshotWithPreview(
  raw: RawImage,
  rect: { x: number; y: number; width: number; height: number },
  options: ComposeOptions,
  previewWidth = 720,
  encode: PngEncode = FAST_PNG
): Promise<ComposedCard> {
  const area = clampRect(rect, raw.width, raw.height)
  const layout = computeFrameLayout(area.width, area.height, options.frameWidth, options.cornerRadius)
  const canvas = await buildCanvas(raw, { x: area.left, y: area.top, width: area.width, height: area.height }, layout, options)
  const png = await encodeCanvas(canvas, encode)
  const preview =
    png.length <= DIRECT_PREVIEW_LIMIT
      ? `data:image/png;base64,${png.toString('base64')}`
      : await previewFromRaster(canvas, previewWidth)
  return { png, preview, width: canvas.width, height: canvas.height }
}

/**
 * Build the finished image: the screenshot exactly as captured, with a frame of
 * the chosen colour on all four sides. Nothing is scaled, so the output keeps
 * whatever size the user selected — the frame is added around it.
 * Returns a lossless PNG buffer.
 */
export async function composeScreenshot(
  image: ImageSource,
  options: ComposeOptions,
  encode: PngEncode = {}
): Promise<Buffer> {
  const raster = await toRaster(image)
  if (!raster.width || !raster.height) throw new Error('Не удалось прочитать выделенную область')

  const layout = computeFrameLayout(raster.width, raster.height, options.frameWidth, options.cornerRadius)
  return composeWithLayout(image, layout, options, encode)
}

/**
 * Pay the one-time cost of the imaging engine ahead of time.
 *
 * sharp/libvips initialises lazily: the very first compose in a process costs
 * ~230 ms, every later one ~40 ms. Running a tiny compose while the app idles in
 * the tray moves that cost away from the user's first screenshot. The shadow
 * corner tile is built here too, so the first capture does not pay for it either.
 */
export async function warmImaging(): Promise<void> {
  const raw: RawImage = { data: Buffer.alloc(64 * 64 * 4, 0xff), width: 64, height: 64 }
  await composeRawScreenshot(raw, { x: 0, y: 0, width: 64, height: 64 }, {
    backgroundColor: '#FFFFFF',
    frameWidth: 8,
    cornerRadius: 4,
    shadowEnabled: true,
    shadowIntensity: 20,
    shadowBlur: 8,
    shadowOffsetY: 2
  })
}

/**
 * Downscaled data-URL used for the in-overlay result preview.
 *
 * The caller passes the width the preview will actually occupy on screen (CSS
 * width × device pixel ratio), so the browser never has to stretch it. Lanczos3
 * keeps small text legible instead of turning it into grey mush.
 */
export async function makePreview(png: Buffer, width = 720): Promise<string> {
  const target = Math.max(320, Math.min(2560, Math.round(width)))
  const small = await sharp(png)
    .resize({ width: target, withoutEnlargement: true, kernel: 'lanczos3' })
    .png({ compressionLevel: 6 })
    .toBuffer()
  return `data:image/png;base64,${small.toString('base64')}`
}

/**
 * Build a framed card and return only its downscaled preview.
 *
 * The settings window redraws its sample on every slider move, and it never
 * needs the full-size file. Going through `composeScreenshot()` would encode a
 * full-resolution PNG (62 ms) purely to decode it again for the resize.
 */
export async function composePreview(image: ImageSource, options: ComposeOptions, width = 960): Promise<string> {
  const raster = await toRaster(image)
  if (!raster.width || !raster.height) throw new Error('Не удалось прочитать изображение для превью')
  const layout = computeFrameLayout(raster.width, raster.height, options.frameWidth, options.cornerRadius)
  const canvas = await buildCanvas(image, { x: 0, y: 0, width: raster.width, height: raster.height }, layout, options)
  return previewFromRaster(canvas, width)
}

/**
 * Real pixel size of a composed result.
 *
 * Read from the finished PNG rather than predicted from the selection: a
 * selection at the screen edge is clamped during cropping, so a prediction
 * would be a few pixels off exactly where the user is most likely to notice it.
 */
export async function imageSize(png: Buffer): Promise<{ width: number; height: number }> {
  const metadata = await sharp(png).metadata()
  return { width: metadata.width ?? 0, height: metadata.height ?? 0 }
}

/**
 * Encode a finished canvas as a lossless PNG.
 *
 * The alpha channel is dropped: the canvas is fully opaque by construction (the
 * background covers it and the picture is drawn over it), and an all-255 alpha
 * channel costs 7–12 % of the file plus a deflate pass to compress it.
 */
async function encodeCanvas(canvas: Raster, encode: PngEncode = {}): Promise<Buffer> {
  return sharp(Buffer.from(canvas.data.buffer, canvas.data.byteOffset, canvas.data.byteLength), {
    raw: { width: canvas.width, height: canvas.height, channels: 4 }
  })
    .removeAlpha()
    .png({
      compressionLevel: encode.compressionLevel ?? FAST_PNG.compressionLevel,
      adaptiveFiltering: encode.adaptiveFiltering ?? FAST_PNG.adaptiveFiltering
    })
    .toBuffer()
}

/** Downscale a finished canvas into the data URL the result card displays. */
export async function previewFromRaster(canvas: Raster, width: number): Promise<string> {
  const target = Math.max(320, Math.min(2560, Math.round(width)))
  const small = await sharp(Buffer.from(canvas.data.buffer, canvas.data.byteOffset, canvas.data.byteLength), {
    raw: { width: canvas.width, height: canvas.height, channels: 4 }
  })
    .resize({ width: target, withoutEnlargement: true, kernel: 'lanczos3' })
    .png({ compressionLevel: 6 })
    .toBuffer()
  return `data:image/png;base64,${small.toString('base64')}`
}

/**
 * Compose a card for a layout that is already known.
 *
 * The screenshot goes in pixel for pixel: no resize step, so nothing is
 * resampled and the output keeps the exact size of the selection.
 */
export async function composeWithLayout(
  image: ImageSource,
  layout: FrameLayout,
  options: ComposeOptions,
  encode: PngEncode = {}
): Promise<Buffer> {
  const canvas = await buildCanvas(image, { x: 0, y: 0, width: layout.width, height: layout.height }, layout, options)
  return encodeCanvas(canvas, encode)
}
