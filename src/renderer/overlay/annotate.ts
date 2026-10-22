import {
  contrastTextColor,
  stepRadius,
  textFont,
  textFontSize,
  textWrapWidth,
  wrapText
} from '../../shared/annotate'
import type { Annotation, Point, TextAnnotation } from '../../shared/types'

/**
 * Annotation drawing.
 *
 * Everything is drawn in the picture's own pixel space, so the canvas backing
 * store is exactly the picture: the preview is a 1:1 downscale of the exported
 * layer, and no re-rasterisation happens on the way out. Coordinates arrive
 * normalized (0–1) and are multiplied by the canvas size here.
 *
 * The pure parts (palette, sizes, text wrapping) live in `shared/annotate.ts` so
 * they can be tested without a canvas.
 */

/** Where the picture lives inside the frozen screenshot, in shot pixels. */
export interface SourceBox {
  canvas: CanvasImageSource
  x: number
  y: number
  width: number
  height: number
}

function strokePx(annotation: Annotation, width: number, height: number): number {
  // A blur patch carries no stroke of its own; the fallback keeps the helper
  // usable for every tool instead of forcing a separate overload.
  const ratio = 'width' in annotation ? annotation.width : 0.004
  return Math.max(1, ratio * Math.min(width, height))
}

function line(ctx: CanvasRenderingContext2D, from: Point, to: Point, width: number, height: number): void {
  ctx.beginPath()
  ctx.moveTo(from.x * width, from.y * height)
  ctx.lineTo(to.x * width, to.y * height)
  ctx.stroke()
}

/** Solid triangle head, sized from the stroke so it stays proportional. */
function arrowHead(ctx: CanvasRenderingContext2D, from: Point, to: Point, thickness: number, width: number, height: number): void {
  const x1 = from.x * width
  const y1 = from.y * height
  const x2 = to.x * width
  const y2 = to.y * height
  const angle = Math.atan2(y2 - y1, x2 - x1)
  const length = Math.max(thickness * 4.2, 10)
  const spread = Math.PI / 7

  ctx.beginPath()
  ctx.moveTo(x2, y2)
  ctx.lineTo(x2 - length * Math.cos(angle - spread), y2 - length * Math.sin(angle - spread))
  ctx.lineTo(x2 - length * Math.cos(angle + spread), y2 - length * Math.sin(angle + spread))
  ctx.closePath()
  ctx.fill()
}

function blurRegion(ctx: CanvasRenderingContext2D, annotation: Extract<Annotation, { tool: 'blur' }>, source: SourceBox, width: number, height: number): void {
  const left = Math.min(annotation.from.x, annotation.to.x) * width
  const top = Math.min(annotation.from.y, annotation.to.y) * height
  const right = Math.max(annotation.from.x, annotation.to.x) * width
  const bottom = Math.max(annotation.from.y, annotation.to.y) * height
  const w = Math.max(1, right - left)
  const h = Math.max(1, bottom - top)

  // The source picture is drawn from the frozen screenshot, so the censor uses
  // the real pixels rather than whatever resolution the preview happens to be.
  const sx = source.x + (left / width) * source.width
  const sy = source.y + (top / height) * source.height
  const sw = (w / width) * source.width
  const sh = (h / height) * source.height

  ctx.save()
  ctx.beginPath()
  ctx.rect(left, top, w, h)
  ctx.clip()

  if (annotation.mode === 'pixelate') {
    // Downscale to ~1/16 and blow it back up without smoothing: classic censor.
    const small = document.createElement('canvas')
    small.width = Math.max(1, Math.round(w / 16))
    small.height = Math.max(1, Math.round(h / 16))
    const smallCtx = small.getContext('2d')
    if (smallCtx) {
      smallCtx.drawImage(source.canvas, sx, sy, sw, sh, 0, 0, small.width, small.height)
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(small, 0, 0, small.width, small.height, left, top, w, h)
      ctx.imageSmoothingEnabled = true
    }
  } else {
    ctx.filter = `blur(${Math.max(2, Math.round(Math.min(w, h) / 14))}px)`
    ctx.drawImage(source.canvas, sx, sy, sw, sh, left, top, w, h)
    ctx.filter = 'none'
  }

  ctx.restore()
}

function drawText(ctx: CanvasRenderingContext2D, annotation: Extract<Annotation, { tool: 'text' }>, width: number, height: number): void {
  const size = textFontSize(annotation.size, width, height)
  const x = annotation.at.x * width
  const y = annotation.at.y * height

  ctx.font = textFont(size)
  ctx.textBaseline = 'top'
  ctx.lineJoin = 'round'

  // A soft dark outline keeps light text readable on a light screenshot and
  // vice versa, without needing a second colour from the user.
  const lines = wrapText(annotation.text, textWrapWidth(annotation.at.x, width, height), (line) => ctx.measureText(line).width)
  const lineHeight = size * 1.25
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.28)'
  ctx.lineWidth = Math.max(2, size * 0.08)
  lines.forEach((line, index) => {
    const lineY = y + index * lineHeight
    ctx.strokeText(line, x, lineY)
    ctx.fillText(line, x, lineY)
  })
}

/**
 * A filled circle with the step number in it.
 *
 * The digits get the contrasting colour rather than the palette colour, and a
 * light ring separates the badge from a screenshot that happens to be the same
 * colour as the badge.
 */
function drawStep(ctx: CanvasRenderingContext2D, annotation: Extract<Annotation, { tool: 'step' }>, width: number, height: number): void {
  const radius = stepRadius(annotation.size, width, height)
  const x = annotation.at.x * width
  const y = annotation.at.y * height
  const label = String(annotation.number)

  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.fillStyle = annotation.color
  ctx.fill()

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)'
  ctx.lineWidth = Math.max(1.5, radius * 0.12)
  ctx.stroke()

  // Two digits need a smaller face to stay inside the circle.
  const font = Math.max(9, radius * (label.length > 1 ? 0.85 : 1.15))
  ctx.font = `700 ${font}px "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif`
  ctx.fillStyle = contrastTextColor(annotation.color)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, x, y + font * 0.04)
  ctx.textAlign = 'start'
}

/** Draw one annotation onto a canvas that is exactly the picture's size. */
export function drawAnnotation(
  ctx: CanvasRenderingContext2D,
  annotation: Annotation,
  width: number,
  height: number,
  source: SourceBox
): void {
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  if (annotation.tool === 'blur') {
    blurRegion(ctx, annotation, source, width, height)
    ctx.restore()
    return
  }

  ctx.strokeStyle = annotation.color
  ctx.fillStyle = annotation.color

  if (annotation.tool === 'arrow') {
    const thickness = strokePx(annotation, width, height)
    ctx.lineWidth = thickness
    // Shorten the shaft so the stroke does not poke through the arrow head.
    const dx = annotation.to.x - annotation.from.x
    const dy = annotation.to.y - annotation.from.y
    const length = Math.hypot(dx * width, dy * height) || 1
    const trim = Math.min(0.4, (thickness * 3.6) / length)
    line(
      ctx,
      annotation.from,
      { x: annotation.to.x - dx * trim, y: annotation.to.y - dy * trim },
      width,
      height
    )
    arrowHead(ctx, annotation.from, annotation.to, thickness, width, height)
  } else if (annotation.tool === 'line') {
    const thickness = strokePx(annotation, width, height)
    ctx.lineWidth = thickness
    // A plain segment: no head, no fill. Round caps keep a short underline from
    // ending in a hard square corner.
    line(ctx, annotation.from, annotation.to, width, height)
  } else if (annotation.tool === 'rect') {
    const thickness = strokePx(annotation, width, height)
    const x = Math.min(annotation.from.x, annotation.to.x) * width
    const y = Math.min(annotation.from.y, annotation.to.y) * height
    const w = Math.abs(annotation.to.x - annotation.from.x) * width
    const h = Math.abs(annotation.to.y - annotation.from.y) * height
    ctx.lineWidth = thickness
    const radius = Math.min(thickness * 2, Math.min(w, h) / 4)
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, radius)
    ctx.stroke()
  } else if (annotation.tool === 'pen') {
    const thickness = strokePx(annotation, width, height)
    ctx.lineWidth = thickness
    ctx.beginPath()
    annotation.points.forEach((point, index) => {
      const x = point.x * width
      const y = point.y * height
      if (index === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    // A single tap should still leave a dot.
    if (annotation.points.length === 1) {
      const point = annotation.points[0]
      ctx.arc(point.x * width, point.y * height, thickness / 2, 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.stroke()
    }
  } else if (annotation.tool === 'step') {
    drawStep(ctx, annotation, width, height)
  } else {
    drawText(ctx, annotation, width, height)
  }

  ctx.restore()
}

/** Redraw the whole layer from scratch. */
export function drawAll(
  ctx: CanvasRenderingContext2D,
  annotations: Annotation[],
  width: number,
  height: number,
  source: SourceBox
): void {
  ctx.clearRect(0, 0, width, height)
  for (const annotation of annotations) drawAnnotation(ctx, annotation, width, height, source)
}

// ---------------------------------------------------------------------------
// Hit testing, so a saved caption can be edited instead of retyped
// ---------------------------------------------------------------------------

/** Offscreen context used only for measuring: it is never painted. */
let measureContext: CanvasRenderingContext2D | null = null

function measurer(): CanvasRenderingContext2D | null {
  if (measureContext) return measureContext
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  measureContext = canvas.getContext('2d')
  return measureContext
}

/**
 * Bounding box of a text annotation in picture pixels, computed with exactly the
 * same font and wrapping as the renderer uses. Returns `null` when there is no
 * canvas to measure with (server-side rendering, tests).
 */
export function textBounds(
  annotation: TextAnnotation,
  width: number,
  height: number
): { x: number; y: number; width: number; height: number } | null {
  const ctx = measurer()
  if (!ctx) return null
  const size = textFontSize(annotation.size, width, height)
  ctx.font = textFont(size)
  const lines = wrapText(annotation.text, textWrapWidth(annotation.at.x, width, height), (line) => ctx.measureText(line).width)
  let widest = 0
  for (const line of lines) widest = Math.max(widest, ctx.measureText(line).width)
  return {
    x: annotation.at.x * width,
    y: annotation.at.y * height,
    width: widest,
    height: lines.length * size * 1.25
  }
}

/**
 * Index of the topmost text annotation under `point`, or `null`.
 *
 * Only text is hit-testable: a caption is the one thing that cannot be redrawn
 * from scratch without retyping, so it is the one that gets an edit affordance.
 */
export function findTextAnnotation(
  annotations: Annotation[],
  point: Point,
  width: number,
  height: number
): number | null {
  const px = point.x * width
  const py = point.y * height
  for (let index = annotations.length - 1; index >= 0; index--) {
    const annotation = annotations[index]
    if (annotation.tool !== 'text') continue
    const box = textBounds(annotation, width, height)
    if (!box) continue
    // A few pixels of slack: hitting a one-letter caption exactly is fiddly.
    const pad = Math.max(4, textFontSize(annotation.size, width, height) * 0.3)
    if (px >= box.x - pad && px <= box.x + box.width + pad && py >= box.y - pad && py <= box.y + box.height + pad) {
      return index
    }
  }
  return null
}

/** Distance from a point to a segment, in picture pixels. */
function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return Math.hypot(px - ax, py - ay)
  const t = Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / lengthSquared))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/**
 * Index of the topmost annotation under `point`, or `null`.
 *
 * Used by the move tool. Outlines (arrow, rect, pen) are grabbed by their line,
 * not by their interior: a large rectangle would otherwise swallow every click
 * inside it and make everything underneath impossible to pick up. Filled things
 * (text, step badge, blur patch) are grabbed anywhere inside.
 */
export function findAnnotation(
  annotations: Annotation[],
  point: Point,
  width: number,
  height: number
): number | null {
  const px = point.x * width
  const py = point.y * height
  const slack = Math.max(6, Math.min(width, height) * 0.02)

  for (let index = annotations.length - 1; index >= 0; index--) {
    const annotation = annotations[index]
    const reach = Math.max(slack, strokePx(annotation, width, height))

    if (annotation.tool === 'text') {
      const box = textBounds(annotation, width, height)
      if (!box) continue
      const pad = Math.max(4, textFontSize(annotation.size, width, height) * 0.3)
      if (px >= box.x - pad && px <= box.x + box.width + pad && py >= box.y - pad && py <= box.y + box.height + pad) {
        return index
      }
      continue
    }

    if (annotation.tool === 'step') {
      const radius = stepRadius(annotation.size, width, height)
      if (Math.hypot(px - annotation.at.x * width, py - annotation.at.y * height) <= radius + slack) return index
      continue
    }

    if (annotation.tool === 'blur') {
      const x1 = Math.min(annotation.from.x, annotation.to.x) * width
      const x2 = Math.max(annotation.from.x, annotation.to.x) * width
      const y1 = Math.min(annotation.from.y, annotation.to.y) * height
      const y2 = Math.max(annotation.from.y, annotation.to.y) * height
      if (px >= x1 - slack && px <= x2 + slack && py >= y1 - slack && py <= y2 + slack) return index
      continue
    }

    if (annotation.tool === 'rect') {
      const x1 = annotation.from.x * width
      const x2 = annotation.to.x * width
      const y1 = annotation.from.y * height
      const y2 = annotation.to.y * height
      const nearVertical =
        Math.min(Math.abs(px - x1), Math.abs(px - x2)) <= reach &&
        py >= Math.min(y1, y2) - reach &&
        py <= Math.max(y1, y2) + reach
      const nearHorizontal =
        Math.min(Math.abs(py - y1), Math.abs(py - y2)) <= reach &&
        px >= Math.min(x1, x2) - reach &&
        px <= Math.max(x1, x2) + reach
      if (nearVertical || nearHorizontal) return index
      continue
    }

    if (annotation.tool === 'arrow' || annotation.tool === 'line') {
      const distance = distanceToSegment(
        px,
        py,
        annotation.from.x * width,
        annotation.from.y * height,
        annotation.to.x * width,
        annotation.to.y * height
      )
      if (distance <= reach + 2) return index
      continue
    }

    // Pen: any segment of the stroke.
    const points = annotation.points
    for (let at = 1; at < points.length; at++) {
      const distance = distanceToSegment(
        px,
        py,
        points[at - 1].x * width,
        points[at - 1].y * height,
        points[at].x * width,
        points[at].y * height
      )
      if (distance <= reach) return index
    }
  }
  return null
}
