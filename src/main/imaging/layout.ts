import { CARD_RADIUS, FRAME_WIDTH } from '../../shared/settings'

export interface FrameLayout {
  /** Size of the finished image: the screenshot plus the frame on all sides. */
  canvasWidth: number
  canvasHeight: number
  /** Screenshot position and size inside the frame. */
  x: number
  y: number
  width: number
  height: number
  /** Width of the background frame on each side (px). */
  frame: number
  cornerRadius: number
  /**
   * Always 1: the screenshot is placed pixel for pixel, never resampled.
   * Kept in the layout so callers and tests can assert the guarantee.
   */
  scale: number
}

/**
 * Place the screenshot on a canvas that is exactly the screenshot plus the
 * frame, so the output can be any size and nothing is ever scaled.
 *
 * The frame is one uniform width on all four sides, which keeps the source
 * aspect ratio untouched: the picture keeps its own proportions and simply gets
 * a coloured border. A frame of 0 gives a plain screenshot with no border.
 *
 * `cornerRadius` is honoured up to a quarter of the shorter side, so a large
 * radius can never turn the picture into a circle or eat its content.
 */
export function computeFrameLayout(
  imageWidth: number,
  imageHeight: number,
  frame: number = FRAME_WIDTH,
  cornerRadius: number = CARD_RADIUS
): FrameLayout {
  if (!Number.isFinite(imageWidth) || !Number.isFinite(imageHeight) || imageWidth <= 0 || imageHeight <= 0) {
    throw new Error('Некорректный размер снимка')
  }

  const safeFrame = Math.max(0, Math.floor(Number.isFinite(frame) ? frame : 0))
  const width = Math.max(1, Math.round(imageWidth))
  const height = Math.max(1, Math.round(imageHeight))
  const shorterSide = Math.min(width, height)
  const maxRadius = Math.max(0, Math.floor(shorterSide / 4))
  const wanted = Number.isFinite(cornerRadius) ? Math.round(cornerRadius) : CARD_RADIUS
  const radius = Math.max(0, Math.min(maxRadius, wanted))

  return {
    canvasWidth: width + safeFrame * 2,
    canvasHeight: height + safeFrame * 2,
    x: safeFrame,
    y: safeFrame,
    width,
    height,
    frame: safeFrame,
    cornerRadius: radius,
    scale: 1
  }
}
