/**
 * Zoom for the result preview.
 *
 * A capture that spans two monitors is often wider and taller than a single
 * screen, so it cannot be shown at full size on the monitor that hosts the
 * result. Shrinking it to fit makes the whole picture visible but impossible to
 * annotate precisely; showing it at 100 % is precise but only a corner is
 * visible. The answer is both: start fitted, let the user zoom to 100 % and pan.
 *
 * Everything here is pure arithmetic so the awkward cases — a picture smaller
 * than the area, a degenerate area, rounding at the edges — are unit-testable.
 */

export interface Size {
  width: number
  height: number
}

/** Never shrink below this: past it the picture is a thumbnail, not an editor. */
export const MIN_ZOOM = 0.05

/** Below this the slider would have a single position, so the control is hidden. */
export const FIT_EPSILON = 0.001

/**
 * Zoom at which the whole picture fits the area without ever upscaling.
 *
 * 1 means "one image pixel per device pixel", which is the sharpest the preview
 * can be. A small capture therefore keeps 100 % instead of being blown up to fill
 * the screen and look soft.
 */
export function fitZoom(picture: Size, area: Size): number {
  if (!isUsable(picture) || !isUsable(area)) return 1
  const zoom = Math.min(1, area.width / picture.width, area.height / picture.height)
  return Math.max(MIN_ZOOM, Math.min(1, zoom))
}

/**
 * Keep a requested zoom inside the range the UI offers: never below fit (there is
 * nothing to gain from a picture smaller than the window) and never above 100 %
 * (upscaling only adds blur).
 */
export function clampZoom(zoom: number, fit: number): number {
  if (!Number.isFinite(zoom)) return fit
  return Math.max(fit, Math.min(1, zoom))
}

/** One step of the +/− buttons: 10 % of natural size, snapped to whole percents. */
export function stepZoom(current: number, direction: 1 | -1, fit: number): number {
  const next = Math.round((current + direction * 0.1) * 100) / 100
  return clampZoom(next, fit)
}

/** Percent shown next to the slider. */
export function zoomLabel(zoom: number): string {
  return `${Math.round(clampZoom(zoom, MIN_ZOOM) * 100)}%`
}

/** True when the picture needs a zoom control at all. */
export function needsZoom(fit: number): boolean {
  return fit < 1 - FIT_EPSILON
}

function isUsable(size: Size): boolean {
  return Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0
}
