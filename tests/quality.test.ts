import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { composeOptionsFromSettings, composeScreenshot, makePreview } from '../src/main/imaging/compose'
import { computeFrameLayout } from '../src/main/imaging/layout'
import { defaultSettings } from '../src/shared/settings'
import type { ScreenshotSettings } from '../src/shared/types'
import { markerImage, raw, solidImage } from './helpers'

function settingsWith(patch: Partial<ScreenshotSettings> = {}): ScreenshotSettings {
  return { ...defaultSettings('C:\\Users\\Test\\Pictures\\Flushot'), theme: 'light', ...patch }
}

/** Largest per-channel difference between the picture and the source crop. */
async function maxDifference(source: Buffer, composed: Buffer, frame: number): Promise<number> {
  const width = (await sharp(source).metadata()).width ?? 0
  const height = (await sharp(source).metadata()).height ?? 0
  const layout = computeFrameLayout(width, height, frame)
  const a = await raw(source)
  const b = await raw(composed)

  let max = 0
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      // The rounded corners are clipped by the mask on purpose, so they are not
      // part of the fidelity guarantee.
      const cornerX = x < layout.cornerRadius + 2 || x >= a.width - layout.cornerRadius - 2
      const cornerY = y < layout.cornerRadius + 2 || y >= a.height - layout.cornerRadius - 2
      if (cornerX && cornerY) continue

      const ai = (y * a.width + x) * a.channels
      const bi = ((y + layout.y) * b.width + (x + layout.x)) * b.channels
      for (let channel = 0; channel < 3; channel++) {
        const diff = Math.abs(b.data[bi + channel] - a.data[ai + channel])
        if (diff > max) max = diff
      }
    }
  }
  return max
}

describe('quality: the picture is never resampled', () => {
  it('keeps every pixel identical to the crop, with the shadow on', async () => {
    const source = await markerImage(640, 400)
    const composed = await composeScreenshot(
      source,
      composeOptionsFromSettings(settingsWith({ frameWidth: 64, shadowEnabled: true }))
    )
    expect(await maxDifference(source, composed, 64)).toBe(0)
  })

  it('keeps every pixel identical on a large capture too', async () => {
    const source = await markerImage(2400, 1400)
    const composed = await composeScreenshot(
      source,
      composeOptionsFromSettings(settingsWith({ frameWidth: 24, shadowEnabled: true }))
    )
    expect(await maxDifference(source, composed, 24)).toBe(0)
  })

  it('keeps single-pixel detail: a 1 px checkerboard survives untouched', async () => {
    const size = 120
    const data = Buffer.alloc(size * size * 4)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const offset = (y * size + x) * 4
        const value = (x + y) % 2 === 0 ? 0 : 255
        data[offset] = value
        data[offset + 1] = value
        data[offset + 2] = value
        data[offset + 3] = 255
      }
    }
    const png = await sharp(data, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer()
    const composed = await composeScreenshot(
      png,
      composeOptionsFromSettings(settingsWith({ frameWidth: 32, shadowEnabled: false }))
    )
    expect(await maxDifference(png, composed, 32)).toBe(0)
  })
})

describe('quality: result preview', () => {
  it('renders at the requested width instead of a fixed 720 px', async () => {
    const png = await composeScreenshot(
      await solidImage(1600, 1000, '#3366CC'),
      composeOptionsFromSettings(settingsWith({ frameWidth: 64 }))
    )

    for (const width of [480, 1080, 1587, 2048]) {
      const preview = await makePreview(png, width)
      const buffer = Buffer.from(preview.split(',')[1], 'base64')
      const metadata = await sharp(buffer).metadata()
      expect(metadata.width, `asked ${width}`).toBe(Math.min(width, 1728))
      // The preview keeps the aspect ratio of the composed image.
      expect(metadata.width! / metadata.height!).toBeCloseTo(1728 / 1128, 2)
    }
  })

  it('never upscales a small result', async () => {
    const png = await composeScreenshot(
      await solidImage(300, 270, '#3366CC'),
      composeOptionsFromSettings(settingsWith({ frameWidth: 64 }))
    )
    const preview = await makePreview(png, 1587)
    const buffer = Buffer.from(preview.split(',')[1], 'base64')
    const metadata = await sharp(buffer).metadata()
    expect(metadata.width).toBe(428)
    expect(metadata.height).toBe(398)
  })

  it('clamps an absurd request instead of allocating a huge buffer', async () => {
    const png = await composeScreenshot(
      await solidImage(400, 300, '#3366CC'),
      composeOptionsFromSettings(settingsWith({ frameWidth: 0 }))
    )
    const preview = await makePreview(png, 999999)
    const buffer = Buffer.from(preview.split(',')[1], 'base64')
    // The source is smaller than the cap, so it stays at its own size.
    expect((await sharp(buffer).metadata()).width).toBe(400)
  })
})
