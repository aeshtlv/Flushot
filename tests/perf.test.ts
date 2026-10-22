import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import {
  FAST_PNG,
  composeRawCard,
  composeRawScreenshot,
  composeRawScreenshotWithPreview,
  composeScreenshot,
  composeOptionsFromSettings
} from '../src/main/imaging/compose'
import { computeFrameLayout } from '../src/main/imaging/layout'
import { encodeImage, encodeRaster } from '../src/main/export/imageExport'
import { pasteAnnotationLayer } from '../src/main/imaging/annotations'
import { defaultSettings } from '../src/shared/settings'

function settingsWith(patch = {}) {
  return { ...defaultSettings('C:\\Users\\Test\\Pictures\\Flushot'), ...patch }
}

/** A screen-sized RGBA buffer with a gradient, so the encoder has real work. */
function screen(width: number, height: number): { data: Buffer; width: number; height: number } {
  const data = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4
      data[index] = (x * 3) & 0xff
      data[index + 1] = (y * 5) & 0xff
      data[index + 2] = ((x + y) * 2) & 0xff
      data[index + 3] = 255
    }
  }
  return { data, width, height }
}

describe('speed — what the encoder is asked to do', () => {
  it('never falls back to the slowest deflate settings', () => {
    // Level 9 with adaptive filtering costs over a second on a 1080p capture and
    // produces a *larger* file than level 5. Anything at or above 8 means the old
    // setting crept back in.
    expect(FAST_PNG.compressionLevel).toBeLessThan(8)
    expect(FAST_PNG.compressionLevel).toBeGreaterThan(0)
    expect(FAST_PNG.adaptiveFiltering).toBe(true)
  })

  it('drops the redundant alpha channel from the finished card', async () => {
    const image = await sharp({ create: { width: 400, height: 300, channels: 4, background: { r: 200, g: 100, b: 50, alpha: 1 } } })
      .png()
      .toBuffer()
    const png = await composeScreenshot(image, composeOptionsFromSettings(settingsWith()))
    const metadata = await sharp(png).metadata()

    // Three channels: the frame is opaque by construction, so an all-255 alpha
    // channel would only cost bytes and a deflate pass.
    expect(metadata.channels).toBe(3)
    expect(metadata.hasAlpha).toBe(false)
  })

  it('still produces a pixel-identical picture after dropping alpha', async () => {
    const image = await sharp({ create: { width: 200, height: 150, channels: 4, background: { r: 12, g: 34, b: 56, alpha: 1 } } })
      .png()
      .toBuffer()
    const png = await composeScreenshot(image, composeOptionsFromSettings(settingsWith({ shadowEnabled: false })))
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const layout = computeFrameLayout(200, 150, 64)

    // The centre of the picture keeps the exact source colour.
    const index = ((layout.y + 75) * info.width + layout.x + 100) * 4
    expect([data[index], data[index + 1], data[index + 2]]).toEqual([12, 34, 56])
    // And the whole card is opaque, not accidentally see-through.
    expect(data[index + 3]).toBe(255)
  })
})

describe('speed — the compose path', () => {
  it('builds the card and the preview in one pass', async () => {
    const source = screen(600, 400)
    const settings = settingsWith()
    const card = await composeRawScreenshotWithPreview(source, { x: 0, y: 0, width: 600, height: 400 }, composeOptionsFromSettings(settings), 320)

    expect(card.width).toBe(600 + settings.frameWidth * 2)
    expect(card.height).toBe(400 + settings.frameWidth * 2)
    expect(card.png.length).toBeGreaterThan(0)
    expect(card.preview.startsWith('data:image/png;base64,')).toBe(true)

    // The reported size must match the file, or the overlay would draw a card of
    // the wrong shape.
    const metadata = await sharp(card.png).metadata()
    expect(metadata.width).toBe(card.width)
    expect(metadata.height).toBe(card.height)
  })

  it('returns the same pixels as the older buffer-based entry point', async () => {
    const source = screen(300, 200)
    const settings = settingsWith()
    const options = composeOptionsFromSettings(settings)
    const rect = { x: 0, y: 0, width: 300, height: 200 }

    const viaRaw = await composeRawScreenshot(source, rect, options)
    const viaPreviewPath = await composeRawScreenshotWithPreview(source, rect, options, 200)

    const left = await sharp(viaRaw).ensureAlpha().raw().toBuffer()
    const right = await sharp(viaPreviewPath.png).ensureAlpha().raw().toBuffer()
    expect(left.equals(right)).toBe(true)
  })

  it('hands the card itself to the renderer when it is small enough', async () => {
    const source = screen(600, 400)
    const card = await composeRawScreenshotWithPreview(source, { x: 0, y: 0, width: 600, height: 400 }, composeOptionsFromSettings(settingsWith()), 480)

    // No second resize, no second encode: the preview is the exact file. A
    // downscale here cost ~97 ms on a real capture and often produced a *bigger*
    // PNG, because resampled screen content compresses worse than the original.
    expect(card.png.length).toBeLessThan(1024 * 1024)
    expect(card.preview).toBe(`data:image/png;base64,${card.png.toString('base64')}`)
  })

  it('downscales a card too large to send inline', async () => {
    // Random noise: it cannot be compressed, so a small picture already exceeds
    // the inline limit and exercises the fallback the way a full 4K capture would.
    const width = 900
    const height = 700
    const data = Buffer.alloc(width * height * 4)
    let seed = 12345
    for (let index = 0; index < data.length; index += 4) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      data[index] = seed & 0xff
      data[index + 1] = (seed >>> 8) & 0xff
      data[index + 2] = (seed >>> 16) & 0xff
      data[index + 3] = 255
    }

    const card = await composeRawScreenshotWithPreview(
      { data, width, height },
      { x: 0, y: 0, width, height },
      composeOptionsFromSettings(settingsWith()),
      480
    )

    expect(card.png.length).toBeGreaterThan(1024 * 1024)
    expect(card.preview).not.toBe(`data:image/png;base64,${card.png.toString('base64')}`)

    // The preview really is smaller, which is the whole point of the fallback.
    const previewBytes = Buffer.from(card.preview.split(',')[1], 'base64')
    expect(previewBytes.length).toBeLessThan(card.png.length)
    const metadata = await sharp(previewBytes).metadata()
    expect(metadata.width).toBe(480)
  })

  it('keeps a screen-sized capture well under a second', async () => {
    const source = screen(1920, 1080)
    const settings = settingsWith()
    const started = performance.now()
    await composeRawScreenshotWithPreview(source, { x: 0, y: 0, width: 1920, height: 1080 }, composeOptionsFromSettings(settings), 1216)
    const elapsed = performance.now() - started

    // A generous ceiling: this catches a return to the old encoder (which took
    // 1.3 s on its own) without failing on a busy machine.
    expect(elapsed).toBeLessThan(1200)
  })
})

describe('speed — the lossy export encoders', () => {
  /** A screen-sized PNG, encoded once and shared by the checks below. */
  async function bigPng(): Promise<Buffer> {
    const source = screen(1920, 1080)
    return composeRawScreenshot(source, { x: 0, y: 0, width: 1920, height: 1080 }, composeOptionsFromSettings(settingsWith()))
  }

  it('encodes JPEG quickly and still in full chroma', async () => {
    const png = await bigPng()
    const started = performance.now()
    const jpeg = await encodeImage(png, { format: 'jpeg', jpegQuality: 94 })
    const elapsed = performance.now() - started

    // mozjpeg produced the same pixels 8.7× slower (513 ms vs 59 ms measured), so
    // a regression here would show up immediately.
    expect(elapsed).toBeLessThan(400)
    const metadata = await sharp(jpeg).metadata()
    expect(metadata.format).toBe('jpeg')
    expect(metadata.width).toBe(1920 + settingsWith().frameWidth * 2)
    expect(metadata.chromaSubsampling).toBe('4:4:4')
  })

  it('encodes WebP quickly without losing quality to a lower effort', async () => {
    const png = await bigPng()
    const started = performance.now()
    const webp = await encodeImage(png, { format: 'webp', jpegQuality: 94 })
    const elapsed = performance.now() - started

    // Effort 2 and effort 4 produced the same file size in the benchmark; effort
    // 4 only made the user wait 117 ms longer.
    expect(elapsed).toBeLessThan(400)
    const metadata = await sharp(webp).metadata()
    expect(metadata.format).toBe('webp')
  })

  it('passes PNG through untouched', async () => {
    const png = await bigPng()
    const same = await encodeImage(png, { format: 'png', jpegQuality: 94 })
    // No decode, no re-encode, no colour-management pass: the exact same buffer.
    expect(same).toBe(png)
  })
})

describe('speed — the annotated save path', () => {
  /** A card for a 1920 × 1080 capture, as pixels, exactly as the session holds it. */
  async function card() {
    const settings = settingsWith()
    const source = screen(1920, 1080)
    const composed = await composeRawCard(source, { x: 0, y: 0, width: 1920, height: 1080 }, composeOptionsFromSettings(settings), 320)
    return composed
  }

  /** A stroke as the overlay sends it: raw RGBA of a small painted box. */
  function stroke(width: number, height: number) {
    const data = new Uint8Array(width * height * 4)
    for (let index = 0; index < data.length; index += 4) {
      data[index] = 255
      data[index + 3] = 255
    }
    return { x: 40, y: 60, width, height, data }
  }

  it('pastes a small stroke without touching the rest of a large card', async () => {
    const { raster, layout } = await card()
    const started = performance.now()
    const pasted = pasteAnnotationLayer(raster, layout, stroke(120, 90))
    const elapsed = performance.now() - started

    // Only the 120 × 90 box is visited, so the cost cannot grow with the card:
    // this is the invariant that keeps a 4K save fast. A whole-card pass would be
    // tens of milliseconds even here and hundreds on 4K.
    expect(elapsed).toBeLessThan(40)
    expect(pasted.width).toBe(raster.width)
    expect(pasted.height).toBe(raster.height)
  })

  it('leaves the card untouched outside the stroke', async () => {
    const { raster, layout } = await card()
    const pasted = pasteAnnotationLayer(raster, layout, stroke(120, 90))
    // The frame keeps its colour, and the stroke is where it was asked to go.
    const corner = (layout.y - 1) * pasted.width * 4
    expect(Array.from(pasted.data.slice(corner, corner + 3))).toEqual(Array.from(raster.data.slice(corner, corner + 3)))
    const painted = ((layout.y + 60 + 10) * pasted.width + layout.x + 40 + 10) * 4
    expect(pasted.data[painted]).toBe(255)
    expect(pasted.data[painted + 1]).toBe(0)
  })

  it('encodes the finished card once, in under a third of a second', async () => {
    const { raster, layout } = await card()
    const pasted = pasteAnnotationLayer(raster, layout, stroke(300, 200))
    const started = performance.now()
    const png = await encodeRaster(pasted, { format: 'png', jpegQuality: 94 })
    const elapsed = performance.now() - started

    // The old path needed four encoder passes; one is the floor, and the measured
    // cost on this machine is 30–110 ms depending on the content.
    expect(elapsed).toBeLessThan(600)
    expect(png.length).toBeGreaterThan(0)
  })
})