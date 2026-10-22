import type { DisplayDescriptor, MonitorBounds, Rect } from './types'

/**
 * The virtual desktop: every monitor placed on one canvas.
 *
 * Windows already has this concept — `screen.getAllDisplays()` returns bounds in
 * a shared coordinate space whose origin can be negative (a monitor placed left
 * of or above the primary one). One selection rectangle drawn on that space can
 * cross the seam between monitors, which is what "select across monitors" means.
 *
 * Everything here is pure arithmetic, so the tricky part — mixing monitors with
 * different DPI scaling — is unit-testable without a second monitor attached.
 */

export interface ScreenBounds {
  id: string
  /** Bounds in device-independent pixels, in Electron's shared coordinate space. */
  bounds: Rect
  /** 1 for 100 %, 1.25 for 125 %, 1.5 for 150 % … */
  scaleFactor: number
  /** True for the monitor Windows treats as primary. */
  primary?: boolean
}

/** Bounding box of every monitor, in device-independent pixels. */
export function virtualBounds(screens: ScreenBounds[]): Rect {
  if (screens.length === 0) return { x: 0, y: 0, width: 1, height: 1 }

  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity

  for (const screen of screens) {
    left = Math.min(left, screen.bounds.x)
    top = Math.min(top, screen.bounds.y)
    right = Math.max(right, screen.bounds.x + screen.bounds.width)
    bottom = Math.max(bottom, screen.bounds.y + screen.bounds.height)
  }

  return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) }
}

/**
 * Density the composite is built at: the highest scale factor in the set.
 *
 * Choosing the maximum means no monitor is ever downscaled — the sharpest screen
 * keeps its native pixels. A 100 % monitor next to a 150 % one is upscaled
 * instead, which is the honest trade: information is never thrown away, it is
 * only interpolated where it never existed.
 */
export function virtualScale(screens: ScreenBounds[]): number {
  let scale = 1
  for (const screen of screens) {
    if (screen.scaleFactor > scale) scale = screen.scaleFactor
  }
  return scale
}

export interface ScreenPlacement {
  id: string
  /** Position in the composite, in image pixels. */
  left: number
  top: number
  /** Size in the composite, in image pixels. */
  width: number
  height: number
  /** True when the monitor's own pixels have to be resampled to fit. */
  resampled: boolean
}

/**
 * Where every monitor's frozen pixels land inside the composite.
 *
 * Coordinates are relative to the top-left corner of the virtual desktop, which
 * is why a monitor at x = -1920 still ends up at left = 0.
 */
export function virtualPlacements(screens: ScreenBounds[], scale: number): ScreenPlacement[] {
  const union = virtualBounds(screens)

  return screens.map((screen) => {
    const width = Math.round(screen.bounds.width * scale)
    const height = Math.round(screen.bounds.height * scale)
    return {
      id: screen.id,
      left: Math.round((screen.bounds.x - union.x) * scale),
      top: Math.round((screen.bounds.y - union.y) * scale),
      width,
      height,
      // A monitor whose own density differs from the composite needs a resize.
      resampled: Math.abs(screen.scaleFactor - scale) > 0.001
    }
  })
}

/** Size of the composite in image pixels. */
export function virtualImageSize(screens: ScreenBounds[], scale: number): { width: number; height: number } {
  const union = virtualBounds(screens)
  return { width: Math.max(1, Math.round(union.width * scale)), height: Math.max(1, Math.round(union.height * scale)) }
}

/**
 * Descriptor handed to the overlay window.
 *
 * The overlay covers the whole virtual desktop, so its bounds are the union and
 * its frozen frame is the composite — from the renderer's point of view a
 * three-monitor desk is simply one very wide screen.
 */
export function describeVirtual(screens: ScreenBounds[], image: { width: number; height: number }): DisplayDescriptor {
  const union = virtualBounds(screens)
  return {
    id: 'virtual',
    label: screens.length > 1 ? `Все экраны (${screens.length})` : 'Экран',
    bounds: union,
    scaleFactor: virtualScale(screens),
    imageWidth: Math.max(1, Math.round(image.width)),
    imageHeight: Math.max(1, Math.round(image.height)),
    // The overlay needs the individual monitors to decide which single screen
    // shows the result; a combined frame alone cannot answer that.
    monitors: screens.map((screen) => ({
      id: screen.id,
      bounds: screen.bounds,
      primary: Boolean(screen.primary)
    }))
  }
}

/** A rectangle expressed as fractions (0–1) of a containing rectangle. */
export interface HostPlacement {
  /** Monitor that hosts the result. */
  monitor: MonitorBounds
  left: number
  top: number
  width: number
  height: number
}

/**
 * The monitor that shows the result card, as fractions of the desktop.
 *
 * The overlay covers every monitor, so a centred card lands on the seam and gets
 * sliced by the bezel — unreadable on both screens. The card always goes to the
 * primary monitor instead: one fixed place the user can rely on, no matter where
 * the rectangle was drawn. Picking the monitor "with most of the selection"
 * sounded smarter but made the card jump between screens mid-workflow.
 */
export function resultHostPlacement(monitors: MonitorBounds[], union: Rect): HostPlacement | null {
  if (monitors.length === 0) return null

  const host = monitors.find((monitor) => monitor.primary) ?? monitors[0]

  return {
    monitor: host,
    left: (host.bounds.x - union.x) / union.width,
    top: (host.bounds.y - union.y) / union.height,
    width: host.bounds.width / union.width,
    height: host.bounds.height / union.height
  }
}

/**
 * The whole primary monitor as an overlay selection, in CSS pixels.
 *
 * Used by the full-screen hotkey: the overlay opens with the region already
 * selected, so the user only confirms, copies or annotates. It has to be the
 * primary monitor rather than the whole virtual desktop — "весь экран" means the
 * screen in front of the user, not every monitor stitched together.
 *
 * The result is clamped to the window: a monitor whose DIP bounds stick out by a
 * pixel due to rounding must not produce a selection the user cannot grab.
 */
export function fullscreenSelection(display: DisplayDescriptor, viewport: { width: number; height: number }): Rect {
  const monitors = display.monitors ?? []
  const host = monitors.find((monitor) => monitor.primary) ?? monitors[0]
  const area = host ? host.bounds : display.bounds
  const union = display.bounds
  const scaleX = union.width > 0 ? viewport.width / union.width : 1
  const scaleY = union.height > 0 ? viewport.height / union.height : 1

  const x = Math.round((area.x - union.x) * scaleX)
  const y = Math.round((area.y - union.y) * scaleY)
  const width = Math.round(area.width * scaleX)
  const height = Math.round(area.height * scaleY)

  return {
    x: Math.min(Math.max(0, x), Math.max(0, viewport.width - 1)),
    y: Math.min(Math.max(0, y), Math.max(0, viewport.height - 1)),
    width: Math.min(width, viewport.width - Math.min(Math.max(0, x), viewport.width)),
    height: Math.min(height, viewport.height - Math.min(Math.max(0, y), viewport.height))
  }
}

// ---------------------------------------------------------------------------
// Capturing at the monitor's own density
// ---------------------------------------------------------------------------

/** A monitor as the capture layer sees it: desktop bounds plus its own pixels. */
export interface MonitorCapture extends ScreenBounds {
  /** Physical size of the frozen bitmap, exactly as the capture layer returned it. */
  imageWidth: number
  imageHeight: number
  /** Rotation Windows reports for this display: 0, 90, 180 or 270. */
  rotation?: number
}


/**
 * True when the frozen bitmap is stored sideways relative to the desktop.
 *
 * A portrait monitor must come back as a portrait bitmap. When it does not, the
 * capture layer handed over the panel's own orientation and every later resize
 * would squash the picture: a 1080 × 1920 screen stretched into a 1920 × 1080
 * box is the "кривой скриншот" this guards against. The test compares both
 * interpretations and only calls it transposed when turning is clearly the
 * better fit, so a monitor whose DIP size rounds oddly is never turned by
 * accident.
 */
export function isTransposed(capture: { imageWidth: number; imageHeight: number; bounds: Rect }): boolean {
  if (capture.imageWidth <= 0 || capture.imageHeight <= 0) return false
  const boundsAspect = capture.bounds.width / capture.bounds.height
  if (!Number.isFinite(boundsAspect) || boundsAspect <= 0) return false

  const imageAspect = capture.imageWidth / capture.imageHeight
  const direct = Math.abs(imageAspect - boundsAspect) / boundsAspect
  const turned = Math.abs(imageAspect - 1 / boundsAspect) * boundsAspect
  return turned < direct * 0.5
}

/** Size of the frozen bitmap once it is turned to match the desktop. */
export function uprightSize(capture: Pick<MonitorCapture, 'imageWidth' | 'imageHeight' | 'bounds'>): {
  width: number
  height: number
} {
  return isTransposed(capture)
    ? { width: capture.imageHeight, height: capture.imageWidth }
    : { width: capture.imageWidth, height: capture.imageHeight }
}

/** One monitor's share of the selection, in both spaces. */
export interface CropPart {
  id: string
  /** Area to take from the monitor's upright bitmap, in its own pixels. */
  source: Rect
  /** Where it lands in the output image. */
  target: Rect
  /** True when this monitor's density differs from the output's and it must be resampled. */
  resampled: boolean
}

/** How a selection is assembled from the monitors' own pixels. */
export interface CropPlan {
  width: number
  height: number
  /** Output pixels per desktop pixel. 1 on a 100 % monitor. */
  density: number
  parts: CropPart[]
}

function intersection(a: Rect, b: Rect): Rect {
  const left = Math.max(a.x, b.x)
  const top = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }
}

/**
 * A rectangle drawn on the overlay, expressed in desktop coordinates.
 *
 * The renderer works in CSS pixels of its own window, which normally equals the
 * union of the monitors and maps 1:1. When the window had to be clamped — a
 * display too large for the maximum window size — the two disagree, so the
 * rectangle is scaled back before anything is cropped. Both the main process and
 * the overlay use this, so the size the user is shown and the size that is
 * written can never drift apart.
 */
export function selectionToDesktopRect(rect: Rect, viewport: { width: number; height: number } | undefined, union: Rect): Rect {
  const scaleX = viewport && viewport.width > 0 ? union.width / viewport.width : 1
  const scaleY = viewport && viewport.height > 0 ? union.height / viewport.height : 1
  return {
    x: union.x + rect.x * scaleX,
    y: union.y + rect.y * scaleY,
    width: rect.width * scaleX,
    height: rect.height * scaleY
  }
}

/**
 * Plan a capture that takes every pixel from the monitor it belongs to.
 *
 * The composite used to be the only source: monitors were stitched into one
 * canvas at the highest density present, and the selection was cropped out of
 * that. On a mixed-DPI desk that meant a 100 % monitor was upscaled before it was
 * cropped, so the picture came out soft and larger than the screen it came from.
 * Here the output density is the density of the monitor that holds most of the
 * selection, so capturing one screen is pixel-exact at any DPI, and a selection
 * that crosses a seam resamples only the smaller share.
 */
export function planNativeCrop(selection: Rect, monitors: MonitorCapture[]): CropPlan {
  const width = Math.max(1, Math.round(selection.width))
  const height = Math.max(1, Math.round(selection.height))

  const overlaps = monitors
    .map((monitor) => ({ monitor, area: intersection(selection, monitor.bounds) }))
    .filter((entry) => entry.area.width > 0 && entry.area.height > 0)

  if (overlaps.length === 0) {
    // The selection sits in the gap between screens: nothing to take, and the
    // output stays the black strip the composite would have shown.
    return { width, height, density: 1, parts: [] }
  }

  const densityOf = (monitor: MonitorCapture): number => {
    const upright = uprightSize(monitor)
    return monitor.bounds.width > 0 ? upright.width / monitor.bounds.width : 1
  }

  // The monitor the user is mostly capturing decides the density: it stays
  // pixel-exact, and the others are resampled once if they differ.
  const host = overlaps.reduce((best, entry) =>
    entry.area.width * entry.area.height > best.area.width * best.area.height ? entry : best
  )
  const density = densityOf(host.monitor) || 1

  const outWidth = Math.max(1, Math.round(selection.width * density))
  const outHeight = Math.max(1, Math.round(selection.height * density))

  const parts: CropPart[] = overlaps.map(({ monitor, area }) => {
    const upright = uprightSize(monitor)
    const sx = monitor.bounds.width > 0 ? upright.width / monitor.bounds.width : density
    const sy = monitor.bounds.height > 0 ? upright.height / monitor.bounds.height : density

    const sourceLeft = Math.round((area.x - monitor.bounds.x) * sx)
    const sourceTop = Math.round((area.y - monitor.bounds.y) * sy)
    const sourceRight = Math.round((area.x + area.width - monitor.bounds.x) * sx)
    const sourceBottom = Math.round((area.y + area.height - monitor.bounds.y) * sy)

    // Edges are taken from the same absolute coordinates as the target, so two
    // monitors that meet at a seam tile the output exactly instead of leaving a
    // one-pixel gap between them.
    const targetLeft = Math.round((area.x - selection.x) * density)
    const targetTop = Math.round((area.y - selection.y) * density)
    const targetRight = Math.round((area.x + area.width - selection.x) * density)
    const targetBottom = Math.round((area.y + area.height - selection.y) * density)

    return {
      id: monitor.id,
      source: {
        x: Math.max(0, Math.min(sourceLeft, upright.width - 1)),
        y: Math.max(0, Math.min(sourceTop, upright.height - 1)),
        width: Math.max(1, Math.min(sourceRight - sourceLeft, upright.width - Math.max(0, sourceLeft))),
        height: Math.max(1, Math.min(sourceBottom - sourceTop, upright.height - Math.max(0, sourceTop)))
      },
      target: {
        x: Math.max(0, Math.min(targetLeft, outWidth - 1)),
        y: Math.max(0, Math.min(targetTop, outHeight - 1)),
        width: Math.max(1, Math.min(targetRight - targetLeft, outWidth - Math.max(0, targetLeft))),
        height: Math.max(1, Math.min(targetBottom - targetTop, outHeight - Math.max(0, targetTop)))
      },
      resampled: Math.abs(sx - density) > 0.001 || Math.abs(sy - density) > 0.001
    }
  })

  return { width: outWidth, height: outHeight, density, parts }
}
