/**
 * Prepares the static site in `site/`.
 *
 * The HTML, CSS and JS are hand-written — this script only produces the assets
 * that are tedious to make by hand and easy to get wrong:
 *
 *  - web-optimised copies of the real screenshots (WebP + PNG fallback, sized to
 *    the widest place they are shown, so nothing is upscaled on a 2x display),
 *  - the favicon set, rasterised from the same SVG the app itself uses,
 *  - the social preview image,
 *  - the download archives, copied in so the folder works on its own.
 *
 * Usage: node scripts/build-site.cjs [--skip-downloads]
 */

const path = require('node:path')
const fs = require('node:fs/promises')
const { existsSync, readFileSync } = require('node:fs')
const sharp = require('sharp')

const ROOT = path.join(__dirname, '..')
const SITE = path.join(ROOT, 'site')
const ASSETS = path.join(SITE, 'assets')
const DOWNLOADS = path.join(SITE, 'downloads')

// The app icon, taken from `logo/logo.svg` — the file the owner supplied, and the
// same drawing the program rasterises for its window icon and the site header uses.
// Reading the file instead of copying the markup here means a logo change reaches
// the site by itself; `tests/logo.test.ts` guards the app's copy of it.
//
// Not trimmed: `site/favicon.svg` is then byte-identical to the source, so
// `verify-site.cjs` can prove the two have not drifted instead of comparing
// pictures. Leading whitespace before an XML root element is legal.
const APP_ICON_SVG = readFileSync(path.join(ROOT, 'logo', 'logo.svg'), 'utf8')

/**
 * The supplied SVG has a `viewBox` but no `width`/`height`, so librsvg renders it at
 * a default size and scaling that up to 512 px is soft. Pinning the intrinsic size
 * makes the rasteriser work at the target resolution.
 */
function svgAtSize(svg, px) {
  return svg.replace(/<svg\b([^>]*)>/, (match, attrs) => {
    const cleaned = attrs.replace(/\s(?:width|height)="[^"]*"/g, '')
    return `<svg${cleaned} width="${px}" height="${px}">`
  })
}

async function rasteriseIcon(svg, size) {
  const big = Math.min(2048, Math.max(256, size * 4))
  return sharp(Buffer.from(svgAtSize(svg, big)))
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()
}

/**
 * Images the page shows.
 *
 * `width` is the rendered width in CSS pixels at the largest breakpoint; the
 * file is written at twice that, which is what a Retina-class display asks for.
 * Anything narrower is a waste of bandwidth on a landing page.
 */
const IMAGES = [
  // The hero is a real Flushot output of the synthetic demo scene, not a capture
  // of whatever was on the author's desktop. See scripts/make-hero-image.cjs.
  { src: 'docs/hero-framed.png', out: 'hero', width: 820, height: null },
  { src: 'docs/ui-overlay.png', out: 'overlay', width: 640, height: null },
  { src: 'docs/ui-annotate.png', out: 'annotate', width: 640, height: null },
  { src: 'docs/ui-ocr.png', out: 'ocr', width: 640, height: null },
  { src: 'docs/ui-settings.png', out: 'settings', width: 260, height: null },
  { src: 'docs/multi-monitor.png', out: 'monitors', width: 420, height: null }
]

const DOWNLOAD_FILES = [
  'Flushot-2.2.8-win64.zip',
  'Flushot-2.2.8-installer.zip',
  'Flushot-2.2.8-portable.zip'
]

async function ensureDirs() {
  for (const dir of [SITE, ASSETS, DOWNLOADS]) {
    await fs.mkdir(dir, { recursive: true })
  }
}

async function buildImages() {
  const rows = []
  for (const image of IMAGES) {
    const source = path.join(ROOT, image.src)
    if (!existsSync(source)) throw new Error(`missing source image: ${image.src}`)

    const meta = await sharp(source).metadata()
    // Never upscale: a 520px-wide settings panel rendered at 520 stays 520.
    const targetWidth = Math.min(Math.round(image.width * 2), meta.width)
    const base = sharp(source).resize({ width: targetWidth, withoutEnlargement: true })

    const pngPath = path.join(ASSETS, `${image.out}.png`)
    const webpPath = path.join(ASSETS, `${image.out}.webp`)

    const png = await base.clone().png({ compressionLevel: 9, palette: true }).toBuffer()
    const webp = await base.clone().webp({ quality: 86, effort: 6 }).toBuffer()
    await fs.writeFile(pngPath, png)
    await fs.writeFile(webpPath, webp)

    const outMeta = await sharp(pngPath).metadata()
    rows.push({
      name: image.out,
      width: outMeta.width,
      height: outMeta.height,
      pngKB: Math.round(png.length / 1024),
      webpKB: Math.round(webp.length / 1024)
    })
  }
  return rows
}

async function buildIcons() {
  // Written verbatim: the favicon *is* the supplied file, so there is no second
  // drawing to keep in sync and no rasteriser to disagree with the browser.
  await fs.writeFile(path.join(SITE, 'favicon.svg'), APP_ICON_SVG, 'utf8')

  const png32 = await rasteriseIcon(APP_ICON_SVG, 32)
  await fs.writeFile(path.join(SITE, 'favicon-32.png'), png32)

  const apple = await rasteriseIcon(APP_ICON_SVG, 180)
  await fs.writeFile(path.join(SITE, 'apple-touch-icon.png'), apple)

  const png512 = await rasteriseIcon(APP_ICON_SVG, 512)
  await fs.writeFile(path.join(SITE, 'icon-512.png'), png512)

  return { png32: png32.length, apple: apple.length }
}

async function buildOgImage() {
  const source = path.join(ROOT, 'smm', '02-превью-ссылки-1200x630.png')
  const target = path.join(SITE, 'og-image.png')
  if (existsSync(source)) {
    // Already 1200 × 630 and verified, so it is copied rather than re-encoded.
    await fs.copyFile(source, target)
    return { copied: true, kb: Math.round((await fs.stat(target)).size / 1024) }
  }
  // Fallback: build one from the hero screenshot so the file always exists.
  await sharp(path.join(ASSETS, 'hero.png'))
    .resize(1200, 630, { fit: 'cover', position: 'centre' })
    .flatten({ background: '#0A0F1C' })
    .png({ compressionLevel: 9 })
    .toFile(target)
  return { copied: false, kb: Math.round((await fs.stat(target)).size / 1024) }
}

async function buildDownloads() {
  const rows = []
  for (const name of DOWNLOAD_FILES) {
    const source = path.join(ROOT, 'share', name)
    const target = path.join(DOWNLOADS, name)
    if (!existsSync(source)) throw new Error(`missing archive: share/${name}`)
    const sourceSize = (await fs.stat(source)).size
    const targetSize = existsSync(target) ? (await fs.stat(target)).size : -1

    // A rebuild of the same version produces an archive of exactly the same size —
    // only a few bytes of the zip's timestamps and the packed files' contents
    // change. Comparing sizes alone therefore silently left the *previous* build of
    // the same version on the site: `downloads/` held an archive that no longer
    // matched `share/`, and the page kept offering it. The bytes are what matter, so
    // the bytes are what get compared.
    let same = false
    if (targetSize === sourceSize) {
      const [a, b] = await Promise.all([fs.readFile(source), fs.readFile(target)])
      same = a.equals(b)
    }
    if (!same) await fs.copyFile(source, target)

    rows.push({ name, mb: (sourceSize / 1024 / 1024).toFixed(1), copied: !same })
  }
  return rows
}

async function main() {
  const skipDownloads = process.argv.includes('--skip-downloads')
  await ensureDirs()

  const images = await buildImages()
  const icons = await buildIcons()
  const og = await buildOgImage()
  const downloads = skipDownloads ? [] : await buildDownloads()

  console.log('Images')
  for (const row of images) {
    console.log(`  ${row.name.padEnd(10)} ${String(row.width).padStart(4)}×${String(row.height).padEnd(5)} png ${String(row.pngKB).padStart(4)} KB   webp ${String(row.webpKB).padStart(4)} KB`)
  }
  console.log(`\nIcons: favicon.svg, favicon-32.png (${icons.png32} B), apple-touch-icon.png (${icons.apple} B), icon-512.png`)
  console.log(`Social preview: og-image.png ${og.kb} KB${og.copied ? ' (from smm/)' : ' (generated)'}`)
  if (downloads.length > 0) {
    console.log('\nDownloads')
    for (const row of downloads) console.log(`  ${row.name.padEnd(30)} ${row.mb} MB`)
  } else {
    console.log('\nDownloads: skipped')
  }

  const total = images.reduce((sum, row) => sum + row.webpKB, 0)
  console.log(`\nPage image weight (WebP): ${total} KB`)
}

main().catch((error) => {
  console.error('FAILED', error)
  process.exit(1)
})
