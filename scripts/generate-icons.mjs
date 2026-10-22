/**
 * Generates the application icon used by electron-builder.
 * Run with `npm run icons`; the generated files are checked in as build assets.
 *
 * The drawing is not written here. It comes from `logo/logo.svg`, the file the
 * owner supplied, so that changing the logo means changing one file — this script
 * only turns it into the formats Windows and electron-builder ask for. The tray
 * previews are the same file, one of them with its two brand colours swapped for a
 * dark taskbar; there is no second drawing anywhere.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const buildDir = path.join(root, 'build')

/**
 * The supplied SVG has a `viewBox` but no `width`/`height`, so librsvg renders it at
 * a default size and upscaling that to 512 px is visibly soft. Pinning the intrinsic
 * size makes the rasteriser work at the target resolution instead.
 */
function withSize(svg, px) {
  return svg.replace(/<svg\b([^>]*)>/, (match, attrs) => {
    const cleaned = attrs.replace(/\s(?:width|height)="[^"]*"/g, '')
    return `<svg${cleaned} width="${px}" height="${px}">`
  })
}

async function rasterise(svg, size) {
  // Render at four times the target and let sharp downsample: that is what makes the
  // 16 px frame in the .ico legible rather than a grey square.
  const big = Math.min(2048, Math.max(256, size * 4))
  return sharp(Buffer.from(withSize(svg, big)))
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()
}

/**
 * Minimal ICO writer: a 6-byte header, one 16-byte directory entry per size and
 * PNG-compressed frames (supported since Windows Vista, which covers Win 10/11).
 */
function buildIco(frames) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(frames.length, 4)

  const entries = []
  let offset = 6 + 16 * frames.length
  for (const frame of frames) {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(frame.size >= 256 ? 0 : frame.size, 0) // width (0 means 256)
    entry.writeUInt8(frame.size >= 256 ? 0 : frame.size, 1) // height
    entry.writeUInt8(0, 2) // palette
    entry.writeUInt8(0, 3) // reserved
    entry.writeUInt16LE(1, 4) // colour planes
    entry.writeUInt16LE(32, 6) // bits per pixel
    entry.writeUInt32LE(frame.png.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += frame.png.length
    entries.push(entry)
  }

  return Buffer.concat([header, ...entries, ...frames.map((frame) => frame.png)])
}

/**
 * The tray drawing for a dark taskbar: the same mark with its two brand colours
 * swapped, because the tile is #111111 and the Windows dark taskbar is #202020 — 1.05:1,
 * which is not a visible square. Both colours are the logo's own; only which one is the
 * figure changes. The app applies exactly this rule in `src/shared/logo.ts`, and the
 * file written here is a preview of it, not the icon the app loads.
 */
function swapBrandColours(svg) {
  return svg.replace(/#(?:111111|A3C8F0)/gi, (hex) => (hex.toLowerCase() === '#111111' ? '#A3C8F0' : '#111111'))
}

await mkdir(buildDir, { recursive: true })

const appSvg = await readFile(path.join(root, 'logo', 'logo.svg'), 'utf8')

const sizes = [16, 32, 48, 64, 128, 256]
const frames = []
for (const size of sizes) {
  frames.push({ size, png: await rasterise(appSvg, size) })
}

await writeFile(path.join(buildDir, 'icon.png'), await rasterise(appSvg, 512))
await writeFile(path.join(buildDir, 'icon.ico'), buildIco(frames))
await writeFile(path.join(buildDir, 'tray.png'), await rasterise(appSvg, 32))
await writeFile(path.join(buildDir, 'tray-dark.png'), await rasterise(swapBrandColours(appSvg), 32))

console.log(`Icons written to build/ from logo/logo.svg (ico frames: ${sizes.join(', ')})`)
