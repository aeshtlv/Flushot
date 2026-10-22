import type { Rect } from '../../shared/types'
import { isTransposed } from '../../shared/virtualScreen'

/** RGBA pixels at a known size. Duplicated from the stitcher to keep this leaf pure. */
export interface RawBitmap {
  data: Uint8Array
  width: number
  height: number
}

/**
 * Quarter turns clockwise that bring a bitmap in line with its desktop bounds.
 *
 * The shape of the bitmap decides whether anything has to happen at all. A
 * capture whose aspect already matches its bounds is upright — whatever the
 * rotation flag says — and is returned untouched, because turning a correct
 * picture is the one mistake the user would certainly notice.
 *
 * Only a bitmap that really is sideways is turned. Windows reports the display
 * rotation, which gives the direction; when it reports 0 for a panel that is
 * clearly portrait, the usual portrait setting (90°) is assumed. The remaining
 * ambiguity is 90° versus 270°, which differ by half a turn: guessing wrong shows
 * the screen upside down, while not turning at all squashes it flat. Turning is
 * the better of the two, and the flag is right in practice.
 */
export function quarterTurnsFor(
  rotation: number | undefined,
  capture: { imageWidth: number; imageHeight: number; bounds: Rect }
): number {
  if (!isTransposed(capture)) return 0
  // A transposed bitmap needs one quarter turn; 180° would leave it transposed.
  return rotation === 270 ? 3 : 1
}

/** Rotate RGBA pixels by whole quarter turns, clockwise. */
export function rotateBitmap(bitmap: RawBitmap, quarterTurns: number): RawBitmap {
  const turns = ((quarterTurns % 4) + 4) % 4
  if (turns === 0 || bitmap.width <= 0 || bitmap.height <= 0) return bitmap

  if (turns === 2) {
    const { data, width, height } = bitmap
    const out = new Uint8Array(data.length)
    const source = new Uint32Array(data.buffer, data.byteOffset, width * height)
    const target = new Uint32Array(out.buffer)
    const last = width * height - 1
    for (let index = 0; index <= last; index++) target[last - index] = source[index]
    return { data: out, width, height }
  }

  const { data, width, height } = bitmap
  const out = new Uint8Array(data.length)
  const source = new Uint32Array(data.buffer, data.byteOffset, width * height)
  const target = new Uint32Array(out.buffer)

  if (turns === 1) {
    // Clockwise: (x, y) → (height - 1 - y, x).
    for (let y = 0; y < height; y++) {
      const row = y * width
      for (let x = 0; x < width; x++) {
        target[x * height + (height - 1 - y)] = source[row + x]
      }
    }
    return { data: out, width: height, height: width }
  }

  // Counter-clockwise: (x, y) → (y, width - 1 - x).
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      target[(width - 1 - x) * height + y] = source[row + x]
    }
  }
  return { data: out, width: height, height: width }
}

/** The frozen bitmap turned so that it matches its desktop bounds. */
export function uprightBitmap(
  bitmap: RawBitmap,
  capture: { bounds: Rect; rotation?: number }
): RawBitmap {
  const turns = quarterTurnsFor(capture.rotation, {
    imageWidth: bitmap.width,
    imageHeight: bitmap.height,
    bounds: capture.bounds
  })
  return turns === 0 ? bitmap : rotateBitmap(bitmap, turns)
}
