import { describe, expect, it } from 'vitest'
import { placeBar } from '../src/shared/selectionChrome'
import type { Rect } from '../src/shared/types'

const viewport = { width: 1920, height: 1080 }
const bar = { width: 230, height: 52 }

describe('placeBar', () => {
  it('puts the bar under the selection when there is room', () => {
    const rect: Rect = { x: 200, y: 200, width: 400, height: 300 }
    const spot = placeBar(rect, viewport, bar)
    expect(spot.inside).toBe(false)
    expect(spot.top).toBe(200 + 300 + 14)
    // Horizontally centred on the selection: 200 + 200 − 115.
    expect(spot.left).toBe(285)
  })

  it('moves the bar above the selection when the bottom edge is close', () => {
    const rect: Rect = { x: 200, y: 700, width: 400, height: 340 }
    const spot = placeBar(rect, viewport, bar)
    expect(spot.inside).toBe(false)
    expect(spot.top).toBe(700 - 14 - 52)
  })

  it('keeps the bar inside the selection when it fills the screen', () => {
    // The case that made the buttons vanish: selecting the whole area used to
    // push the toolbar to y = 1094, past the bottom of a 1080 px screen.
    const rect: Rect = { x: 0, y: 0, width: 1920, height: 1080 }
    const spot = placeBar(rect, viewport, bar)
    expect(spot.inside).toBe(true)
    expect(spot.top).toBe(1080 - 52 - 14)
    expect(spot.top + bar.height).toBeLessThanOrEqual(viewport.height)
    expect(spot.left).toBeGreaterThanOrEqual(0)
    expect(spot.left + bar.width).toBeLessThanOrEqual(viewport.width)
  })

  it('keeps the bar inside a tall selection with no room on either side', () => {
    const rect: Rect = { x: 100, y: 4, width: 600, height: 1072 }
    const spot = placeBar(rect, viewport, bar)
    expect(spot.inside).toBe(true)
    expect(spot.top + bar.height).toBeLessThanOrEqual(viewport.height)
  })

  it('never lets the bar leave the window horizontally', () => {
    for (const x of [0, 960, 1920 - 40]) {
      const spot = placeBar({ x, y: 200, width: 40, height: 200 }, viewport, bar)
      expect(spot.left, `x = ${x}`).toBeGreaterThanOrEqual(0)
      expect(spot.left + bar.width, `x = ${x}`).toBeLessThanOrEqual(viewport.width)
    }
  })

  it('stays inside the selection horizontally when it sits over the picture', () => {
    // A full-width selection: the bar must not be pushed past the screen edges.
    const spot = placeBar({ x: 0, y: 0, width: 1920, height: 1080 }, viewport, bar)
    expect(spot.left).toBeGreaterThanOrEqual(8)
    expect(spot.left + bar.width).toBeLessThanOrEqual(viewport.width - 8)
  })

  it('does not push a tiny selection off the top of the screen', () => {
    const spot = placeBar({ x: 10, y: 10, width: 60, height: 60 }, viewport, bar)
    expect(spot.top).toBeGreaterThanOrEqual(0)
    expect(spot.top + bar.height).toBeLessThanOrEqual(viewport.height)
  })

  it('works for the small size badge as well', () => {
    const spot = placeBar({ x: 0, y: 0, width: 1920, height: 1080 }, viewport, { width: 118, height: 26 }, 12)
    expect(spot.inside).toBe(true)
    expect(spot.top + 26).toBeLessThanOrEqual(viewport.height)
  })

  it('handles a window smaller than the bar without going negative', () => {
    const spot = placeBar({ x: 0, y: 0, width: 100, height: 80 }, { width: 200, height: 120 }, bar)
    expect(spot.left).toBeGreaterThanOrEqual(0)
    expect(spot.top).toBeGreaterThanOrEqual(0)
  })
})
