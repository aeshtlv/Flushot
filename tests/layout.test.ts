import { describe, expect, it } from 'vitest'
import { computeFrameLayout } from '../src/main/imaging/layout'
import { FRAME_WIDTH } from '../src/shared/settings'

const SIZES: { name: string; width: number; height: number }[] = [
  { name: '300×270', width: 300, height: 270 },
  { name: '640×480', width: 640, height: 480 },
  { name: '1280×720', width: 1280, height: 720 },
  { name: '1920×1080', width: 1920, height: 1080 },
  { name: '3840×2160', width: 3840, height: 2160 },
  { name: '3440×1440 (ultrawide)', width: 3440, height: 1440 },
  { name: '1080×1920 (portrait)', width: 1080, height: 1920 },
  { name: '500×1500 (tall strip)', width: 500, height: 1500 },
  { name: '37×19 (tiny)', width: 37, height: 19 }
]

describe('computeFrameLayout', () => {
  it('sizes the canvas as the screenshot plus the frame on all sides', () => {
    const layout = computeFrameLayout(800, 600, 64)
    expect(layout.canvasWidth).toBe(800 + 128)
    expect(layout.canvasHeight).toBe(600 + 128)
    expect(layout.x).toBe(64)
    expect(layout.y).toBe(64)
    expect(layout.frame).toBe(64)
  })

  it('accepts any size: the output is never forced to 1920×1080', () => {
    for (const size of SIZES) {
      const layout = computeFrameLayout(size.width, size.height, 64)
      expect(layout.width, size.name).toBe(size.width)
      expect(layout.height, size.name).toBe(size.height)
      expect(layout.canvasWidth, size.name).toBe(size.width + 128)
      expect(layout.canvasHeight, size.name).toBe(size.height + 128)
    }
    // A small selection stays small: no upscale, no fixed canvas.
    expect(computeFrameLayout(300, 270, 64).canvasWidth).toBe(428)
  })

  it('never resamples the screenshot', () => {
    for (const size of SIZES) {
      const layout = computeFrameLayout(size.width, size.height, 40)
      expect(layout.scale, size.name).toBe(1)
    }
    // Same rule for a capture far larger than the old 1920×1080 canvas.
    const huge = computeFrameLayout(3840, 2160, 40)
    expect(huge.width).toBe(3840)
    expect(huge.height).toBe(2160)
    expect(huge.scale).toBe(1)
  })

  it('puts the frame on every side, and the screenshot in the middle', () => {
    for (const size of SIZES) {
      const layout = computeFrameLayout(size.width, size.height, 24)
      const left = layout.x
      const right = layout.canvasWidth - layout.x - layout.width
      const top = layout.y
      const bottom = layout.canvasHeight - layout.y - layout.height
      expect(left, size.name).toBe(24)
      expect(right, size.name).toBe(24)
      expect(top, size.name).toBe(24)
      expect(bottom, size.name).toBe(24)
    }
  })

  it('keeps the source aspect ratio exactly', () => {
    for (const size of SIZES) {
      const layout = computeFrameLayout(size.width, size.height, 64)
      const sourceRatio = size.width / size.height
      const cardRatio = layout.width / layout.height
      expect(Math.abs(sourceRatio - cardRatio) / sourceRatio, size.name).toBeLessThan(0.01)
    }
  })

  it('uses the default frame when none is given', () => {
    const layout = computeFrameLayout(400, 300)
    expect(layout.frame).toBe(FRAME_WIDTH)
    expect(layout.canvasWidth).toBe(400 + FRAME_WIDTH * 2)
  })

  it('supports a frame of zero, which gives a plain screenshot', () => {
    const layout = computeFrameLayout(1024, 768, 0)
    expect(layout.frame).toBe(0)
    expect(layout.canvasWidth).toBe(1024)
    expect(layout.canvasHeight).toBe(768)
    expect(layout.x).toBe(0)
    expect(layout.y).toBe(0)
  })

  it('never produces a negative frame from bad input', () => {
    expect(computeFrameLayout(400, 300, -20).frame).toBe(0)
    expect(computeFrameLayout(400, 300, Number.NaN).frame).toBe(0)
    // A fractional frame is rounded down to whole pixels.
    expect(computeFrameLayout(400, 300, 10.9).frame).toBe(10)
  })

  it('rejects invalid sizes instead of producing a broken canvas', () => {
    expect(() => computeFrameLayout(0, 100)).toThrow()
    expect(() => computeFrameLayout(Number.NaN, 100)).toThrow()
    expect(() => computeFrameLayout(-10, -10)).toThrow()
  })

  it('uses a subtle corner radius that never exceeds half the picture', () => {
    for (const size of SIZES) {
      const layout = computeFrameLayout(size.width, size.height, 64)
      expect(layout.cornerRadius, size.name).toBeGreaterThan(0)
      expect(layout.cornerRadius, size.name).toBeLessThanOrEqual(Math.min(layout.width, layout.height) / 2)
      expect(layout.cornerRadius, size.name).toBeLessThanOrEqual(12)
    }
  })

  it('honours a configured corner radius, including square corners', () => {
    expect(computeFrameLayout(400, 300, 64, 0).cornerRadius).toBe(0)
    expect(computeFrameLayout(400, 300, 64, 8).cornerRadius).toBe(8)
    expect(computeFrameLayout(400, 300, 64, 24).cornerRadius).toBe(24)
  })

  it('never lets the radius eat more than a quarter of the shorter side', () => {
    // A 100 px tall picture cannot carry a 40 px radius: it is capped at 25.
    expect(computeFrameLayout(800, 100, 0, 40).cornerRadius).toBe(25)
    // A configured 24 px radius is still respected on a normal picture.
    expect(computeFrameLayout(400, 300, 64, 24).cornerRadius).toBe(24)
    const small = computeFrameLayout(40, 40, 0, 24)
    expect(small.cornerRadius).toBe(10)
  })

  it('falls back to a sane radius for bad input', () => {
    expect(computeFrameLayout(400, 300, 64, Number.NaN).cornerRadius).toBe(12)
    expect(computeFrameLayout(400, 300, 64, -10).cornerRadius).toBe(0)
  })
})
