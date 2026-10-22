/**
 * Draw the tray icon sheet for `docs/tray.png`.
 *
 * This exists because the tray icon is the one place the logo cannot be shown "as is" on
 * every background: the mark is a `#111111` tile, and the Windows dark taskbar is `#202020`.
 * The sheet shows the two colourings the app actually ships at the four sizes the
 * notification area asks for, so the decision can be judged from pixels rather than from a
 * description of pixels.
 *
 * The drawing is read from `logo/logo.svg` — the owner's file — and the second colouring is
 * produced by swapping the two brand colours, exactly as `TRAY_ICON_DARK_SVG` does in
 * `src/shared/logo.ts` (a swap that `tests/logo.test.ts` keeps honest).
 *
 * Run: `node scripts/make-tray-sheet.cjs`
 */
const fs = require('node:fs')
const path = require('node:path')
const sharp = require('sharp')

const ROOT = path.join(__dirname, '..')
const SOURCE = path.join(ROOT, 'logo', 'logo.svg')
const OUT = path.join(ROOT, 'docs', 'tray.png')

const TILE = '#111111'
const INK = '#A3C8F0'
const DARK_TASKBAR = { r: 32, g: 32, b: 32, alpha: 1 }
const LIGHT_TASKBAR = { r: 243, g: 243, b: 243, alpha: 1 }

const SIZES = [16, 20, 24, 32]
const ZOOM = 6

/** Swap the two brand colours, leaving the geometry untouched. */
function swapBrandColours(svg) {
  return svg.replace(/#(?:111111|A3C8F0)/gi, (hex) => (hex.toLowerCase() === TILE ? INK : TILE))
}

/** sharp decides the size, so any width/height in the markup has to go. */
function sized(svg, px) {
  return svg.replace(/<svg\b([^>]*)>/, (match, attributes) => {
    const cleaned = attributes.replace(/\s(?:width|height)="[^"]*"/g, '')
    return `<svg${cleaned} width="${px}" height="${px}">`
  })
}

/** Draw at 8× and downsample, the way the app's rasteriser does; then blow up for the eye. */
async function drawAt(svg, px, background) {
  const big = await sharp(Buffer.from(sized(svg, px * 8)))
    .resize(px * 8, px * 8, { fit: 'contain', background })
    .flatten({ background })
    .png()
    .toBuffer()
  const small = await sharp(big).resize(px, px, { kernel: 'lanczos3' }).png().toBuffer()
  return sharp(small).resize(px * ZOOM, px * ZOOM, { kernel: 'nearest' }).png().toBuffer()
}

async function main() {
  if (!fs.existsSync(SOURCE)) throw new Error(`missing ${SOURCE}`)
  const drawing = fs.readFileSync(SOURCE, 'utf8')
  const swapped = swapBrandColours(drawing)

  const rows = [
    ['as drawn', drawing, LIGHT_TASKBAR],
    ['as drawn', drawing, DARK_TASKBAR],
    ['swapped', swapped, DARK_TASKBAR],
    ['swapped', swapped, LIGHT_TASKBAR]
  ]

  const gap = 14
  const cell = SIZES[SIZES.length - 1] * ZOOM + gap
  const width = gap + cell * SIZES.length
  const height = gap + cell * rows.length

  const composites = []
  for (let row = 0; row < rows.length; row++) {
    const [, svg, background] = rows[row]
    const top = gap + row * cell
    composites.push({
      input: await sharp({
        create: { width: width - gap * 2, height: cell - gap, channels: 4, background }
      })
        .png()
        .toBuffer(),
      left: gap,
      top
    })
    for (let column = 0; column < SIZES.length; column++) {
      const px = SIZES[column]
      composites.push({
        input: await drawAt(svg, px, background),
        left: gap + column * cell + (cell - gap - px * ZOOM) / 2,
        top: top + (cell - gap - px * ZOOM) / 2
      })
    }
  }

  await fs.promises.mkdir(path.dirname(OUT), { recursive: true })
  await sharp({ create: { width, height, channels: 4, background: LIGHT_TASKBAR } })
    .composite(composites)
    .png()
    .toFile(OUT)

  console.log(`docs/tray.png  ${width}×${height}`)
  for (const [name, , background] of rows) {
    const which = background === DARK_TASKBAR ? 'dark taskbar' : 'light taskbar'
    console.log(`  ${name.padEnd(9)} on ${which}`)
  }
  console.log(`  ${SIZES.join(' · ')} px, drawn at ${ZOOM}× with nearest neighbour`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
