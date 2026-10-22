/**
 * Annotation vocabulary shared by the renderer and the tests.
 *
 * Everything here is pure: no canvas, no DOM. That keeps the text-wrapping rules
 * unit-testable in plain Node, where the drawing code cannot run.
 */

import type { Annotation, Point } from './types'

/** Palette offered in the toolbar. The first one is selected by default. */
export const ANNOTATION_COLORS = ['#FF3B30', '#FF9500', '#FFD60A', '#34C759', '#0A84FF', '#000000', '#FFFFFF'] as const

/** Stroke widths, as a fraction of the picture's shorter side. */
export const STROKE_WIDTHS = [0.0025, 0.004, 0.007] as const
export const DEFAULT_STROKE = 1

/**
 * Text sizes, as a fraction of the picture's shorter side, so the same choice
 * looks identical on a 400 px capture and on a 4K one. The default is the second
 * entry: noticeably larger than the first release, which felt cramped.
 */
export const TEXT_SIZES = [0.035, 0.05, 0.07, 0.1] as const
export const DEFAULT_TEXT_SIZE = 1
export const TEXT_SIZE_LABELS = ['Мелкий текст', 'Обычный текст', 'Крупный текст', 'Заголовок'] as const

/** The default size in one place, for callers that do not track a choice. */
export const TEXT_SIZE = TEXT_SIZES[DEFAULT_TEXT_SIZE]

/**
 * Break text into lines that fit `maxWidth`, using the caller's own measure
 * function so the same logic works for a canvas, a test or a DOM node.
 *
 * Words are never split: a single word wider than the limit stays on its own
 * line and is allowed to overflow, because a broken word reads worse than a wide
 * one. Explicit `\n` still starts a new line, so the user keeps control.
 */
export function wrapText(text: string, maxWidth: number, measure: (line: string) => number): string[] {
  const lines: string[] = []
  const limit = Math.max(1, maxWidth)

  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter((word) => word.length > 0)
    if (words.length === 0) {
      lines.push('')
      continue
    }

    let current = words[0]
    for (let index = 1; index < words.length; index++) {
      const candidate = `${current} ${words[index]}`
      if (measure(candidate) <= limit) {
        current = candidate
      } else {
        lines.push(current)
        current = words[index]
      }
    }
    lines.push(current)
  }

  return lines
}

/**
 * Width available to a text annotation: from where it was placed to the right
 * edge, minus a small margin so text never touches the border of the picture.
 * Shared with the editor so the input wraps exactly like the output.
 */
export function textWrapWidth(atX: number, width: number, height: number): number {
  const margin = Math.min(width, height) * 0.04
  return Math.max(Math.min(width, height) * 0.12, width - atX * width - margin)
}

/** Convert a pointer position in canvas pixels into normalized (0–1) coordinates. */
export function pointOf(x: number, y: number, width: number, height: number): { x: number; y: number } {
  return {
    x: Math.min(1, Math.max(0, x / width)),
    y: Math.min(1, Math.max(0, y / height))
  }
}

/** Font size in pixels for a text annotation, with a readable floor. */
export function textFontSize(size: number, width: number, height: number): number {
  return Math.max(10, size * Math.min(width, height))
}

/** The CSS font shorthand used for both measuring and drawing text. */
export function textFont(size: number): string {
  return `600 ${size}px "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif`
}

// ---------------------------------------------------------------------------
// Numbered steps
// ---------------------------------------------------------------------------

/**
 * Next badge number: one more than the highest badge already on the picture.
 *
 * Deriving it from the maximum instead of the count keeps numbers stable when a
 * badge is undone and redrawn, and leaves gaps alone if one is ever removed from
 * the middle rather than the end.
 */
export function nextStepNumber(annotations: readonly { tool: string; number?: number }[]): number {
  let highest = 0
  for (const annotation of annotations) {
    if (annotation.tool !== 'step') continue
    const value = typeof annotation.number === 'number' ? annotation.number : 0
    if (value > highest) highest = value
  }
  return highest + 1
}

/**
 * Readable text colour on top of `background`.
 *
 * Uses perceived luminance (the Rec. 601 weights), because a plain average would
 * call saturated yellow "dark" and put white digits on it.
 */
export function contrastTextColor(background: string): string {
  const match = /^#([0-9a-fA-F]{6})$/.exec(background)
  if (!match) return '#FFFFFF'
  const value = Number.parseInt(match[1], 16)
  const r = (value >> 16) & 0xff
  const g = (value >> 8) & 0xff
  const b = value & 0xff
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.62 ? '#111111' : '#FFFFFF'
}

/** Diameter of a step badge in pixels. */
export function stepRadius(size: number, width: number, height: number): number {
  return Math.max(8, (size * Math.min(width, height)) / 2)
}

// ---------------------------------------------------------------------------
// Straight lines
// ---------------------------------------------------------------------------

/**
 * Snap the end of a segment to the nearest 45° step.
 *
 * The point of the line tool is a *straight* line, and the main thing people use
 * it for is underlining a row of text — which only looks right if the line is
 * exactly horizontal. Dragging by hand lands a few degrees off, so holding Shift
 * snaps to 0°, 45° or 90°.
 *
 * The angle is computed in pixels, not in normalized units: a screenshot is
 * rarely square, so 45° in normalized space is not 45° on screen. The length is
 * preserved, so the line follows the pointer and only its direction snaps.
 */
export function snapSegment(from: Point, to: Point, width: number, height: number): Point {
  const dx = (to.x - from.x) * width
  const dy = (to.y - from.y) * height
  const length = Math.hypot(dx, dy)
  if (length < 1) return to

  const step = Math.PI / 4
  const angle = Math.round(Math.atan2(dy, dx) / step) * step
  return {
    x: clamp01(from.x + (Math.cos(angle) * length) / width),
    y: clamp01(from.y + (Math.sin(angle) * length) / height)
  }
}

// ---------------------------------------------------------------------------
// Moving annotations
// ---------------------------------------------------------------------------

function clamp01(value: number): number {
  // Six decimals is far below one pixel even on an 8K picture, and rounding here
  // stops float noise (0.1 + 0.3 = 0.4000000000000001) from piling up as a shape
  // is dragged around.
  return Math.min(1, Math.max(0, Math.round(value * 1e6) / 1e6))
}

/**
 * Shift an annotation by `dx`/`dy`, in normalized picture units.
 *
 * Every tool is movable, because "I put the caption in the wrong place" happens
 * to arrows and boxes just as often as to text. Points are clamped to the
 * picture instead of being dropped, so a shape dragged against the edge stops
 * there and stays selectable rather than disappearing off-canvas.
 */
export function translateAnnotation(annotation: Annotation, dx: number, dy: number): Annotation {
  const shift = (point: Point): Point => ({ x: clamp01(point.x + dx), y: clamp01(point.y + dy) })

  switch (annotation.tool) {
    case 'text':
    case 'step':
      return { ...annotation, at: shift(annotation.at) }
    case 'pen':
      return { ...annotation, points: annotation.points.map(shift) }
    default:
      return { ...annotation, from: shift(annotation.from), to: shift(annotation.to) }
  }
}
