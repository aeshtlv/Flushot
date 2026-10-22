import { describe, expect, it } from 'vitest'
import { clampZoom, fitZoom, needsZoom, stepZoom, zoomLabel, MIN_ZOOM } from '../src/shared/zoom'

const picture = (width: number, height: number): { width: number; height: number } => ({ width, height })

describe('fitting a picture to the monitor', () => {
  it('keeps a small capture at 100 %, so it is never blown up and softened', () => {
    expect(fitZoom(picture(400, 300), { width: 1800, height: 800 })).toBe(1)
  })

  it('fits an exactly matching picture without shrinking it', () => {
    expect(fitZoom(picture(1200, 700), { width: 1200, height: 700 })).toBe(1)
  })

  it('shrinks a two-monitor capture so both screens are visible at once', () => {
    // 1926 × 2160 of picture into a 1872 × 520 area: the height is the limit.
    const zoom = fitZoom(picture(1926, 2160), { width: 1872, height: 520 })
    expect(zoom).toBeCloseTo(520 / 2160, 6)
    expect(zoom * 2160).toBeCloseTo(520, 6)
  })

  it('is limited by the width when the picture is wider than the area', () => {
    const zoom = fitZoom(picture(4000, 400), { width: 1000, height: 900 })
    expect(zoom).toBe(0.25)
  })

  it('picks the tighter of the two limits', () => {
    // Width allows 0.5, height allows 0.25: the picture must fit vertically.
    expect(fitZoom(picture(2000, 2000), { width: 1000, height: 500 })).toBe(0.25)
  })

  it('never returns zero or nonsense for degenerate input', () => {
    expect(fitZoom(picture(0, 0), { width: 800, height: 600 })).toBe(1)
    expect(fitZoom(picture(800, 600), { width: 0, height: 0 })).toBe(1)
    expect(fitZoom(picture(Number.NaN, 600), { width: 800, height: 600 })).toBe(1)
  })

  it('stops shrinking at the readability floor', () => {
    expect(fitZoom(picture(100000, 100000), { width: 100, height: 100 })).toBe(MIN_ZOOM)
  })
})

describe('zooming by hand', () => {
  const fit = 0.4

  it('never goes below the fitted size: a smaller picture gains nothing', () => {
    expect(clampZoom(0.1, fit)).toBe(fit)
  })

  it('never goes above 100 %, which would only add blur', () => {
    expect(clampZoom(2, fit)).toBe(1)
  })

  it('keeps a value inside the range untouched', () => {
    expect(clampZoom(0.7, fit)).toBe(0.7)
  })

  it('ignores a value that is not a number', () => {
    expect(clampZoom(Number.NaN, fit)).toBe(fit)
  })

  it('steps up and down by 10 % of natural size', () => {
    expect(stepZoom(0.5, 1, fit)).toBeCloseTo(0.6, 6)
    expect(stepZoom(0.5, -1, fit)).toBeCloseTo(0.4, 6)
  })

  it('cannot step past either end of the range', () => {
    expect(stepZoom(1, 1, fit)).toBe(1)
    // Stepping down from just above fit snaps to fit instead of undershooting.
    expect(stepZoom(0.42, -1, fit)).toBe(fit)
  })

  it('shows whole percents', () => {
    expect(zoomLabel(0.5566)).toBe('56%')
    expect(zoomLabel(1)).toBe('100%')
    expect(zoomLabel(0.4)).toBe('40%')
  })
})

describe('when the zoom control is worth showing', () => {
  it('is hidden when the whole picture already fits', () => {
    expect(needsZoom(1)).toBe(false)
    expect(needsZoom(0.9999)).toBe(false)
  })

  it('appears as soon as the picture has to be shrunk', () => {
    expect(needsZoom(0.995)).toBe(true)
    expect(needsZoom(0.55)).toBe(true)
  })
})
