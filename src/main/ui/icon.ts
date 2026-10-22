import { nativeImage, type NativeImage } from 'electron'
import sharp from 'sharp'
import { APP_ICON_SVG, TRAY_ICON_DARK_SVG, TRAY_ICON_SVG } from '../../shared/logo'

const cache = new Map<string, NativeImage>()

/**
 * Rasterise an SVG at four times the target and downsample.
 *
 * Rendering straight at 16 px gives the rasteriser a sixteenth of the detail it needs
 * and every edge lands between pixels; rendering large and averaging is what keeps a
 * small icon from turning into a grey square.
 */
async function rasterize(svg: string, size: number): Promise<Buffer> {
  const big = Math.min(2048, Math.max(256, size * 4))
  const sized = svg.replace(/<svg\b([^>]*)>/, (_match, attrs: string) => {
    const cleaned = attrs.replace(/\s(?:width|height)="[^"]*"/g, '')
    return `<svg${cleaned} width="${big}" height="${big}">`
  })
  return sharp(Buffer.from(sized))
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()
}

/**
 * The window icon: the mark at full colour.
 *
 * The geometry lives in `src/shared/logo.ts` rather than here, because the same
 * drawing also has to reach the tray, the settings title bar and the site — and
 * three copies of a logo is how a rebrand ends up half-applied.
 */
export async function getAppIcon(size = 256): Promise<NativeImage> {
  const key = `app:${size}`
  const cached = cache.get(key)
  if (cached) return cached
  const image = nativeImage.createFromBuffer(await rasterize(APP_ICON_SVG, size))
  cache.set(key, image)
  return image
}

/**
 * The tray icon: the mark at every size the notification area asks for.
 *
 * Windows asks for 16 px at 100 % scaling, 20 px at 125 % and 24 px at 150 %, and it
 * asks by DPI rather than telling us the size, so the icon carries all three
 * representations and lets the shell pick. Without them Electron hands Windows one
 * bitmap and Windows resamples it, which at 16 px is the difference between the mark
 * and a smudge.
 *
 * `darkTaskbar` chooses between the two colourings in `logo.ts`. It is the only way the
 * tile is visible on both: the mark's own tile is `#111111`, which against the `#202020`
 * dark taskbar is 1.1:1 — present in the file, absent on screen.
 */
export async function getTrayIcon(darkTaskbar = false): Promise<NativeImage> {
  const key = `tray:${darkTaskbar}`
  const cached = cache.get(key)
  if (cached) return cached

  const svg = darkTaskbar ? TRAY_ICON_DARK_SVG : TRAY_ICON_SVG
  const sizes = [16, 20, 24, 32]
  const buffers = await Promise.all(sizes.map((size) => rasterize(svg, size)))
  const image = nativeImage.createFromBuffer(buffers[0])
  // `addRepresentation` is what makes the extra sizes reach Windows: the base image is
  // the 16 px one, and each addition is tagged with its scale factor relative to it.
  for (let index = 1; index < sizes.length; index += 1) {
    image.addRepresentation({
      scaleFactor: sizes[index] / sizes[0],
      width: sizes[index],
      height: sizes[index],
      buffer: buffers[index]
    })
  }
  cache.set(key, image)
  return image
}

export async function getTrayIconPng(size = 16, darkTaskbar = false): Promise<Buffer> {
  return rasterize(darkTaskbar ? TRAY_ICON_DARK_SVG : TRAY_ICON_SVG, size)
}
