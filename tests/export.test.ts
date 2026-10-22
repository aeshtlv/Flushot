import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { encodeImage, encodeRaster, isDirectoryWritable, writeImageFile } from '../src/main/export/imageExport'
import { buildScreenshotFilename, fileExtension, formatTimestamp, uniqueFilename } from '../src/main/export/filename'
import { composeOptionsFromSettings, composeScreenshot } from '../src/main/imaging/compose'
import { defaultSettings } from '../src/shared/settings'
import { markerImage, raw } from './helpers'

let tempDir = ''

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flushot-test-'))
})

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true })
})

async function composedCard(): Promise<Buffer> {
  const source = await markerImage(1440, 810)
  return composeScreenshot(source, composeOptionsFromSettings(defaultSettings(tempDir)))
}

describe('PNG export', () => {
  it('keeps the composed size and stays lossless', async () => {
    const png = await composedCard()
    const encoded = await encodeImage(png, { format: 'png', jpegQuality: 90 })
    const metadata = await sharp(encoded).metadata()

    expect(metadata.format).toBe('png')
    expect(metadata.width).toBe(1440 + 128)
    expect(metadata.height).toBe(810 + 128)

    // Pixel-for-pixel identical to the source buffer.
    const a = await raw(png)
    const b = await raw(encoded)
    expect(b.data.equals(a.data)).toBe(true)
  })

  it('writes a valid PNG file to disk', async () => {
    const encoded = await encodeImage(await composedCard(), { format: 'png', jpegQuality: 90 })
    const target = path.join(tempDir, 'screenshot_2026-10-17_14-30-25.png')
    await writeImageFile(target, encoded)

    const stat = await fs.stat(target)
    expect(stat.size).toBeGreaterThan(1000)

    const metadata = await sharp(target).metadata()
    expect(metadata.format).toBe('png')
    expect(metadata.width).toBe(1440 + 128)
    expect(metadata.height).toBe(810 + 128)
  })
})

describe('JPEG export', () => {
  it('encodes a JPEG without transparency', async () => {
    const encoded = await encodeImage(await composedCard(), { format: 'jpeg', jpegQuality: 92 })
    const metadata = await sharp(encoded).metadata()

    expect(metadata.format).toBe('jpeg')
    expect(metadata.width).toBe(1440 + 128)
    expect(metadata.height).toBe(810 + 128)
    expect(metadata.hasAlpha).toBe(false)
    expect(metadata.channels).toBe(3)
  })

  it('clamps quality into the supported range', async () => {
    const png = await composedCard()
    const low = await encodeImage(png, { format: 'jpeg', jpegQuality: 10 })
    const high = await encodeImage(png, { format: 'jpeg', jpegQuality: 300 })

    expect(low.length).toBeGreaterThan(0)
    expect(high.length).toBeGreaterThan(0)
    expect((await sharp(low).metadata()).format).toBe('jpeg')
    expect((await sharp(high).metadata()).format).toBe('jpeg')
  })

  it('writes a valid JPEG file to disk', async () => {
    const encoded = await encodeImage(await composedCard(), { format: 'jpeg', jpegQuality: 94 })
    const target = path.join(tempDir, 'screenshot.jpg')
    await writeImageFile(target, encoded)

    const metadata = await sharp(target).metadata()
    expect(metadata.format).toBe('jpeg')
    expect(metadata.width).toBe(1440 + 128)
    expect(metadata.height).toBe(810 + 128)
  })
})

describe('WebP export', () => {
  it('encodes a WebP that is much smaller than the PNG', async () => {
    const png = await composedCard()
    const webp = await encodeImage(png, { format: 'webp', jpegQuality: 90 })
    const metadata = await sharp(webp).metadata()

    expect(metadata.format).toBe('webp')
    expect(metadata.width).toBe(1440 + 128)
    expect(metadata.height).toBe(810 + 128)
    expect(webp.length).toBeLessThan(png.length)
  })

  it('keeps the corners the background colour, not black', async () => {
    const webp = await encodeImage(await composedCard(), { format: 'webp', jpegQuality: 92 })
    const image = await raw(webp)
    const corner = image.data[0] * 1
    // The composed card is opaque, so the corner is the white frame; a WebP
    // encoder that dropped alpha would leave it black instead.
    expect(corner).toBeGreaterThan(240)
  })

  it('uses the .webp extension for saved files', () => {
    expect(fileExtension('webp')).toBe('webp')
    expect(buildScreenshotFilename(new Date(2026, 9, 17, 14, 30, 25), 'webp')).toBe(
      'screenshot_2026-10-17_14-30-25.webp'
    )
  })
})

describe('file names', () => {
  it('formats the timestamp as screenshot_2026-10-17_14-30-25', () => {
    const date = new Date(2026, 9, 17, 14, 30, 25)
    expect(formatTimestamp(date)).toBe('2026-10-17_14-30-25')
    expect(buildScreenshotFilename(date, 'png')).toBe('screenshot_2026-10-17_14-30-25.png')
    expect(buildScreenshotFilename(date, 'jpeg')).toBe('screenshot_2026-10-17_14-30-25.jpg')
  })

  it('pads single digit date parts', () => {
    expect(formatTimestamp(new Date(2026, 0, 5, 9, 8, 7))).toBe('2026-01-05_09-08-07')
  })

  it('maps formats to extensions', () => {
    expect(fileExtension('png')).toBe('png')
    expect(fileExtension('jpeg')).toBe('jpg')
  })

  it('avoids overwriting an existing file', () => {
    const taken = new Set(['screenshot.png', 'screenshot_1.png'])
    expect(uniqueFilename('screenshot.png', (name) => taken.has(name))).toBe('screenshot_2.png')
    expect(uniqueFilename('fresh.png', (name) => taken.has(name))).toBe('fresh.png')
  })
})

describe('save directory checks', () => {
  it('accepts a writable folder and reports a missing one', async () => {
    expect(await isDirectoryWritable(tempDir)).toBe(true)
    const nested = path.join(tempDir, 'nested', 'deeper')
    expect(await isDirectoryWritable(nested)).toBe(true)
    expect(await fs.stat(nested)).toBeTruthy()
  })
})

describe('encodeRaster — one encode, straight from the finished pixels', () => {
  /** The composed card as pixels, which is what the save path now holds. */
  async function cardRaster() {
    const settings = { ...defaultSettings(tempDir), frameWidth: 20, cornerRadius: 8, shadowEnabled: false }
    const png = await composeScreenshot(await markerImage(120, 90), composeOptionsFromSettings(settings))
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    return { raster: { data: new Uint8Array(data), width: info.width, height: info.height }, png }
  }

  it('writes a lossless PNG of exactly the same pixels', async () => {
    const { raster, png } = await cardRaster()
    const encoded = await encodeRaster(raster, { format: 'png', jpegQuality: 94 })
    const meta = await sharp(encoded).metadata()
    expect(meta.format).toBe('png')
    expect(meta.width).toBe(raster.width)
    expect(meta.height).toBe(raster.height)

    // Same pixels as the composed PNG: the format change costs nothing in quality.
    const a = await sharp(encoded).removeAlpha().raw().toBuffer()
    const b = await sharp(png).removeAlpha().raw().toBuffer()
    expect(a.equals(b)).toBe(true)
  })

  it('flattens transparency to white for JPEG and never emits alpha', async () => {
    const { raster } = await cardRaster()
    const encoded = await encodeRaster(raster, { format: 'jpeg', jpegQuality: 94 })
    const meta = await sharp(encoded).metadata()
    expect(meta.format).toBe('jpeg')
    expect(meta.hasAlpha).toBeFalsy()
    expect(meta.width).toBe(raster.width)
  })

  it('encodes WebP without alpha at the requested quality', async () => {
    const { raster } = await cardRaster()
    const encoded = await encodeRaster(raster, { format: 'webp', jpegQuality: 90 })
    const meta = await sharp(encoded).metadata()
    expect(meta.format).toBe('webp')
    expect(meta.hasAlpha).toBeFalsy()
  })

  it('clamps a nonsensical JPEG quality instead of failing', async () => {
    const { raster } = await cardRaster()
    const encoded = await encodeRaster(raster, { format: 'jpeg', jpegQuality: 1 })
    const meta = await sharp(encoded).metadata()
    expect(meta.format).toBe('jpeg')
  })
})