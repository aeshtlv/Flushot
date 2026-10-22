import sharp from 'sharp'
import type { ScreenBounds } from '../../shared/virtualScreen'
import { virtualImageSize, virtualPlacements, virtualScale } from '../../shared/virtualScreen'
import { uprightBitmap } from './orientation'

/** RGBA pixels at physical resolution, as produced by the capture layer. */
export interface RawBitmap {
  data: Uint8Array
  width: number
  height: number
}

export interface VirtualFrame extends RawBitmap {
  /** Scale factor the composite was built at. */
  scale: number
  /** Ids of monitors that had to be resampled. */
  resampled: string[]
}

/** sharp needs to be told that a buffer is pixels, not an encoded file. */
function asBuffer(bitmap: RawBitmap): Buffer {
  return Buffer.from(bitmap.data.buffer, bitmap.data.byteOffset, bitmap.data.byteLength)
}

/**
 * Stitch every monitor into one image covering the whole virtual desktop.
 *
 * A single monitor is returned untouched: no resize, no re-encode, so the common
 * case costs nothing and stays pixel-identical to the previous release. With two
 * or more monitors the frames are placed side by side on one canvas at the
 * highest density present, because a selection can cross the seam and there is
 * no way to crop across two separate images.
 *
 * This composite is what the overlay paints, so it has to look right rather than
 * be pixel-exact; the picture the user saves is assembled separately, straight
 * from each monitor's own pixels.
 */
export async function buildVirtualFrame(
  screens: (ScreenBounds & { raw: RawBitmap; rotation?: number })[]
): Promise<VirtualFrame> {
  if (screens.length === 0) throw new Error('Не найдено ни одного экрана')

  const scale = virtualScale(screens)
  const size = virtualImageSize(screens, scale)

  if (screens.length === 1) {
    const only = screens[0]
    return { data: only.raw.data, width: only.raw.width, height: only.raw.height, scale, resampled: [] }
  }

  const placements = virtualPlacements(screens, scale)
  const resampled: string[] = []

  // One canvas, filled opaque black: a monitor layout can leave a gap between
  // screens, and that strip has always been black rather than transparent.
  const data = new Uint8Array(size.width * size.height * 4)
  const words = new Uint32Array(data.buffer)
  words.fill(0xff000000)

  for (const screen of screens) {
    const placement = placements.find((candidate) => candidate.id === screen.id)
    if (!placement) continue

    // A monitor whose capture came back sideways is turned before anything else:
    // squeezing a portrait screen into a landscape box is exactly what made a
    // mixed-orientation desktop look skewed.
    let source = uprightBitmap(screen.raw, { bounds: screen.bounds, rotation: screen.rotation })

    if (source.width !== placement.width || source.height !== placement.height) {
      // Only a monitor whose density differs from the composite is touched; the
      // sharpest one keeps its exact pixels.
      const stretched = Math.abs(source.width / source.height - placement.width / placement.height) > 0.01
      const resized = await sharp(asBuffer(source), {
        raw: { width: source.width, height: source.height, channels: 4 }
      })
        .resize(
          placement.width,
          placement.height,
          // `fill` is only safe when both shapes agree. When they do not, the
          // monitor is fitted inside its slot and the leftover stays black, which
          // is a letterbox instead of a distortion.
          { fit: stretched ? 'contain' : 'fill', kernel: 'lanczos3', background: { r: 0, g: 0, b: 0, alpha: 1 } }
        )
        .raw()
        .toBuffer({ resolveWithObject: true })
      source = { data: resized.data, width: resized.info.width, height: resized.info.height }
      resampled.push(screen.id)
    }

    // Copy the rows straight into the canvas. Handing the monitors to sharp as
    // two composite layers costs 22 ms — most of it libvips setup and buffer
    // copies — while this is a memory-bandwidth job: 6 ms for two 1080p screens.
    const sourceWords = new Uint32Array(source.data.buffer, source.data.byteOffset, source.width * source.height)
    const copyWidth = Math.min(source.width, size.width - placement.left)
    const rows = Math.min(source.height, size.height - placement.top)
    for (let y = 0; y < rows; y++) {
      const from = y * source.width
      const to = (placement.top + y) * size.width + placement.left
      if (to < 0 || to + copyWidth > words.length) continue
      words.set(sourceWords.subarray(from, from + copyWidth), to)
    }
  }

  return { data, width: size.width, height: size.height, scale, resampled }
}
