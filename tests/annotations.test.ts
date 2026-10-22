import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { pasteAnnotationLayer } from '../src/main/imaging/annotations'
import { composeOptionsFromSettings, composeRawCard, composeScreenshot } from '../src/main/imaging/compose'
import { computeFrameLayout } from '../src/main/imaging/layout'
import type { Raster } from '../src/main/imaging/raster'
import { defaultSettings } from '../src/shared/settings'
import type { AnnotationLayerPayload, ScreenshotSettings } from '../src/shared/types'
import { fromRaster, pixel, solidImage } from './helpers'

function settingsWith(patch: Partial<ScreenshotSettings> = {}): ScreenshotSettings {
  return { ...defaultSettings('C:\\Users\\Test\\Pictures\\Flushot'), theme: 'light', ...patch }
}

/**
 * Magenta is used on purpose: no screenshot or frame in these tests contains it,
 * so counting it proves the layer was really pasted. A "red" square would be
 * indistinguishable from a white background that was simply left alone.
 */
const MAGENTA = { r: 255, g: 0, b: 255, a: 255 }

/** A layer carrying one solid square, as the renderer now sends it: raw RGBA. */
function layerWithSquare(
  pictureWidth: number,
  pictureHeight: number,
  color = MAGENTA
): AnnotationLayerPayload {
  // The square covers the middle half of the picture, like a drawing would.
  const x = Math.round(pictureWidth / 4)
  const y = Math.round(pictureHeight / 4)
  const width = Math.round(pictureWidth / 2)
  const height = Math.round(pictureHeight / 2)
  const data = new Uint8Array(width * height * 4)
  for (let index = 0; index < data.length; index += 4) {
    data[index] = color.r
    data[index + 1] = color.g
    data[index + 2] = color.b
    data[index + 3] = color.a
  }
  return { x, y, width, height, data }
}

/** A full-picture layer, so the rounded-corner clipping is what decides. */
function fullLayer(pictureWidth: number, pictureHeight: number): AnnotationLayerPayload {
  const data = new Uint8Array(pictureWidth * pictureHeight * 4)
  for (let index = 0; index < data.length; index += 4) {
    data[index] = MAGENTA.r
    data[index + 1] = MAGENTA.g
    data[index + 2] = MAGENTA.b
    data[index + 3] = MAGENTA.a
  }
  return { x: 0, y: 0, width: pictureWidth, height: pictureHeight, data }
}

/** The composed card as pixels, which is what the paste step consumes. */
async function cardOf(png: Buffer): Promise<Raster> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data: new Uint8Array(data), width: info.width, height: info.height }
}

/** Count pixels that only the annotation layer could have produced. */
function countMagenta(image: ReturnType<typeof fromRaster>): number {
  let count = 0
  for (let index = 0; index < image.data.length; index += image.channels) {
    if (image.data[index] > 200 && image.data[index + 1] < 80 && image.data[index + 2] > 200) count++
  }
  return count
}

describe('annotations — pasting onto the result', () => {
  it('paints the layer onto the picture and leaves the frame untouched', async () => {
    const settings = settingsWith({ frameWidth: 40, cornerRadius: 12, shadowEnabled: false })
    const png = await composeScreenshot(await solidImage(400, 300, '#FFFFFF'), composeOptionsFromSettings(settings))
    const layout = computeFrameLayout(400, 300, 40, 12)

    const result = pasteAnnotationLayer(await cardOf(png), layout, layerWithSquare(400, 300))
    expect(result.width).toBe(480)
    expect(result.height).toBe(380)

    const image = fromRaster(result)
    // The middle of the picture is covered by the drawn square.
    expect(pixel(image, 40 + 200, 40 + 150).r).toBeGreaterThan(200)
    expect(pixel(image, 40 + 200, 40 + 150).g).toBeLessThan(80)
    // The frame keeps its background colour on all four sides.
    expect(pixel(image, 10, 190).r).toBe(255)
    expect(pixel(image, 10, 190).g).toBe(255)
    expect(pixel(image, 470, 190).g).toBe(255)
    expect(pixel(image, 240, 10).g).toBe(255)
    expect(pixel(image, 240, 370).g).toBe(255)
  })

  it('keeps the annotation after the rounded corners are clipped', async () => {
    // Regression: chaining two sharp `.composite()` calls made the mask wipe the
    // drawing, so the result was silently saved without annotations.
    const settings = settingsWith({ frameWidth: 24, cornerRadius: 16, shadowEnabled: false })
    const png = await composeScreenshot(await solidImage(500, 400, '#101010'), composeOptionsFromSettings(settings))
    const layout = computeFrameLayout(500, 400, 24, 16)

    const result = pasteAnnotationLayer(await cardOf(png), layout, fullLayer(500, 400))
    expect(countMagenta(fromRaster(result))).toBeGreaterThan(10_000)
  })

  it('keeps the rounded corners free of paint', async () => {
    const settings = settingsWith({
      frameWidth: 0,
      cornerRadius: 20,
      shadowEnabled: false,
      backgroundPreset: 'custom',
      backgroundColor: '#00FF00'
    })
    const png = await composeScreenshot(await solidImage(300, 300, '#FFFFFF'), composeOptionsFromSettings(settings))
    const layout = computeFrameLayout(300, 300, 0, 20)

    const result = pasteAnnotationLayer(await cardOf(png), layout, fullLayer(300, 300))
    const image = fromRaster(result)
    // The corner is clipped, so the green background shows instead of the paint.
    const corner = pixel(image, 1, 1)
    expect(corner.g).toBeGreaterThan(200)
    expect(corner.r).toBeLessThan(60)
    // The centre is still painted.
    expect(pixel(image, 150, 150).r).toBeGreaterThan(200)
    expect(pixel(image, 150, 150).g).toBeLessThan(80)
  })

  it('honours the layer offset instead of assuming it starts at the origin', async () => {
    const settings = settingsWith({ frameWidth: 20, cornerRadius: 0, shadowEnabled: false })
    const png = await composeScreenshot(await solidImage(200, 200, '#FFFFFF'), composeOptionsFromSettings(settings))
    const layout = computeFrameLayout(200, 200, 20, 0)

    // A 40 × 40 square of paint whose own origin is at (60, 60) in the picture.
    const data = new Uint8Array(40 * 40 * 4)
    for (let index = 0; index < data.length; index += 4) {
      data[index] = MAGENTA.r
      data[index + 1] = MAGENTA.g
      data[index + 2] = MAGENTA.b
      data[index + 3] = MAGENTA.a
    }
    const result = pasteAnnotationLayer(await cardOf(png), layout, { x: 60, y: 60, width: 40, height: 40, data })
    const image = fromRaster(result)

    expect(pixel(image, 20 + 70, 20 + 70).r).toBeGreaterThan(200)
    expect(pixel(image, 20 + 70, 20 + 70).g).toBeLessThan(80)
    // Outside the square the picture is untouched.
    expect(pixel(image, 20 + 20, 20 + 20).g).toBe(255)
    expect(pixel(image, 20 + 150, 20 + 150).g).toBe(255)
  })

  it('blends a half-transparent stroke instead of overwriting the picture', async () => {
    const settings = settingsWith({ frameWidth: 0, cornerRadius: 0, shadowEnabled: false })
    const png = await composeScreenshot(await solidImage(100, 100, '#000000'), composeOptionsFromSettings(settings))
    const layout = computeFrameLayout(100, 100, 0, 0)

    // White at 50 % over black must land near the middle, not at either end.
    const data = new Uint8Array(100 * 100 * 4)
    for (let index = 0; index < data.length; index += 4) {
      data[index] = 255
      data[index + 1] = 255
      data[index + 2] = 255
      data[index + 3] = 128
    }
    const result = pasteAnnotationLayer(await cardOf(png), layout, { x: 0, y: 0, width: 100, height: 100, data })
    const image = fromRaster(result)
    const blended = pixel(image, 50, 50).r
    expect(blended).toBeGreaterThan(100)
    expect(blended).toBeLessThan(160)
  })

  it('leaves the picture untouched when the layer is empty', async () => {
    const settings = settingsWith({ frameWidth: 32, shadowEnabled: false })
    const png = await composeScreenshot(await solidImage(200, 160, '#FFFFFF'), composeOptionsFromSettings(settings))
    const layout = computeFrameLayout(200, 160, 32, 12)
    const blank: AnnotationLayerPayload = { x: 0, y: 0, width: 0, height: 0, data: new Uint8Array(0) }

    const result = pasteAnnotationLayer(await cardOf(png), layout, blank)
    const image = fromRaster(result)
    expect(countMagenta(image)).toBe(0)
    expect(pixel(image, 32 + 100, 32 + 80).g).toBe(255)
  })

  it('ignores a layer whose bytes are shorter than its declared size', async () => {
    // A truncated payload must cost the drawing, never the screenshot.
    const settings = settingsWith({ frameWidth: 10, shadowEnabled: false })
    const png = await composeScreenshot(await solidImage(80, 80, '#FFFFFF'), composeOptionsFromSettings(settings))
    const layout = computeFrameLayout(80, 80, 10, 0)

    const result = pasteAnnotationLayer(await cardOf(png), layout, {
      x: 0,
      y: 0,
      width: 80,
      height: 80,
      data: new Uint8Array(16)
    })
    expect(result.width).toBe(100)
    expect(countMagenta(fromRaster(result))).toBe(0)
  })
})

describe('annotations — the raw card path', () => {
  it('produces the same pixels as the PNG path, without an intermediate encode', async () => {
    const settings = settingsWith({ frameWidth: 24, cornerRadius: 12, shadowEnabled: true, shadowIntensity: 30 })
    const image = await solidImage(300, 200, '#3B82F6')

    const card = await composeRawCard(
      { data: await rawBuffer(image), width: 300, height: 200 },
      { x: 0, y: 0, width: 300, height: 200 },
      composeOptionsFromSettings(settings)
    )
    const viaPng = await composeScreenshot(image, composeOptionsFromSettings(settings))

    expect(card.raster.width).toBe(348)
    expect(card.raster.height).toBe(248)
    const encoded = await sharp(Buffer.from(card.raster.data.buffer, card.raster.data.byteOffset, card.raster.data.byteLength), {
      raw: { width: card.raster.width, height: card.raster.height, channels: 4 }
    })
      .removeAlpha()
      .png({ compressionLevel: 5, adaptiveFiltering: true })
      .toBuffer()

    // Identical bytes: the two paths share the same canvas builder.
    expect(encoded.equals(viaPng)).toBe(true)
    expect(card.preview.startsWith('data:image/png;base64,')).toBe(true)
  })
})

async function rawBuffer(image: Buffer): Promise<Uint8Array> {
  const { data } = await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return new Uint8Array(data)
}
