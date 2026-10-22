import { describe, expect, it } from 'vitest'
import { PREVIEW_DEFAULT_WIDTH, PREVIEW_MAX_WIDTH, PREVIEW_MIN_WIDTH, clampPreviewWidth } from '../src/shared/preview'

describe('clampPreviewWidth', () => {
  it('keeps a width inside the supported range', () => {
    expect(clampPreviewWidth(760)).toBe(760)
    expect(clampPreviewWidth(PREVIEW_MIN_WIDTH)).toBe(PREVIEW_MIN_WIDTH)
    expect(clampPreviewWidth(PREVIEW_MAX_WIDTH)).toBe(PREVIEW_MAX_WIDTH)
  })

  it('raises a too narrow request to the minimum', () => {
    // A 400 px window minus padding leaves less than the minimum: the sample
    // would be unreadable, so it is rendered at the floor and scaled down.
    expect(clampPreviewWidth(120)).toBe(PREVIEW_MIN_WIDTH)
    expect(clampPreviewWidth(0)).toBe(PREVIEW_MIN_WIDTH)
    expect(clampPreviewWidth(-500)).toBe(PREVIEW_MIN_WIDTH)
  })

  it('caps a very wide window', () => {
    // Dragged across a 4K monitor the frame can ask for 3000+ px; past the cap
    // the extra render time buys nothing visible.
    expect(clampPreviewWidth(3840)).toBe(PREVIEW_MAX_WIDTH)
    expect(clampPreviewWidth(1e6)).toBe(PREVIEW_MAX_WIDTH)
  })

  it('falls back to the default when the width is not a number', () => {
    expect(clampPreviewWidth(undefined)).toBe(PREVIEW_DEFAULT_WIDTH)
    expect(clampPreviewWidth(null)).toBe(PREVIEW_DEFAULT_WIDTH)
    expect(clampPreviewWidth(Number.NaN)).toBe(PREVIEW_DEFAULT_WIDTH)
    expect(clampPreviewWidth(Number.POSITIVE_INFINITY)).toBe(PREVIEW_DEFAULT_WIDTH)
    expect(clampPreviewWidth('900')).toBe(PREVIEW_DEFAULT_WIDTH)
  })

  it('rounds fractional widths, so sub-pixel layout does not thrash the cache', () => {
    expect(clampPreviewWidth(760.4)).toBe(760)
    expect(clampPreviewWidth(760.6)).toBe(761)
  })
})
