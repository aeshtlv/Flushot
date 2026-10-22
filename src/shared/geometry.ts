import type { Rect } from './types'

/**
 * A display as required for DPI mapping. Bounds are device-independent pixels;
 * imageWidth/imageHeight are the physical pixels of the frozen screenshot.
 */
export interface DisplayGeometry {
  bounds: Rect
  imageWidth: number
  imageHeight: number
  scaleFactor: number
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Normalize a drag rectangle so width/height are always positive. */
export function normalizeRect(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return {
    x,
    y,
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y)
  }
}

/** Clamp a selection to the display bounds. */
export function clampRectToBounds(rect: Rect, bounds: Rect): Rect {
  const left = clamp(Math.round(rect.x), 0, bounds.width)
  const top = clamp(Math.round(rect.y), 0, bounds.height)
  const right = clamp(Math.round(rect.x + rect.width), 0, bounds.width)
  const bottom = clamp(Math.round(rect.y + rect.height), 0, bounds.height)
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }
}

/**
 * Convert a selection in window/CSS coordinates (DIP relative to the display)
 * into integer pixel coordinates inside the physical screenshot.
 */
export function selectionToImageRect(selection: Rect, display: DisplayGeometry): Rect {
  const values = [display.bounds.width, display.bounds.height, display.imageWidth, display.imageHeight]
  if (values.some((v) => !Number.isFinite(v) || v <= 0)) {
    throw new Error('Некорректные размеры экрана для преобразования координат')
  }

  const sx = display.imageWidth / display.bounds.width
  const sy = display.imageHeight / display.bounds.height

  const left = clamp(Math.round(selection.x * sx), 0, display.imageWidth - 1)
  const top = clamp(Math.round(selection.y * sy), 0, display.imageHeight - 1)
  const right = clamp(Math.round((selection.x + selection.width) * sx), left + 1, display.imageWidth)
  const bottom = clamp(Math.round((selection.y + selection.height) * sy), top + 1, display.imageHeight)

  return { x: left, y: top, width: right - left, height: bottom - top }
}

/** Physical pixel size of a selection, as shown in the overlay size badge. */
export function selectionPixelSize(selection: Rect, display: DisplayGeometry): { width: number; height: number } {
  const rect = selectionToImageRect(selection, display)
  return { width: rect.width, height: rect.height }
}

/** Reject accidental micro-selections (clicks, jitter). */
export function isUsableSelection(rect: Rect, minimum = 8): boolean {
  return rect.width >= minimum && rect.height >= minimum
}
