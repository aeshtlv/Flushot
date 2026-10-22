import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { choosePngPolicy, flatness } from '../src/main/imaging/pngPolicy'
import type { Raster } from '../src/main/imaging/raster'

/** A raster of flat colour: what a screenshot of a panel looks like. */
function flatRaster(width: number, height: number, value = 250): Raster {
  const data = new Uint8Array(width * height * 4)
  for (let index = 0; index < data.length; index += 4) {
    data[index] = value
    data[index + 1] = value
    data[index + 2] = value
    data[index + 3] = 255
  }
  return { data, width, height }
}

/** Every pixel a different colour: a photo, a video, dithering. */
function noisyRaster(width: number, height: number): Raster {
  const data = new Uint8Array(width * height * 4)
  let seed = 12345
  for (let index = 0; index < data.length; index += 4) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    data[index] = seed & 0xff
    data[index + 1] = (seed >>> 8) & 0xff
    data[index + 2] = (seed >>> 16) & 0xff
    data[index + 3] = 255
  }
  return { data, width, height }
}

/** Flat background with a few dark glyph runs, like text on a page. */
function textRaster(width: number, height: number): Raster {
  const raster = flatRaster(width, height, 252)
  let seed = 7
  for (let line = 0; line < 200; line++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    const x = seed % (width - 40)
    const y = (seed >>> 8) % height
    for (let glyph = 0; glyph < 30; glyph++) {
      const index = (y * width + x + glyph) * 4
      raster.data[index] = 30
      raster.data[index + 1] = 30
      raster.data[index + 2] = 34
    }
  }
  return raster
}

describe('pngPolicy — choosing how to encode the finished card', () => {
  it('measures flat content as flat', () => {
    expect(flatness(flatRaster(200, 100))).toBe(1)
  })

  it('measures noise as not flat', () => {
    expect(flatness(noisyRaster(200, 100))).toBeLessThan(0.05)
  })

  it('measures text on a flat page as mostly flat', () => {
    // Real screenshots sit here: large empty areas and dense glyph runs.
    const value = flatness(textRaster(600, 400))
    expect(value).toBeGreaterThan(0.8)
    expect(value).toBeLessThan(1)
  })

  it('uses a fixed filter for screenshots and per-row filtering for noise', () => {
    const screenshot = choosePngPolicy(textRaster(400, 300))
    expect(screenshot.adaptiveFiltering).toBe(false)
    expect(screenshot.compressionLevel).toBe(5)

    const photo = choosePngPolicy(noisyRaster(400, 300))
    expect(photo.adaptiveFiltering).toBe(true)
  })

  it('keeps the slow path near the threshold, not far from it', () => {
    // The measured gap between real screenshots (74–82 % flat) and noise (≤14 %)
    // is wide; the threshold sits in the middle so neither case is ever close.
    const borderline = flatRaster(400, 300)
    // Half the rows replaced with noise: flatness lands around 50 %.
    const noise = noisyRaster(400, 300)
    borderline.data.set(noise.data.subarray(0, Math.floor(noise.data.length / 2)), 0)
    const value = flatness(borderline)
    expect(value).toBeGreaterThan(0.35)
    expect(value).toBeLessThan(0.65)
    expect(choosePngPolicy(borderline).adaptiveFiltering).toBe(true)
  })

  it('produces the same pixels with either filter', async () => {
    // Lossless is the point: the policy may only change time and file size.
    const raster = textRaster(320, 200)
    const encode = (adaptiveFiltering: boolean) =>
      sharp(Buffer.from(raster.data.buffer, raster.data.byteOffset, raster.data.byteLength), {
        raw: { width: raster.width, height: raster.height, channels: 4 }
      })
        .removeAlpha()
        .png({ compressionLevel: 5, adaptiveFiltering })
        .toBuffer()

    const fixed = await encode(false)
    const adaptive = await encode(true)
    const a = await sharp(fixed).raw().toBuffer()
    const b = await sharp(adaptive).raw().toBuffer()
    expect(a.equals(b)).toBe(true)
  })

  it('survives a one-pixel raster instead of dividing by zero', () => {
    expect(flatness({ data: new Uint8Array(4), width: 1, height: 1 })).toBe(0)
    expect(choosePngPolicy({ data: new Uint8Array(4), width: 1, height: 1 }).adaptiveFiltering).toBe(true)
  })
})
