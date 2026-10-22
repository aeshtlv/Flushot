/**
 * Placement of the small floating bars that follow the selection rectangle.
 *
 * Pure arithmetic on purpose: the interesting case — a selection that covers the
 * whole screen, so neither above nor below it there is room for the toolbar — is
 * impossible to check by eye on a normal window and trivial to assert in a test.
 */

import type { Rect } from './types'

export interface ChromePlacement {
  left: number
  top: number
  /**
   * True when the bar had to be placed over the picture because there was no
   * room outside the selection. The caller uses it to give the bar a solid
   * backdrop: floating over the dimmed desktop looks fine, floating over an
   * undimmed screenshot does not.
   */
  inside: boolean
}

/** Margin kept from the window edges. */
const EDGE = 8

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(max, Math.max(min, value))
}

/**
 * Where to put a bar of `size` next to `rect`.
 *
 * Order of preference: under the selection, over it, and only then inside its
 * bottom edge. The last case is what makes a full-screen selection usable: the
 * toolbar used to be pushed past the bottom of the screen, so selecting the whole
 * area made the buttons disappear exactly when they were needed most.
 *
 * Horizontally the bar follows the centre of the selection but never leaves the
 * window; when it sits inside the selection it also never leaves the selection.
 */
export function placeBar(
  rect: Rect,
  viewport: { width: number; height: number },
  size: { width: number; height: number },
  gap = 14
): ChromePlacement {
  const maxLeft = viewport.width - size.width - EDGE
  const centred = rect.x + rect.width / 2 - size.width / 2
  const left = clamp(centred, EDGE, Math.max(EDGE, maxLeft))

  const below = rect.y + rect.height + gap
  if (below + size.height <= viewport.height - EDGE) {
    return { left, top: Math.round(below), inside: false }
  }

  const above = rect.y - gap - size.height
  if (above >= EDGE) {
    return { left, top: Math.round(above), inside: false }
  }

  // No room outside: sit at the bottom edge of the selection, but never above its
  // own top edge (a tiny selection must not push the bar off the other side).
  const innerLeft = clamp(left, rect.x + EDGE, rect.x + rect.width - size.width - EDGE)
  const innerTop = clamp(
    rect.y + rect.height - size.height - gap,
    rect.y + gap,
    Math.max(rect.y + gap, viewport.height - size.height - EDGE)
  )
  return {
    left: Math.round(clamp(innerLeft, EDGE, Math.max(EDGE, maxLeft))),
    top: Math.round(innerTop),
    inside: true
  }
}
