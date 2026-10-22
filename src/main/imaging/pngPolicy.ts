import type { Raster } from './raster'

/**
 * Which PNG filter strategy to use for a finished card.
 *
 * libvips picks a filter per row when adaptive filtering is on, which costs three
 * to five times more than one fixed filter. On a real screenshot that is the
 * difference between 167 ms and 41 ms for the same pixels; the file grows by
 * under 10 %, because screen content is mostly flat and any filter does well on
 * it. On noise — a photo, a video, a gradient with dithering — the same switch
 * makes the file two to three times larger, because only per-row filtering can
 * follow that content.
 *
 * Measured on this machine (`.tmp/bench-native.cjs`, `.tmp/bench-flat.cjs`), share
 * of sampled neighbouring pixels that are exactly the same colour:
 *
 * | content                     | flat  | adaptive          | fixed            | size   |
 * |-----------------------------|-------|-------------------|------------------|--------|
 * | native 1280 × 720 screenshot| 77 %  |  45 ms / 195 KB   | 17 ms / 192 KB   | −1 %   |
 * | native 4K screenshot        | 68 %  | 321 ms / 730 KB   | 67 ms / 763 KB   | +5 %   |
 * | annotated screenshot        | 75 %  |  52 ms / 194 KB   | 18 ms / 190 KB   | −2 %   |
 * | multi-monitor shot          | 74 %  |  44 ms / 210 KB   | 21 ms / 216 KB   | +3 %   |
 * | resampled marketing art, 4K | 79 %  | 473 ms / 589 KB   | 68 ms / 779 KB   | +32 %  |
 * | synthetic gradient + noise  | 1–4 % | 158 ms / 877 KB   | 139 ms / 2.8 MB  | +227 % |
 *
 * So flatness — not contrast, not brightness — is the signal that separates the
 * two cases, and the gap is wide enough that a 60 % threshold is never close to
 * either side. A screenshot, which is what this app produces, gets the fast
 * filter for free or nearly free. Smooth gradients lose up to a third of the
 * bytes, which is a real trade: less time, slightly larger file, never a
 * different pixel. Anything below the threshold keeps the slower, smaller path.
 */
export const FLAT_THRESHOLD = 0.6

/** Roughly how many pixels to look at; enough to be stable, cheap to compute. */
const SAMPLE_TARGET = 40_000

export interface PngPolicy {
  compressionLevel: number
  adaptiveFiltering: boolean
  /** Share of sampled neighbours that were identical, 0–1. */
  flatness: number
}

/**
 * Measure how flat an image is: the share of sampled horizontal neighbours that
 * have exactly the same colour.
 *
 * A stride is used rather than a blur or a histogram, because the question is not
 * "how much detail" but "does this content consist of flat runs", which is what
 * makes a fixed filter good enough.
 */
export function flatness(raster: Raster): number {
  const { data, width, height } = raster
  if (width < 2 || height < 1) return 0

  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / SAMPLE_TARGET)))
  let flat = 0
  let total = 0

  for (let y = 0; y < height; y += step) {
    const row = y * width
    for (let x = 0; x + step < width; x += step) {
      const a = (row + x) * 4
      const b = (row + x + step) * 4
      // Alpha is not compared: the card is opaque everywhere except its corners,
      // and a transparent pixel next to an opaque one says nothing about detail.
      if (data[a] === data[b] && data[a + 1] === data[b + 1] && data[a + 2] === data[b + 2]) flat++
      total++
    }
  }

  return total === 0 ? 0 : flat / total
}

/**
 * Pick the encoder settings for a finished card.
 *
 * Lossless either way: only the time and the file size change, never a pixel.
 */
export function choosePngPolicy(raster: Raster, compressionLevel = 5): PngPolicy {
  const flat = flatness(raster)
  return {
    compressionLevel,
    adaptiveFiltering: flat < FLAT_THRESHOLD,
    flatness: flat
  }
}
