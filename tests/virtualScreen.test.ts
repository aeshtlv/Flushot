import { describe, expect, it } from 'vitest'
import {
  describeVirtual,
  fullscreenSelection,
  resultHostPlacement,
  selectionToDesktopRect,
  virtualBounds,
  virtualImageSize,
  virtualPlacements,
  virtualScale,
  type ScreenBounds
} from '../src/shared/virtualScreen'

const screen = (id: string, x: number, y: number, width: number, height: number, scaleFactor = 1): ScreenBounds => ({
  id,
  bounds: { x, y, width, height },
  scaleFactor
})

describe('virtual desktop', () => {
  it('treats a single monitor as the whole desktop', () => {
    const screens = [screen('a', 0, 0, 1920, 1080)]
    expect(virtualBounds(screens)).toEqual({ x: 0, y: 0, width: 1920, height: 1080 })
    expect(virtualScale(screens)).toBe(1)
    expect(virtualImageSize(screens, 1)).toEqual({ width: 1920, height: 1080 })
  })

  it('unions monitors placed side by side', () => {
    const screens = [screen('a', 0, 0, 1920, 1080), screen('b', 1920, 0, 2560, 1440)]
    expect(virtualBounds(screens)).toEqual({ x: 0, y: 0, width: 4480, height: 1440 })
  })

  it('handles a monitor placed left of and above the primary one', () => {
    // The real case this was written for: a second screen at y = -1080 and x = 6.
    const screens = [screen('a', 0, 0, 1920, 1080), screen('b', 6, -1080, 1920, 1080)]
    const union = virtualBounds(screens)
    expect(union).toEqual({ x: 0, y: -1080, width: 1926, height: 2160 })

    const placements = virtualPlacements(screens, 1)
    // The primary monitor is not at the top of the union, the second one is.
    expect(placements.find((p) => p.id === 'b')).toMatchObject({ left: 6, top: 0 })
    expect(placements.find((p) => p.id === 'a')).toMatchObject({ left: 0, top: 1080 })
  })

  it('builds the composite at the highest density present, so no screen is downscaled', () => {
    const screens = [screen('a', 0, 0, 1920, 1080, 1), screen('b', 1920, 0, 1280, 720, 1.5)]
    expect(virtualScale(screens)).toBe(1.5)
    // 3200 × 1.5 by 1080 × 1.5.
    expect(virtualImageSize(screens, 1.5)).toEqual({ width: 4800, height: 1620 })
  })

  it('marks only the monitors whose density differs from the composite', () => {
    const screens = [screen('a', 0, 0, 1920, 1080, 1), screen('b', 1920, 0, 1280, 720, 1.5)]
    const placements = virtualPlacements(screens, 1.5)
    expect(placements.find((p) => p.id === 'a')?.resampled).toBe(true)
    expect(placements.find((p) => p.id === 'b')?.resampled).toBe(false)
  })

  it('scales positions along with sizes', () => {
    const screens = [screen('a', 0, 0, 1000, 500, 2), screen('b', 1000, 0, 1000, 500, 2)]
    const placements = virtualPlacements(screens, 2)
    expect(placements.find((p) => p.id === 'b')).toMatchObject({ left: 2000, top: 0, width: 2000, height: 1000 })
  })

  it('describes the desktop as one screen for the overlay', () => {
    const screens = [screen('a', 0, 0, 1920, 1080), screen('b', 6, -1080, 1920, 1080)]
    const descriptor = describeVirtual(screens, { width: 1926, height: 2160 })
    expect(descriptor.id).toBe('virtual')
    expect(descriptor.bounds).toEqual({ x: 0, y: -1080, width: 1926, height: 2160 })
    expect(descriptor.imageWidth).toBe(1926)
    expect(descriptor.label).toContain('2')
    // The individual monitors travel with the descriptor, so the overlay can put
    // the result on exactly one of them.
    expect(descriptor.monitors).toHaveLength(2)
  })

  it('carries the primary flag through to the overlay', () => {
    const screens = [
      { ...screen('a', 0, 0, 1920, 1080), primary: true },
      screen('b', 6, -1080, 1920, 1080)
    ]
    const descriptor = describeVirtual(screens, { width: 1926, height: 2160 })
    expect(descriptor.monitors?.find((m) => m.primary)?.id).toBe('a')
    expect(descriptor.monitors?.filter((m) => m.primary)).toHaveLength(1)
  })

  it('never divides by zero on an empty list', () => {
    expect(virtualBounds([])).toEqual({ x: 0, y: 0, width: 1, height: 1 })
    expect(virtualScale([])).toBe(1)
  })
})

describe('which monitor shows the result', () => {
  const monitors = [
    { id: 'left', bounds: { x: 0, y: 0, width: 1920, height: 1080 }, primary: true },
    { id: 'right', bounds: { x: 1920, y: 0, width: 1920, height: 1080 } }
  ]
  const union = { x: 0, y: 0, width: 3840, height: 1080 }

  it('always uses the primary monitor, whatever was selected', () => {
    // The card used to follow the selection, which made it jump between screens
    // in the middle of a workflow. One fixed place is what people expect.
    expect(resultHostPlacement(monitors, union)?.monitor.id).toBe('left')
  })

  it('expresses the monitor as fractions of the desktop', () => {
    const host = resultHostPlacement(monitors, union)
    // Percentages survive any rounding between DIP and CSS pixels.
    expect(host).toMatchObject({ left: 0, top: 0, width: 0.5, height: 1 })
  })

  it('finds the primary monitor even when it is not the first in the list', () => {
    const reversed = [
      { id: 'right', bounds: { x: 1920, y: 0, width: 1920, height: 1080 } },
      { id: 'left', bounds: { x: 0, y: 0, width: 1920, height: 1080 }, primary: true }
    ]
    expect(resultHostPlacement(reversed, union)?.monitor.id).toBe('left')
  })

  it('places the card correctly when the primary monitor is not at the origin', () => {
    // A monitor above the primary one makes the union start at a negative y.
    const stacked = [
      { id: 'above', bounds: { x: 6, y: -1080, width: 1920, height: 1080 } },
      { id: 'primary', bounds: { x: 0, y: 0, width: 1920, height: 1080 }, primary: true }
    ]
    const stackedUnion = virtualBounds(
      stacked.map((monitor) => ({ id: monitor.id, bounds: monitor.bounds, scaleFactor: 1 }))
    )
    expect(stackedUnion).toEqual({ x: 0, y: -1080, width: 1926, height: 2160 })

    const host = resultHostPlacement(stacked, stackedUnion)
    expect(host?.monitor.id).toBe('primary')
    // The lower half of the desktop. The desktop is 6 px wider than either
    // monitor (the upper one is offset by 6), so the card does not span all of it.
    expect(host).toMatchObject({ top: 0.5, height: 0.5, left: 0 })
    expect(host?.width).toBeCloseTo(1920 / 1926, 6)
  })

  it('falls back to the first monitor when the system reports no primary', () => {
    const withoutPrimary = monitors.map(({ primary, ...rest }) => rest)
    expect(resultHostPlacement(withoutPrimary, union)?.monitor.id).toBe('left')
  })

  it('returns nothing when there is no monitor to choose from', () => {
    expect(resultHostPlacement([], union)).toBeNull()
  })

  it('gives the whole window to a single monitor', () => {
    const single = [{ id: 'only', bounds: { x: 0, y: 0, width: 1920, height: 1080 }, primary: true }]
    expect(resultHostPlacement(single, single[0].bounds)).toMatchObject({
      monitor: { id: 'only' },
      left: 0,
      top: 0,
      width: 1,
      height: 1
    })
  })
})

describe('fullscreenSelection', () => {
  /** The real two-monitor desk this was written on. */
  const desk = describeVirtual(
    [screen('primary', 0, 0, 1920, 1080), screen('above', 6, -1080, 1920, 1080)],
    { width: 1926, height: 2160 }
  )

  it('selects the primary monitor, not the whole desktop', () => {
    // "Весь экран" is the screen in front of the user, not every monitor glued
    // together — a 1926 × 2160 picture of two screens is not what anyone wants.
    const rect = fullscreenSelection(desk, { width: 1926, height: 2160 })
    expect(rect).toEqual({ x: 0, y: 1080, width: 1920, height: 1080 })
  })

  it('fills the window on a single monitor', () => {
    const single = describeVirtual([screen('only', 0, 0, 1920, 1080)], { width: 1920, height: 1080 })
    expect(fullscreenSelection(single, { width: 1920, height: 1080 })).toEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080
    })
  })

  it('covers the whole window even when DIP and CSS pixels disagree', () => {
    // A 150 % monitor: the window is 1280 CSS px wide for a 1920 px screen.
    const scaled = describeVirtual([screen('only', 0, 0, 1920, 1080, 1.5)], { width: 2880, height: 1620 })
    expect(fullscreenSelection(scaled, { width: 1280, height: 720 })).toEqual({
      x: 0,
      y: 0,
      width: 1280,
      height: 720
    })
  })

  it('never returns a selection outside the window', () => {
    // A monitor offset by a few pixels of rounding must not produce a negative
    // origin or a rectangle the user cannot reach.
    const rect = fullscreenSelection(desk, { width: 1926, height: 2159 })
    expect(rect.x).toBeGreaterThanOrEqual(0)
    expect(rect.y).toBeGreaterThanOrEqual(0)
    expect(rect.x + rect.width).toBeLessThanOrEqual(1926)
    expect(rect.y + rect.height).toBeLessThanOrEqual(2159)
  })

  it('falls back to the descriptor bounds when no monitor list is given', () => {
    const plain = {
      id: 'virtual',
      label: 'Экран',
      bounds: { x: 0, y: 0, width: 1600, height: 900 },
      scaleFactor: 1,
      imageWidth: 1600,
      imageHeight: 900
    }
    expect(fullscreenSelection(plain, { width: 1600, height: 900 })).toEqual({
      x: 0,
      y: 0,
      width: 1600,
      height: 900
    })
  })
})

describe('selectionToDesktopRect', () => {
  const union = { x: 0, y: -1080, width: 1926, height: 2160 }

  it('is the identity when the window is exactly the desktop', () => {
    // The usual case: CSS pixels and desktop pixels agree, so the rectangle only
    // has to move by the desktop's own origin — nothing is scaled.
    const square = { x: 0, y: 0, width: 1926, height: 2160 }
    expect(selectionToDesktopRect({ x: 100, y: 200, width: 300, height: 400 }, square, square)).toEqual({
      x: 100,
      y: 200,
      width: 300,
      height: 400
    })
  })

  it('maps back into desktop pixels when the window had to be clamped', () => {
    // A window that could only be opened 963 px wide for a 1926 px desktop: the
    // rectangle is drawn at half scale, and the crop must not be.
    const rect = selectionToDesktopRect(
      { x: 100, y: 100, width: 200, height: 50 },
      { width: 963, height: 1080 },
      union
    )
    expect(rect.width).toBe(400)
    expect(rect.height).toBe(100)
    expect(rect.x).toBe(200)
    // The union's own origin is honoured: the desktop starts above the origin.
    expect(rect.y).toBe(-1080 + 200)
  })

  it('falls back to a one-to-one mapping when the viewport was never reported', () => {
    expect(selectionToDesktopRect({ x: 5, y: 6, width: 7, height: 8 }, undefined, union)).toEqual({
      x: 5,
      y: -1080 + 6,
      width: 7,
      height: 8
    })
  })

  it('refuses to divide by an empty viewport', () => {
    expect(selectionToDesktopRect({ x: 5, y: 6, width: 7, height: 8 }, { width: 0, height: 0 }, union)).toEqual({
      x: 5,
      y: -1080 + 6,
      width: 7,
      height: 8
    })
  })
})
