import type { AnnotationLayerPayload } from '../../shared/types'
import type { FrameLayout } from './layout'
import type { Raster } from './raster'

/**
 * Paint the user's drawing onto the finished card.
 *
 * The layer arrives as raw RGBA of the area that actually carries paint, at the
 * picture's own pixel size, so this is a byte copy with an alpha blend — no
 * decode, no encode, no resample. It used to go through sharp three times: a PNG
 * round trip to normalise the layer, then two full decodes and encodes of the
 * card, which cost 640 ms on a 1080p capture and two seconds on a 4K one.
 *
 * The card itself is returned as pixels too, so the caller encodes the finished
 * image exactly once, in the format the user asked for.
 *
 * The picture area is clipped to its rounded corners on the way in, so a stroke
 * drawn into a corner can never paint over the transparent notch.
 */
export function pasteAnnotationLayer(card: Raster, layout: FrameLayout, layer: AnnotationLayerPayload): Raster {
  const out: Raster = { data: new Uint8Array(card.data), width: card.width, height: card.height }

  if (!layer || layer.width <= 0 || layer.height <= 0) return out
  if (layer.data.length < layer.width * layer.height * 4) return out

  // The layer normally starts at the picture's own origin. Clamping both ways
  // keeps a layer that arrives slightly out of bounds from throwing the blend off.
  const offsetX = Math.round(layer.x)
  const offsetY = Math.round(layer.y)
  const skipX = Math.max(0, -offsetX)
  const skipY = Math.max(0, -offsetY)
  const startX = Math.max(0, offsetX)
  const startY = Math.max(0, offsetY)
  const columns = Math.min(Math.round(layer.width) - skipX, layout.width - startX)
  const rows = Math.min(Math.round(layer.height) - skipY, layout.height - startY)
  if (columns <= 0 || rows <= 0) return out

  const radius = Math.max(0, Math.min(layout.cornerRadius, Math.floor(Math.min(layout.width, layout.height) / 4)))
  const source = layer.data
  const target = out.data

  for (let y = 0; y < rows; y++) {
    const pictureY = startY + y
    let from = ((skipY + y) * Math.round(layer.width) + skipX) * 4
    let to = ((layout.y + pictureY) * card.width + layout.x + startX) * 4
    for (let x = 0; x < columns; x++) {
      const alpha = source[from + 3]
      if (alpha !== 0 && (radius === 0 || insideRounded(startX + x, pictureY, layout.width, layout.height, radius))) {
        if (alpha === 255) {
          target[to] = source[from]
          target[to + 1] = source[from + 1]
          target[to + 2] = source[from + 2]
        } else {
          // Straight (non-premultiplied) source over the opaque card.
          const keep = 255 - alpha
          target[to] = (source[from] * alpha + target[to] * keep) / 255
          target[to + 1] = (source[from + 1] * alpha + target[to + 1] * keep) / 255
          target[to + 2] = (source[from + 2] * alpha + target[to + 2] * keep) / 255
        }
      }
      from += 4
      to += 4
    }
  }

  return out
}

/**
 * Is a point inside a rounded rectangle?
 *
 * The four corner squares are the only place the answer can be "no", so they are
 * the only place that is computed; everywhere else costs one comparison. Doing
 * this per pixel is still cheaper than building a mask with sharp and compositing
 * the whole picture through it.
 */
function insideRounded(x: number, y: number, width: number, height: number, radius: number): boolean {
  if (x < 0 || y < 0 || x >= width || y >= height) return false

  const nearLeft = x < radius
  const nearRight = x >= width - radius
  if (!nearLeft && !nearRight) return true
  const nearTop = y < radius
  const nearBottom = y >= height - radius
  if (!nearTop && !nearBottom) return true

  const centreX = nearLeft ? radius : width - radius
  const centreY = nearTop ? radius : height - radius
  const dx = x - centreX
  const dy = y - centreY
  return dx * dx + dy * dy <= radius * radius
}
