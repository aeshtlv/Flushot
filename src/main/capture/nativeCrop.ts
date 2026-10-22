import sharp from 'sharp'
import type { Rect } from '../../shared/types'
import type { CropPlan } from '../../shared/virtualScreen'
import { uprightBitmap, type RawBitmap } from './orientation'

/** One monitor's frozen pixels, with what is needed to put them the right way up. */
export interface MonitorSource {
  id: string
  /** Pixels as the capture layer returned them, in its own channel order (BGRA). */
  bitmap: RawBitmap
  /** Desktop bounds in device-independent pixels. */
  bounds: Rect
  /** Rotation Windows reports for this display. */
  rotation?: number
}

/** Bytes per pixel; RGBA and BGRA are both four. */
const BPP = 4

/**
 * Assemble a selection from the monitors' own pixels.
 *
 * Every part is taken from the monitor it belongs to at that monitor's native
 * resolution, so a region drawn on one screen is a byte-for-byte copy of what the
 * screen showed — no upscale, no seam artefacts, no softening. Only a monitor
 * whose density differs from the output's is resampled, and then exactly once.
 */
export async function cropFromMonitors(sources: MonitorSource[], plan: CropPlan): Promise<RawBitmap> {
  const canvas = new Uint8Array(plan.width * plan.height * BPP)
  // A gap between screens is black, not transparent: that is what the composite
  // shows, and what the user saw when drawing the selection.
  new Uint32Array(canvas.buffer).fill(0xff000000)

  for (const part of plan.parts) {
    const source = sources.find((candidate) => candidate.id === part.id)
    if (!source) continue

    const upright = uprightBitmap(source.bitmap, { bounds: source.bounds, rotation: source.rotation })
    const sameSize = part.source.width === part.target.width && part.source.height === part.target.height

    if (!part.resampled && sameSize) {
      blitSwapped(upright, part.source, canvas, plan.width, part.target)
      continue
    }

    const scaled = await sharp(toRgba(upright, part.source), {
      raw: { width: part.source.width, height: part.source.height, channels: BPP }
    })
      .resize(part.target.width, part.target.height, { fit: 'fill', kernel: 'lanczos3' })
      .raw()
      .toBuffer({ resolveWithObject: true })

    blit(scaled.data, scaled.info.width, scaled.info.height, canvas, plan.width, part.target)
  }

  return { data: canvas, width: plan.width, height: plan.height }
}

/**
 * Copy a rectangle of the monitor straight into the canvas, swapping blue and red.
 *
 * Electron hands out BGRA while every encoder wants RGBA. Doing the swap during
 * the copy is free; asking sharp to decode and re-encode the whole monitor to fix
 * the channel order would cost more than the capture itself.
 */
function blitSwapped(source: RawBitmap, area: Rect, canvas: Uint8Array, canvasWidth: number, target: Rect): void {
  const data = source.data
  const rows = Math.min(area.height, target.height)
  const columns = Math.min(area.width, target.width)

  for (let y = 0; y < rows; y++) {
    let from = ((area.y + y) * source.width + area.x) * BPP
    let to = ((target.y + y) * canvasWidth + target.x) * BPP
    for (let x = 0; x < columns; x++) {
      canvas[to] = data[from + 2]
      canvas[to + 1] = data[from + 1]
      canvas[to + 2] = data[from]
      canvas[to + 3] = data[from + 3]
      from += BPP
      to += BPP
    }
  }
}

/** Copy already-RGBA pixels into the canvas. */
function blit(rows: Uint8Array, width: number, height: number, canvas: Uint8Array, canvasWidth: number, target: Rect): void {
  const columns = Math.min(width, target.width)
  const lines = Math.min(height, target.height)
  for (let y = 0; y < lines; y++) {
    const from = y * width * BPP
    const to = ((target.y + y) * canvasWidth + target.x) * BPP
    canvas.set(rows.subarray(from, from + columns * BPP), to)
  }
}

/** A rectangle of BGRA pixels as RGBA, ready for sharp. */
function toRgba(source: RawBitmap, area: Rect): Buffer {
  const out = Buffer.allocUnsafe(area.width * area.height * BPP)
  const data = source.data
  for (let y = 0; y < area.height; y++) {
    let from = ((area.y + y) * source.width + area.x) * BPP
    let to = y * area.width * BPP
    for (let x = 0; x < area.width; x++) {
      out[to] = data[from + 2]
      out[to + 1] = data[from + 1]
      out[to + 2] = data[from]
      out[to + 3] = data[from + 3]
      from += BPP
      to += BPP
    }
  }
  return out
}
