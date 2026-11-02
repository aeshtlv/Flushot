import { describe, expect, it } from 'vitest'
import { AUTO_COMMIT_MIN_PX, decideRegion } from '../src/shared/afterRegion'
import { MIN_SELECTION_PX } from '../src/shared/geometry'
import type { Rect } from '../src/shared/types'

const rect = (width: number, height: number): Rect => ({ x: 10, y: 10, width, height })

describe('decideRegion', () => {
  it('ignores a release that drew nothing', () => {
    expect(decideRegion(null, 'copy', false)).toEqual({ action: 'ignore', reason: 'empty' })
    expect(decideRegion(rect(0, 0), 'copy', false)).toEqual({ action: 'ignore', reason: 'empty' })
  })

  it('ignores a twitch that never became a region', () => {
    // One pixel short of the 8 px a drag needs: the pointer moved, but not enough to
    // mean anything. Copying it would replace the user's clipboard with a sliver.
    expect(decideRegion(rect(MIN_SELECTION_PX - 1, 200), 'copy', false)).toEqual({ action: 'ignore', reason: 'empty' })
    expect(decideRegion(rect(200, MIN_SELECTION_PX - 1), 'copy', false)).toEqual({ action: 'ignore', reason: 'empty' })
  })

  it('copies a real region in copy mode', () => {
    expect(decideRegion(rect(600, 400), 'copy', false)).toEqual({ action: 'copy' })
    // The threshold itself is included.
    expect(decideRegion(rect(AUTO_COMMIT_MIN_PX, AUTO_COMMIT_MIN_PX), 'copy', false)).toEqual({ action: 'copy' })
  })

  it('holds instead of copying a region too small to have been meant', () => {
    // Big enough to draw, too small to be a screenshot: keeping it on screen with the
    // bar shows the user what happened, and nothing lands on the clipboard.
    expect(decideRegion(rect(MIN_SELECTION_PX, MIN_SELECTION_PX), 'copy', false)).toEqual({
      action: 'hold',
      reason: 'too-small'
    })
    expect(decideRegion(rect(AUTO_COMMIT_MIN_PX - 1, 900), 'copy', false)).toEqual({ action: 'hold', reason: 'too-small' })
    // Large in one axis only: an accidental horizontal stroke across the screen.
    expect(decideRegion(rect(1200, 6), 'copy', false)).toEqual({ action: 'ignore', reason: 'empty' })
    expect(decideRegion(rect(1200, 10), 'copy', false)).toEqual({ action: 'hold', reason: 'too-small' })
  })

  it('lets Shift reach the editor even in copy mode', () => {
    expect(decideRegion(rect(600, 400), 'copy', true)).toEqual({ action: 'hold', reason: 'shift' })
    // Shift does not rescue a twitch: there is still nothing to open.
    expect(decideRegion(rect(MIN_SELECTION_PX - 2, MIN_SELECTION_PX - 2), 'copy', true)).toEqual({
      action: 'ignore',
      reason: 'empty'
    })
  })

  it('always holds in edit mode, and keeps the lower size bar', () => {
    expect(decideRegion(rect(600, 400), 'edit', false)).toEqual({ action: 'hold', reason: 'setting' })
    expect(decideRegion(rect(600, 400), 'edit', true)).toEqual({ action: 'hold', reason: 'setting' })
    // A region the user can see and correct does not need protecting from them, so the
    // editor keeps the 8 px bar rather than the 24 px copy threshold.
    expect(decideRegion(rect(MIN_SELECTION_PX, MIN_SELECTION_PX), 'edit', false)).toEqual({
      action: 'hold',
      reason: 'setting'
    })
    expect(decideRegion(rect(MIN_SELECTION_PX - 1, 400), 'edit', false)).toEqual({ action: 'ignore', reason: 'empty' })
  })

  it('never decides to copy anything in edit mode', () => {
    const sizes = [8, 9, 23, 24, 25, 100, 1920]
    for (const size of sizes) {
      expect(decideRegion(rect(size, size), 'edit', false).action).toBe('hold')
    }
  })
})
