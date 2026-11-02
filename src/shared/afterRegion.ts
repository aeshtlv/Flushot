import { MIN_SELECTION_PX, isUsableSelection } from './geometry'
import type { AfterRegion, Rect } from './types'

/**
 * The smallest region that may be copied without the user seeing it first.
 *
 * Deliberately larger than the 8 px a drag needs to count at all. With a preview on
 * screen a small region is visible and can be redrawn; with automatic copying there
 * is nothing to look at, so a mouse that slipped mid-click would put a 16 × 16
 * picture on the clipboard and replace whatever the user had there.
 */
export const AUTO_COMMIT_MIN_PX = 24

/** What releasing the mouse button means. */
export type RegionDecision =
  /** A click or a twitch: nothing to capture, and nothing is copied. */
  | { action: 'ignore'; reason: 'empty' }
  /** Copy the region and close, without showing the editor. */
  | { action: 'copy' }
  /**
   * Keep the region on screen and show the confirm bar, exactly as before: the user
   * can still move it, resize it, press Enter — or copy it with Ctrl+C.
   */
  | { action: 'hold'; reason: 'setting' | 'shift' | 'too-small' }

/**
 * Decide what happens when the mouse button is released after drawing a region.
 *
 * The rules, in order:
 *
 *   1. Nothing was actually drawn — a click or a twitch — so nothing is captured.
 *   2. `edit` mode: keep the region and the bar, which is what the editor flow has
 *      always done. Opening the editor on release would take the region away at the
 *      exact moment the user wants to nudge its corner.
 *   3. `Shift` held on release: the same, whichever mode is configured. This is the
 *      escape hatch that keeps annotations reachable in the fast mode, and the hint
 *      on screen names it the whole time the region is being drawn.
 *   4. A region too small to be meant: keep it on screen with the bar instead of
 *      copying a sliver, so the user sees what happened and can redraw.
 *   5. Otherwise: copy it.
 *
 * Pure, and separate from the component, because all of this is invisible in the
 * UI: a click that quietly copies a 16 px fragment looks exactly like a working
 * capture until the wrong picture lands in a chat.
 */
export function decideRegion(rect: Rect | null, mode: AfterRegion, shiftHeld: boolean): RegionDecision {
  if (!rect || rect.width === 0 || rect.height === 0) return { action: 'ignore', reason: 'empty' }

  const drawn = isUsableSelection(rect, MIN_SELECTION_PX)
  if (!drawn) return { action: 'ignore', reason: 'empty' }

  if (mode === 'edit') return { action: 'hold', reason: 'setting' }
  if (shiftHeld) return { action: 'hold', reason: 'shift' }
  if (!isUsableSelection(rect, AUTO_COMMIT_MIN_PX)) return { action: 'hold', reason: 'too-small' }
  return { action: 'copy' }
}
