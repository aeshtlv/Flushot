import sharp from 'sharp'
import { parseHexColor } from './color'
import type { ComposeOptions } from './compose'
import type { FrameLayout } from './layout'

/** RGBA pixels at a known size, exactly as an image encoder wants them. */
export interface Raster {
  data: Uint8Array
  width: number
  height: number
}

/**
 * A blurred rounded corner plus the straight-edge profile that goes with it.
 *
 * The shadow used to be rasterised as an SVG the full size of the card and then
 * blurred: ~100 ms of work for a 1600 × 1300 picture, twice per capture. But a
 * blurred rectangle is separable — its coverage is `fx(x) · fy(y)` — and only the
 * four corners are genuinely two-dimensional. So one small tile is blurred once
 * and reused: corners are copied from it, edges are read off its profile, and the
 * middle is solid.
 */
interface CornerTile {
  /** Coverage (0–255) of the top-left corner block, `stride × stride` bytes. */
  alpha: Uint8Array
  stride: number
  /** How far the blur reaches outside the card. */
  pad: number
  /** Coverage at a given distance from a straight edge, offset by `pad`. */
  profile: Uint8Array
}

const tileCache = new Map<string, CornerTile>()

/**
 * Rasterise a rounded corner, blur it, and keep the block that is safe to reuse.
 *
 * The SVG is drawn larger than the block that is kept, and its rectangle extends
 * past the tile: the blur has to see the solid interior on its inner sides, or
 * the corner would fade out towards the middle of the card.
 */
async function cornerTile(radius: number, sigma: number): Promise<CornerTile> {
  const key = `${radius.toFixed(2)}|${sigma.toFixed(2)}`
  const cached = tileCache.get(key)
  if (cached) return cached

  const pad = Math.ceil(sigma * 3) + 2
  // The kept block reaches past the corner and past the blur's tail.
  const size = Math.max(1, Math.ceil(radius + sigma * 3)) + 2
  const stride = pad + size

  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${stride}" height="${stride}" viewBox="0 0 ${stride} ${stride}">` +
      `<rect x="${pad}" y="${pad}" width="${stride}" height="${stride}" rx="${radius}" ry="${radius}" fill="#ffffff"/></svg>`
  )

  let pipeline = sharp(svg).ensureAlpha().extractChannel('alpha').toColourspace('b-w')
  if (sigma > 0) pipeline = pipeline.blur(sigma)
  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true })
  if (info.width !== stride || info.height !== stride) throw new Error('Не удалось построить маску тени')

  // The last row is solid along its whole length (the shape extends past the
  // tile), so it is exactly the straight-edge profile.
  const profile = new Uint8Array(stride)
  for (let index = 0; index < stride; index++) profile[index] = data[(stride - 1) * stride + index]

  const tile: CornerTile = {
    alpha: new Uint8Array(data.buffer, data.byteOffset, data.length),
    stride,
    pad,
    profile
  }
  if (tileCache.size > 32) tileCache.clear()
  tileCache.set(key, tile)
  return tile
}

/** Coverage at `distance` pixels outside (negative) or inside a straight edge. */
function edgeCoverage(tile: CornerTile, distance: number): number {
  const index = distance + tile.pad
  if (index < 0) return 0
  if (index >= tile.profile.length) return 255
  return tile.profile[index]
}

/**
 * Blend one blurred silhouette of the card into the canvas as black at the given
 * opacity. Pixels the card itself will cover are skipped — except the four
 * rounded corners, which let the shadow through.
 */
function blendShadow(
  canvas: Raster,
  tile: CornerTile,
  cardWidth: number,
  cardHeight: number,
  frame: number,
  offsetY: number,
  alpha: number
): void {
  const level = Math.max(0, Math.min(255, Math.round(alpha * 255)))
  if (level === 0 || cardWidth <= 0 || cardHeight <= 0) return

  const words = new Uint32Array(canvas.data.buffer, canvas.data.byteOffset, canvas.width * canvas.height)
  const stride = canvas.width
  const { pad, stride: tileStride } = tile
  const cardX = frame
  const cardY = frame + offsetY

  const top = Math.max(0, cardY - pad)
  const bottom = Math.min(canvas.height, cardY + cardHeight + pad)
  const left = Math.max(0, cardX - pad)
  const right = Math.min(canvas.width, cardX + cardWidth + pad)

  for (let y = top; y < bottom; y++) {
    // Two coordinate systems: the shadow is shifted down by `offsetY`, so its own
    // silhouette and the card that covers it do not line up. Mixing them leaves a
    // bright band exactly under the picture, where the shadow is thickest.
    const v = y - cardY
    const cardV = y - frame
    const shadowVertical = Math.min(v, cardHeight - 1 - v)
    const cardVertical = Math.min(cardV, cardHeight - 1 - cardV)
    const shadowNearEdge = shadowVertical < tile.stride - pad
    const cardNearEdge = cardVertical < tile.stride - pad
    const rowBase = y * stride

    for (let x = left; x < right; x++) {
      const u = x - cardX
      const horizontal = Math.min(u, cardWidth - 1 - u)
      const nearHorizontalEdge = horizontal < tile.stride - pad

      // The card will paint over this pixel, so the shadow underneath is invisible
      // — unless it is one of the four rounded corners.
      const inside = cardV >= 0 && cardV < cardHeight && u >= 0 && u < cardWidth
      if (inside && !(nearHorizontalEdge && cardNearEdge)) continue

      let coverage: number
      if (nearHorizontalEdge && shadowNearEdge) {
        const column = horizontal + pad
        const row = shadowVertical + pad
        coverage =
          column >= 0 && column < tileStride && row >= 0 && row < tileStride
            ? tile.alpha[row * tileStride + column]
            : 0
      } else if (nearHorizontalEdge) {
        coverage = edgeCoverage(tile, horizontal)
      } else if (shadowNearEdge) {
        coverage = edgeCoverage(tile, shadowVertical)
      } else {
        coverage = 255
      }

      if (coverage === 0) continue

      const a = (coverage * level) / 255
      if (a < 1) continue

      const index = rowBase + x
      const pixel = words[index]
      const keep = 1 - a / 255
      const r = ((pixel & 0xff) * keep) | 0
      const g = (((pixel >>> 8) & 0xff) * keep) | 0
      const b = (((pixel >>> 16) & 0xff) * keep) | 0
      words[index] = (0xff000000 | (b << 16) | (g << 8) | r) >>> 0
    }
  }
}

/** Anti-aliased coverage of a rounded corner at one pixel of the corner block. */
function cornerCoverage(radius: number, x: number, y: number): number {
  const dx = radius - (x + 0.5)
  const dy = radius - (y + 0.5)
  if (dx <= 0 || dy <= 0) return 255
  const distance = Math.sqrt(dx * dx + dy * dy)
  const coverage = radius - distance + 0.5
  return coverage <= 0 ? 0 : coverage >= 1 ? 255 : Math.round(coverage * 255)
}

/**
 * Copy the cropped screenshot onto the canvas and round its corners.
 *
 * The interior is a straight row copy — 4 bytes per pixel, no blending. The four
 * corner blocks are left untouched by the copy, so the frame and the shadow that
 * are already there stay visible wherever the rounded corner cuts the picture
 * away; only those 4 × r² pixels need alpha.
 */
function drawCard(canvas: Raster, source: Raster, area: { x: number; y: number; width: number; height: number }, layout: FrameLayout): void {
  const width = Math.min(area.width, source.width - area.x)
  const height = Math.min(area.height, source.height - area.y)
  if (width <= 0 || height <= 0) throw new Error('Пустая область выделения')

  const destination = new Uint32Array(canvas.data.buffer, canvas.data.byteOffset, canvas.width * canvas.height)
  const origin = new Uint32Array(source.data.buffer, source.data.byteOffset, source.width * source.height)
  const radius = Math.min(Math.max(0, layout.cornerRadius), Math.floor(Math.min(width, height) / 2))

  for (let row = 0; row < height; row++) {
    const from = (area.y + row) * source.width + area.x
    const to = (layout.y + row) * canvas.width + layout.x
    const cornerBand = radius > 0 && (row < radius || row >= height - radius)
    if (cornerBand) {
      const start = radius
      const end = width - radius
      if (end > start) destination.set(origin.subarray(from + start, from + end), to + start)
    } else {
      destination.set(origin.subarray(from, from + width), to)
    }
    // The card covers the background completely, so its pixels are opaque by
    // definition. Forcing the alpha byte keeps the canvas honest for any source,
    // and lets the encoder drop the channel entirely.
    const rowEnd = to + width
    for (let index = to; index < rowEnd; index++) destination[index] |= 0xff000000
  }

  if (radius <= 0) return

  const corners: [number, number, boolean, boolean][] = [
    [0, 0, false, false],
    [width - radius, 0, true, false],
    [0, height - radius, false, true],
    [width - radius, height - radius, true, true]
  ]

  for (const [cornerX, cornerY, mirrorX, mirrorY] of corners) {
    for (let row = 0; row < radius; row++) {
      const localY = mirrorY ? radius - 1 - row : row
      const sourceRow = (area.y + cornerY + row) * source.width + area.x + cornerX
      for (let column = 0; column < radius; column++) {
        const localX = mirrorX ? radius - 1 - column : column
        const coverage = cornerCoverage(radius, localX, localY)
        const index = (layout.y + cornerY + row) * canvas.width + layout.x + cornerX + column
        const card = origin[sourceRow + column]

        if (coverage >= 255) {
          destination[index] = card
          continue
        }
        // Fully outside the rounded corner: the frame and the shadow already show.
        if (coverage <= 0) continue

        const keep = coverage / 255
        const under = destination[index]
        const mix = (channel: number, other: number): number => (channel * keep + other * (1 - keep)) | 0
        const r = mix(card & 0xff, under & 0xff)
        const g = mix((card >>> 8) & 0xff, (under >>> 8) & 0xff)
        const b = mix((card >>> 16) & 0xff, (under >>> 16) & 0xff)
        destination[index] = (0xff000000 | (b << 16) | (g << 8) | r) >>> 0
      }
    }
  }
}

/**
 * Draw the cropped screenshot onto the frame, with rounded corners and a shadow.
 *
 * Everything happens on one buffer: crop, corner mask, shadow and frame. Doing it
 * here rather than through a chain of image operations is what keeps a capture
 * under 100 ms — no intermediate encode, no decode, no per-layer buffer copies.
 */
export async function composeCardRaster(
  source: Raster,
  area: { x: number; y: number; width: number; height: number },
  layout: FrameLayout,
  options: ComposeOptions
): Promise<Raster> {
  const canvas: Raster = {
    data: new Uint8Array(layout.canvasWidth * layout.canvasHeight * 4),
    width: layout.canvasWidth,
    height: layout.canvasHeight
  }

  const background = parseHexColor(options.backgroundColor)
  const words = new Uint32Array(canvas.data.buffer)
  words.fill((0xff000000 | (background.b << 16) | (background.g << 8) | background.r) >>> 0)

  const intensity = Math.min(60, Math.max(0, options.shadowIntensity)) / 100
  const radius = layout.cornerRadius
  const cardWidth = Math.min(area.width, source.width - area.x)
  const cardHeight = Math.min(area.height, source.height - area.y)

  if (options.shadowEnabled && intensity > 0 && layout.frame > 0 && cardWidth > 0 && cardHeight > 0) {
    const roomForBlur = Math.max(2, layout.frame * 0.5)
    const roomForOffset = Math.max(1, layout.frame * 0.25)
    const blur = Math.min(Math.min(48, Math.max(0, options.shadowBlur)), roomForBlur)
    const offsetY = Math.min(Math.min(24, Math.max(0, options.shadowOffsetY)), roomForOffset)

    // Two layers, like macOS Quick Look: a tight contact shadow that grounds the
    // card and a wide ambient shadow that gives it depth.
    const layers = [
      { blur: Math.max(2, blur * 0.3), offsetY: Math.max(1, offsetY * 0.4), alpha: intensity * 0.55 },
      { blur, offsetY, alpha: intensity }
    ]

    for (const layer of layers) {
      if (layer.alpha <= 0) continue
      const tile = await cornerTile(radius, layer.blur / 2)
      blendShadow(canvas, tile, cardWidth, cardHeight, layout.frame, Math.round(layer.offsetY), layer.alpha)
    }
  }

  drawCard(canvas, source, area, layout)
  return canvas
}
