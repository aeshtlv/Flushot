/**
 * Prepares the static site in `site/`.
 *
 * The HTML, CSS and JS are hand-written — this script only produces the assets
 * that are tedious to make by hand and easy to get wrong:
 *
 *  - web-optimised copies of the real screenshots (WebP + PNG fallback, sized to
 *    the widest place they are shown, so nothing is upscaled on a 2x display),
 *  - the favicon set, rasterised from the same SVG the app itself uses,
 *  - the social preview image.
 *
 * The download archives are deliberately *not* copied in: the buttons point at
 * GitHub Releases, because three archives of 94–143 MB cannot live in a repository
 * and the folder has to stay publishable as-is.
 *
 * Usage: node scripts/build-site.cjs
 *
 * The six screenshots it reads live in source/. They are produced by the
 * application repository — scripts/make-hero-image.cjs and
 * scripts/make-ui-shots.cjs there drive the shipping renderer — and are copied
 * here so this branch stays publishable without the application source.
 */

const path = require('node:path')
const fs = require('node:fs/promises')
const { existsSync, readFileSync } = require('node:fs')
const sharp = require('sharp')

const ROOT = path.join(__dirname, '..')
const SITE = path.join(ROOT, 'site')
const ASSETS = path.join(SITE, 'assets')

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
 *
 * Each language has its own set, drawn from the same program with the interface
 * in that language: the English page shows English windows. They are separate
 * files rather than one shared set because a screenshot of a Russian interface
 * under an English headline reads as an unfinished translation.
 */
const IMAGES = [
  // The hero is a real Flushot output of the synthetic demo scene, not a capture
  // of whatever was on the author's desktop.
  { src: 'hero-framed.png', out: 'hero', width: 1124, height: null },
  { src: 'ui-overlay.png', out: 'overlay', width: 1174, height: null },
  { src: 'ui-annotate.png', out: 'annotate', width: 1174, height: null },
  { src: 'ui-ocr.png', out: 'ocr', width: 1174, height: null },
  // The settings window is 520 CSS pixels wide in the picture itself, so 520 is both what it is
  // shown at and the widest it can honestly be: the file holds 1040, exactly twice that.
  { src: 'ui-settings.png', out: 'settings', width: 520, height: null },
  { src: 'multi-monitor.png', out: 'monitors', width: 420, height: null }
]

/** Where each language's originals live and where its sizes go. */
const LANGUAGES = [
  { code: 'ru', from: 'source', to: 'assets' },
  { code: 'en', from: 'source/en', to: 'assets/en' }
]

async function ensureDirs() {
  for (const dir of [SITE, ASSETS]) {
    await fs.mkdir(dir, { recursive: true })
  }
}

async function buildImages(from, to) {
  const rows = []
  await fs.mkdir(path.join(SITE, to), { recursive: true })
  for (const image of IMAGES) {
    const source = path.join(ROOT, from, image.src)
    if (!existsSync(source)) throw new Error(`missing source image: ${from}/${image.src}`)

    const meta = await sharp(source).metadata()
    // Never upscale: a 520px-wide settings panel rendered at 520 stays 520.
    const targetWidth = Math.min(Math.round(image.width * 2), meta.width)
    const base = sharp(source).resize({ width: targetWidth, withoutEnlargement: true })

    const pngPath = path.join(SITE, to, `${image.out}.png`)
    const webpPath = path.join(SITE, to, `${image.out}.webp`)

    const png = await base.clone().png({ compressionLevel: 9, palette: true }).toBuffer()
    const webp = await base.clone().webp({ quality: 86, effort: 6 }).toBuffer()
    await fs.writeFile(pngPath, png)
    await fs.writeFile(webpPath, webp)

    const outMeta = await sharp(pngPath).metadata()
    rows.push({
      lang: to.endsWith('en') ? 'en/' : '',
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

/**
 * The English card, built the same way as the Russian one: copied from the social
 * folder when it is there, and drawn from the English hero screenshot otherwise,
 * so the file the English page points at always exists.
 */
async function buildOgImageEn() {
  const target = path.join(SITE, 'og-image-en.png')
  const from = path.join(ROOT, 'smm', '02-превью-ссылки-en-1200x630.png')
  if (existsSync(from)) {
    await fs.copyFile(from, target)
    return { copied: true, kb: Math.round((await fs.stat(target)).size / 1024) }
  }
  await sharp(path.join(ASSETS, 'en', 'hero.png'))
    .resize(1200, 630, { fit: 'cover', position: 'centre' })
    .flatten({ background: '#0A0F1C' })
    .png({ compressionLevel: 9 })
    .toFile(target)
  return { copied: false, kb: Math.round((await fs.stat(target)).size / 1024) }
}

async function main() {
  await ensureDirs()

  console.log('Images')
  let total = 0
  for (const language of LANGUAGES) {
    const images = await buildImages(language.from, language.to)
    console.log(`  ${language.code}:`)
    for (const row of images) {
      console.log(`    ${row.name.padEnd(10)} ${String(row.width).padStart(4)}×${String(row.height).padEnd(5)} png ${String(row.pngKB).padStart(4)} KB   webp ${String(row.webpKB).padStart(4)} KB`)
    }
    total += images.reduce((sum, row) => sum + row.webpKB, 0)
  }

  const icons = await buildIcons()
  const og = await buildOgImage()
  const ogEn = await buildOgImageEn()

  console.log(`\nIcons: favicon.svg, favicon-32.png (${icons.png32} B), apple-touch-icon.png (${icons.apple} B), icon-512.png`)
  console.log(`Social preview: og-image.png ${og.kb} KB${og.copied ? ' (from smm/)' : ' (generated)'}`)
  console.log(`Social preview: og-image-en.png ${ogEn.kb} KB${ogEn.copied ? ' (from smm/)' : ' (generated)'}`)
  console.log(`\nPage image weight (WebP): ${total} KB, both languages`)
}

main().catch((error) => {
  console.error('FAILED', error)
  process.exit(1)
})
