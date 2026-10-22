import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { composeOptionsFromSettings, composeScreenshot, cropImage, parseHexColor } from '../src/main/imaging/compose'
import { computeFrameLayout } from '../src/main/imaging/layout'
import { defaultSettings } from '../src/shared/settings'
import type { ScreenshotSettings } from '../src/shared/types'
import { colorDistance, markerImage, pixel, raw, solidImage } from './helpers'

function settingsWith(patch: Partial<ScreenshotSettings> = {}): ScreenshotSettings {
  return { ...defaultSettings('C:\\Users\\Test\\Pictures\\Flushot'), theme: 'light', ...patch }
}

const WHITE = parseHexColor('#FFFFFF')

describe('composeScreenshot — frame', () => {
  it('outputs the screenshot size plus the frame, whatever the size is', async () => {
    for (const [width, height] of [
      [320, 200],
      [640, 480],
      [1280, 720],
      [1920, 1080],
      [3840, 2160]
    ]) {
      const image = await solidImage(width, height, '#3366CC')
      const png = await composeScreenshot(image, composeOptionsFromSettings(settingsWith()))
      const metadata = await sharp(png).metadata()
      expect(metadata.width, `${width}×${height}`).toBe(width + 128)
      expect(metadata.height, `${width}×${height}`).toBe(height + 128)
      expect(metadata.format).toBe('png')
    }
  })

  it('keeps a small capture small instead of blowing it up to a fixed canvas', async () => {
    const image = await solidImage(300, 270, '#3366CC')
    const png = await composeScreenshot(image, composeOptionsFromSettings(settingsWith()))
    const metadata = await sharp(png).metadata()
    expect(metadata.width).toBe(428)
    expect(metadata.height).toBe(398)
  })

  it('follows the frame width setting, including zero', async () => {
    const image = await solidImage(800, 600, '#3366CC')

    for (const frameWidth of [0, 12, 64, 200]) {
      const png = await composeScreenshot(image, composeOptionsFromSettings(settingsWith({ frameWidth, shadowEnabled: false })))
      const metadata = await sharp(png).metadata()
      expect(metadata.width, `frame ${frameWidth}`).toBe(800 + frameWidth * 2)
      expect(metadata.height, `frame ${frameWidth}`).toBe(600 + frameWidth * 2)
    }
  })

  it('fills the frame with pure #FFFFFF by default', async () => {
    const image = await solidImage(800, 600, '#3366CC')
    const png = await composeScreenshot(image, composeOptionsFromSettings(settingsWith()))
    const composed = await raw(png)

    for (const [x, y] of [
      [0, 0],
      [927, 0],
      [0, 727],
      [927, 727],
      [20, 364],
      [907, 364]
    ]) {
      expect(pixel(composed, x, y).r, `pixel ${x},${y}`).toBe(WHITE.r)
      expect(pixel(composed, x, y).g, `pixel ${x},${y}`).toBe(WHITE.g)
      expect(pixel(composed, x, y).b, `pixel ${x},${y}`).toBe(WHITE.b)
    }
  })

  it('supports a light grey and a custom frame colour', async () => {
    const image = await solidImage(800, 600, '#3366CC')

    const grey = await raw(await composeScreenshot(image, composeOptionsFromSettings(settingsWith({ backgroundPreset: 'gray' }))))
    expect(pixel(grey, 4, 4)).toMatchObject({ r: 0xf2, g: 0xf2, b: 0xf7 })

    const custom = await raw(
      await composeScreenshot(
        image,
        composeOptionsFromSettings(settingsWith({ backgroundPreset: 'custom', backgroundColor: '#101418' }))
      )
    )
    expect(pixel(custom, 4, 4)).toMatchObject({ r: 0x10, g: 0x14, b: 0x18 })
  })

  it('surrounds the screenshot evenly on all four sides', async () => {
    const image = await markerImage(1200, 900)
    const png = await composeScreenshot(image, composeOptionsFromSettings(settingsWith()))
    const composed = await raw(png)
    const layout = computeFrameLayout(1200, 900, 64)

    // Just inside the picture the marker colours must be present, sampled past
    // the rounded corner so the mask does not blend into the frame.
    const inner = layout.cornerRadius + 4
    expect(colorDistance(pixel(composed, layout.x + inner, layout.y + inner), { r: 0xff, g: 0x00, b: 0x00 })).toBeLessThan(60)
    expect(
      colorDistance(pixel(composed, layout.x + layout.width - inner, layout.y + inner), { r: 0x00, g: 0xff, b: 0x00 })
    ).toBeLessThan(60)
    expect(
      colorDistance(pixel(composed, layout.x + inner, layout.y + layout.height - inner), { r: 0x00, g: 0x00, b: 0xff })
    ).toBeLessThan(60)
    expect(
      colorDistance(
        pixel(composed, layout.x + layout.width - inner, layout.y + layout.height - inner),
        { r: 0xff, g: 0xff, b: 0x00 }
      )
    ).toBeLessThan(60)

    // Equal margins on every side: that is what "frame" means here.
    expect(layout.x).toBe(64)
    expect(layout.y).toBe(64)
    expect(layout.canvasWidth - layout.x - layout.width).toBe(64)
    expect(layout.canvasHeight - layout.y - layout.height).toBe(64)
  })

  it('does not crop the selection: every corner marker survives', async () => {
    const image = await markerImage(2000, 1000)
    const png = await composeScreenshot(image, composeOptionsFromSettings(settingsWith({ shadowEnabled: false })))
    const composed = await raw(png)
    const layout = computeFrameLayout(2000, 1000, 64)

    // Sampled past the rounded corner, which is clipped by design.
    const inset = layout.cornerRadius + 6
    const samples = [
      { point: { x: layout.x + inset, y: layout.y + inset }, expected: { r: 255, g: 0, b: 0 } },
      { point: { x: layout.x + layout.width - inset, y: layout.y + inset }, expected: { r: 0, g: 255, b: 0 } },
      { point: { x: layout.x + inset, y: layout.y + layout.height - inset }, expected: { r: 0, g: 0, b: 255 } },
      {
        point: { x: layout.x + layout.width - inset, y: layout.y + layout.height - inset },
        expected: { r: 255, g: 255, b: 0 }
      }
    ]
    for (const sample of samples) {
      expect(colorDistance(pixel(composed, sample.point.x, sample.point.y), sample.expected)).toBeLessThan(60)
    }
  })

  it('preserves non 16:9 aspect ratios without stretching', async () => {
    const source = await markerImage(900, 1400)
    const png = await composeScreenshot(source, composeOptionsFromSettings(settingsWith({ shadowEnabled: false })))
    const composed = await raw(png)
    const layout = computeFrameLayout(900, 1400, 64)

    // Find the horizontal extent of non-white pixels on the picture centre row.
    const centreRow = layout.y + Math.round(layout.height / 2)
    let left = -1
    let right = -1
    for (let x = 0; x < layout.canvasWidth; x++) {
      const value = pixel(composed, x, centreRow)
      if (colorDistance(value, WHITE) > 12) {
        if (left === -1) left = x
        right = x
      }
    }
    expect(Math.abs(right - left + 1 - layout.width)).toBeLessThanOrEqual(2)
    expect(layout.width / layout.height).toBeCloseTo(900 / 1400, 2)
  })

  it('adds a rounded-corner mask to the picture', async () => {
    const image = await solidImage(1000, 700, '#FF0000')
    const png = await composeScreenshot(image, composeOptionsFromSettings(settingsWith({ shadowEnabled: false })))
    const composed = await raw(png)
    const layout = computeFrameLayout(1000, 700, 64)

    // The extreme corner of the picture is clipped, the centre is not.
    expect(colorDistance(pixel(composed, layout.x + 1, layout.y + 1), WHITE)).toBeLessThan(90)
    expect(pixel(composed, layout.x + Math.round(layout.width / 2), layout.y + Math.round(layout.height / 2)).r).toBeGreaterThan(240)
  })

  it('draws a macOS-style shadow that can be disabled', async () => {
    const image = await solidImage(1000, 700, '#FFFFFF')
    const layout = computeFrameLayout(1000, 700, 64)
    const probe = { x: layout.x + Math.round(layout.width / 2), y: layout.y + layout.height + 10 }

    const withShadow = await raw(
      await composeScreenshot(image, composeOptionsFromSettings(settingsWith({ shadowEnabled: true, shadowIntensity: 30, shadowBlur: 30 })))
    )
    const withoutShadow = await raw(
      await composeScreenshot(image, composeOptionsFromSettings(settingsWith({ shadowEnabled: false })))
    )

    const shadowPixel = pixel(withShadow, probe.x, probe.y)
    const flatPixel = pixel(withoutShadow, probe.x, probe.y)

    expect(colorDistance(shadowPixel, WHITE)).toBeGreaterThan(10)
    expect(colorDistance(flatPixel, WHITE)).toBeLessThan(2)
    expect(shadowPixel.r).toBeLessThan(flatPixel.r)
  })

  it('respects the shadow intensity setting', async () => {
    const image = await solidImage(1000, 700, '#FFFFFF')
    const layout = computeFrameLayout(1000, 700, 64)
    const probe = { x: layout.x + Math.round(layout.width / 2), y: layout.y + layout.height + 8 }

    const light = await raw(
      await composeScreenshot(image, composeOptionsFromSettings(settingsWith({ shadowIntensity: 8, shadowBlur: 24 })))
    )
    const strong = await raw(
      await composeScreenshot(image, composeOptionsFromSettings(settingsWith({ shadowIntensity: 55, shadowBlur: 24 })))
    )

    expect(pixel(strong, probe.x, probe.y).r).toBeLessThan(pixel(light, probe.x, probe.y).r)
  })

  /** Deepest darkening the shadow applies to the background just below the picture. */
  async function shadowDarkening(width: number, height: number, shadowIntensity: number, blur = 26): Promise<number> {
    const image = await solidImage(width, height, '#FFFFFF')
    const layout = computeFrameLayout(width, height, 64)
    const x = layout.x + Math.round(layout.width / 2)

    const withShadow = await raw(
      await composeScreenshot(
        image,
        composeOptionsFromSettings(settingsWith({ shadowEnabled: true, shadowIntensity, shadowBlur: blur }))
      )
    )
    const without = await raw(
      await composeScreenshot(image, composeOptionsFromSettings(settingsWith({ shadowEnabled: false })))
    )

    let max = 0
    const bottom = Math.min(layout.canvasHeight - 1, layout.y + layout.height + 60)
    for (let y = layout.y + layout.height; y < bottom; y++) {
      const darkening = pixel(without, x, y).r - pixel(withShadow, x, y).r
      if (darkening > max) max = darkening
    }
    return max
  }

  it('keeps the shadow a soft translucent gradient, never a black slab', async () => {
    const darkening = await shadowDarkening(1000, 700, 30)

    // A 30% shadow over white can darken it by at most ~77 levels; the visible
    // peak right under the picture is roughly half of that because of the blur.
    expect(darkening).toBeGreaterThan(6)
    expect(darkening).toBeLessThan(120)
  })

  it('scales the shadow linearly with the intensity setting', async () => {
    const light = await shadowDarkening(1000, 700, 10)
    const strong = await shadowDarkening(1000, 700, 50)
    const ratio = strong / Math.max(1, light)

    // Five times the opacity must be several times darker. A mask scaled to full
    // alpha saturates and yields the same value for both settings.
    expect(ratio).toBeGreaterThan(3)
    expect(ratio).toBeLessThan(8)
  })

  it('fades the shadow out with distance from the picture', async () => {
    const image = await solidImage(1000, 700, '#FFFFFF')
    const layout = computeFrameLayout(1000, 700, 64)
    const x = layout.x + Math.round(layout.width / 2)
    const withShadow = await raw(
      await composeScreenshot(image, composeOptionsFromSettings(settingsWith({ shadowIntensity: 40, shadowBlur: 30 })))
    )

    const near = pixel(withShadow, x, layout.y + layout.height + 2).r
    const far = pixel(withShadow, x, layout.y + layout.height + 55).r

    // A real gradient: near the picture is darker than far below it.
    expect(near).toBeLessThan(far)
    expect(far - near).toBeGreaterThan(4)
  })

  it('keeps the shadow inside the frame instead of bleeding over the edge', async () => {
    // A narrow frame cannot host a wide blur, so the shadow must be squeezed.
    const image = await solidImage(1000, 700, '#FFFFFF')
    const layout = computeFrameLayout(1000, 700, 10)
    const composed = await raw(
      await composeScreenshot(
        image,
        composeOptionsFromSettings(settingsWith({ frameWidth: 10, shadowIntensity: 60, shadowBlur: 48 }))
      )
    )

    // The outermost row and column of the output stay the pure frame colour.
    for (let x = 0; x < layout.canvasWidth; x += 37) {
      expect(colorDistance(pixel(composed, x, 0), WHITE), `top ${x}`).toBeLessThan(2)
      expect(colorDistance(pixel(composed, x, layout.canvasHeight - 1), WHITE), `bottom ${x}`).toBeLessThan(2)
    }
  })

  it('skips the shadow entirely when the frame is zero', async () => {
    const image = await solidImage(120, 90, '#3366CC')
    const composed = await raw(
      await composeScreenshot(
        image,
        composeOptionsFromSettings(settingsWith({ frameWidth: 0, shadowEnabled: true, shadowIntensity: 60 }))
      )
    )
    const metadata = { width: 120, height: 90 }
    expect(composed.width).toBe(metadata.width)
    expect(composed.height).toBe(metadata.height)
    // Corner pixel is the picture itself, not a shadowed background.
    expect(colorDistance(pixel(composed, 60, 45), { r: 0x33, g: 0x66, b: 0xcc })).toBeLessThan(4)
  })

  it('never resamples the screenshot: pixels stay 1:1', async () => {
    // A one-pixel checkerboard survives only if nothing is scaled.
    const size = 60
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
    const composed = await raw(await composeScreenshot(png, composeOptionsFromSettings(settingsWith({ shadowEnabled: false }))))
    const layout = computeFrameLayout(size, size, 64)

    // Sampled away from the rounded corner, which is clipped by design.
    for (const [x, y] of [
      [30, 3],
      [31, 3],
      [31, 4],
      [7, 13]
    ]) {
      const expected = (x + y) % 2 === 0 ? 0 : 255
      expect(pixel(composed, layout.x + x, layout.y + y).r, `${x},${y}`).toBe(expected)
    }
  })
})

describe('cropImage', () => {
  it('extracts exactly the requested region', async () => {
    const image = await markerImage(800, 600)
    const cropped = await cropImage(image, { x: 100, y: 50, width: 320, height: 240 })
    const metadata = await sharp(cropped).metadata()
    expect(metadata.width).toBe(320)
    expect(metadata.height).toBe(240)
  })

  it('clamps a region that overflows the screenshot', async () => {
    const image = await solidImage(800, 600, '#00FF00')
    const cropped = await cropImage(image, { x: 700, y: 500, width: 500, height: 500 })
    const metadata = await sharp(cropped).metadata()
    expect(metadata.width).toBe(100)
    expect(metadata.height).toBe(100)
  })
})
