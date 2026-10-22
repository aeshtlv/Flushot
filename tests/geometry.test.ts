import { describe, expect, it } from 'vitest'
import {
  clampRectToBounds,
  isUsableSelection,
  normalizeRect,
  selectionPixelSize,
  selectionToImageRect,
  type DisplayGeometry
} from '../src/shared/geometry'

/** Windows display scaling presets and the resulting physical resolution. */
const SCENARIOS: { name: string; bounds: { width: number; height: number }; scale: number; image: { width: number; height: number } }[] = [
  { name: '1920×1080 @ 100%', bounds: { width: 1920, height: 1080 }, scale: 1, image: { width: 1920, height: 1080 } },
  { name: '1920×1080 @ 125%', bounds: { width: 1536, height: 864 }, scale: 1.25, image: { width: 1920, height: 1080 } },
  { name: '1920×1080 @ 150%', bounds: { width: 1280, height: 720 }, scale: 1.5, image: { width: 1920, height: 1080 } },
  { name: '2560×1440 @ 150%', bounds: { width: 1707, height: 960 }, scale: 1.5, image: { width: 2560, height: 1440 } },
  { name: '3840×2160 @ 200%', bounds: { width: 1920, height: 1080 }, scale: 2, image: { width: 3840, height: 2160 } },
  { name: '1366×768 @ 100%', bounds: { width: 1366, height: 768 }, scale: 1, image: { width: 1366, height: 768 } },
  { name: '2560×1080 @ 100%', bounds: { width: 2560, height: 1080 }, scale: 1, image: { width: 2560, height: 1080 } }
]

function geometryOf(scenario: (typeof SCENARIOS)[number]): DisplayGeometry {
  return {
    bounds: { x: 0, y: 0, ...scenario.bounds },
    imageWidth: scenario.image.width,
    imageHeight: scenario.image.height,
    scaleFactor: scenario.scale
  }
}

describe('normalizeRect', () => {
  it('handles dragging in every direction', () => {
    expect(normalizeRect({ x: 100, y: 100 }, { x: 20, y: 40 })).toEqual({ x: 20, y: 40, width: 80, height: 60 })
    expect(normalizeRect({ x: 20, y: 40 }, { x: 100, y: 100 })).toEqual({ x: 20, y: 40, width: 80, height: 60 })
    expect(normalizeRect({ x: 10, y: 10 }, { x: 10, y: 10 })).toEqual({ x: 10, y: 10, width: 0, height: 0 })
  })
})

describe('clampRectToBounds', () => {
  it('keeps a selection inside the display', () => {
    expect(clampRectToBounds({ x: -20, y: -5, width: 200, height: 100 }, { x: 0, y: 0, width: 100, height: 100 })).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 95
    })
  })
})

describe('selectionToImageRect (Windows DPI scaling)', () => {
  it('is identity at 100% for a full-screen selection', () => {
    const scenario = SCENARIOS[0]
    expect(selectionToImageRect({ x: 0, y: 0, width: 1920, height: 1080 }, geometryOf(scenario))).toEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080
    })
  })

  it('maps CSS pixels to physical pixels at 125%, 150% and 200%', () => {
    for (const scenario of SCENARIOS) {
      const geometry = geometryOf(scenario)
      const rect = selectionToImageRect({ x: 100, y: 50, width: 300, height: 200 }, geometry)
      expect(rect.x, scenario.name).toBe(Math.round(100 * scenario.scale))
      expect(rect.y, scenario.name).toBe(Math.round(50 * scenario.scale))
      expect(rect.width, scenario.name).toBe(Math.round(300 * scenario.scale))
      expect(rect.height, scenario.name).toBe(Math.round(200 * scenario.scale))
    }
  })

  it('maps a full-screen selection to the entire physical image', () => {
    for (const scenario of SCENARIOS) {
      const geometry = geometryOf(scenario)
      const rect = selectionToImageRect(
        { x: 0, y: 0, width: scenario.bounds.width, height: scenario.bounds.height },
        geometry
      )
      expect(rect, scenario.name).toEqual({ x: 0, y: 0, width: scenario.image.width, height: scenario.image.height })
    }
  })

  it('never returns coordinates outside the screenshot', () => {
    for (const scenario of SCENARIOS) {
      const geometry = geometryOf(scenario)
      const rect = selectionToImageRect({ x: -50, y: -50, width: 99999, height: 99999 }, geometry)
      expect(rect.x, scenario.name).toBeGreaterThanOrEqual(0)
      expect(rect.y, scenario.name).toBeGreaterThanOrEqual(0)
      expect(rect.x + rect.width, scenario.name).toBeLessThanOrEqual(scenario.image.width)
      expect(rect.y + rect.height, scenario.name).toBeLessThanOrEqual(scenario.image.height)
    }
  })

  it('handles fractional DPI ratios such as 2560×1440 at 150%', () => {
    const geometry: DisplayGeometry = {
      bounds: { x: 0, y: 0, width: 1706.666, height: 960 },
      imageWidth: 2560,
      imageHeight: 1440,
      scaleFactor: 1.5
    }
    const rect = selectionToImageRect({ x: 0, y: 0, width: 1706.666, height: 960 }, geometry)
    expect(rect).toEqual({ x: 0, y: 0, width: 2560, height: 1440 })
  })

  it('reports the on-screen pixel size of the selection', () => {
    const size = selectionPixelSize(
      { x: 0, y: 0, width: 640, height: 360 },
      { bounds: { x: 0, y: 0, width: 1280, height: 720 }, imageWidth: 1920, imageHeight: 1080, scaleFactor: 1.5 }
    )
    expect(size).toEqual({ width: 960, height: 540 })
  })

  it('rejects broken display geometry', () => {
    expect(() =>
      selectionToImageRect({ x: 0, y: 0, width: 10, height: 10 }, { bounds: { x: 0, y: 0, width: 0, height: 0 }, imageWidth: 10, imageHeight: 10, scaleFactor: 1 })
    ).toThrow()
  })
})

describe('isUsableSelection', () => {
  it('rejects clicks and jitter', () => {
    expect(isUsableSelection({ x: 0, y: 0, width: 1, height: 1 })).toBe(false)
    expect(isUsableSelection({ x: 0, y: 0, width: 8, height: 8 })).toBe(true)
  })
})
