/**
 * Bounds for the settings preview render width.
 *
 * The preview is rendered at the width it will be displayed at, so that
 * stretching the window produces a sharp, wider picture instead of a stretched
 * 440 px one. That width comes from the window, which the user controls, so it
 * has to be clamped: below the minimum the sample is unreadable, and above the
 * maximum every extra pixel costs a full card composite plus a PNG encode while
 * buying nothing visible.
 */
export const PREVIEW_MIN_WIDTH = 480
export const PREVIEW_MAX_WIDTH = 2048
export const PREVIEW_DEFAULT_WIDTH = 960

/** Clamp an arbitrary requested width into the supported range. */
export function clampPreviewWidth(width: unknown): number {
  const value = typeof width === 'number' && Number.isFinite(width) ? width : PREVIEW_DEFAULT_WIDTH
  return Math.round(Math.min(PREVIEW_MAX_WIDTH, Math.max(PREVIEW_MIN_WIDTH, value)))
}
