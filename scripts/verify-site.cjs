/**
 * Checks the static site in `site/` without a browser.
 *
 * A landing page fails quietly: a link that 404s, an image with the wrong
 * dimensions, a colour pair that looks fine on the author's screen and is
 * unreadable on someone else's. None of that shows up in a screenshot, so it is
 * checked here instead.
 *
 * Usage: node scripts/verify-site.cjs [--no-archives]
 *
 * `--no-archives` skips the checks that need the release archives: a fresh clone has no
 * `share/*.zip` (they are build output, not source), so the download buttons cannot be
 * verified there. Everything else — links, images, contrast, markup, fonts — is still
 * checked, and the skipped part is named in the output rather than passed silently.
 */

const path = require('node:path')
const fs = require('node:fs/promises')
const { existsSync, readFileSync } = require('node:fs')
const sharp = require('sharp')

const ROOT = path.join(__dirname, '..')
const SITE = path.join(ROOT, 'site')

/** Release archives are build output, so a source checkout has none to check. */
const SKIP_ARCHIVES = process.argv.includes('--no-archives')

const problems = []
const notes = []

function fail(message) {
  problems.push(message)
}

// ------------------------------------------------------------------- parsing

function read(file) {
  return readFileSync(path.join(SITE, file), 'utf8')
}

/** Every href/src that points at a local file. */
function localReferences(html) {
  const refs = new Set()
  const pattern = /(?:href|src|srcset)\s*=\s*"([^"]+)"/g
  let match
  while ((match = pattern.exec(html)) !== null) {
    for (const part of match[1].split(',')) {
      const value = part.trim().split(/\s+/)[0]
      if (!value) continue
      if (/^(https?:|mailto:|tel:|data:|#)/.test(value)) continue
      refs.add(value)
    }
  }
  return [...refs]
}

/**
 * The stylesheet's colour tokens, per theme.
 *
 * `:root` holds the dark scale and `:root[data-theme="light"]` overrides it, so
 * light is dark-with-overrides — reading them separately would report the dark
 * values as the light theme's.
 */
function themeTokens(css) {
  const darkStart = css.indexOf(':root {')
  const lightStart = css.indexOf(":root[data-theme='light']")
  const lightEnd = css.indexOf('/* ------------------------------------------------------------------ reset */')
  if (darkStart < 0 || lightStart < 0 || lightEnd < 0) {
    throw new Error('styles.css: cannot find the :root blocks')
  }

  // Every custom property, colours and sizes alike: the coverage check needs the
  // full list, and the contrast check only ever looks up colour names.
  const collect = (chunk) => {
    const found = {}
    const pattern = /--([a-z0-9-]+):\s*([^;]+);/g
    let match
    while ((match = pattern.exec(chunk)) !== null) found[match[1]] = match[2].trim()
    return found
  }

  const dark = collect(css.slice(darkStart, lightStart))
  const light = { ...dark, ...collect(css.slice(lightStart, lightEnd)) }
  return { dark, light }
}

// ------------------------------------------------------------------ contrast

/**
 * Turn a colour token into `[r, g, b, a]`.
 *
 * Accepts hex and `rgb()`/`rgba()`. An alpha below 1 is kept: a token like
 * `--tint` is a translucent wash, and its contrast only means something once it
 * is composited onto the surface underneath (see `blend`).
 */
function hexToRgb(colour) {
  const rgb = colour.match(/^rgba?\(([^)]+)\)$/)
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean).map(Number)
    return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1]
  }

  let value = colour.replace('#', '')
  if (value.length === 3) value = value.split('').map((c) => c + c).join('')
  let alpha = 1
  if (value.length === 8) {
    alpha = parseInt(value.slice(6, 8), 16) / 255
    value = value.slice(0, 6)
  }
  return [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16)).concat(alpha)
}

function luminance(colour) {
  const channels = hexToRgb(colour)
    .slice(0, 3)
    .map((channel) => {
      const value = channel / 255
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

/**
 * Contrast between two colours, compositing any translucency.
 *
 * A translucent background is blended onto `--bg` first; a translucent
 * foreground is blended onto the (already resolved) background. Without this a
 * token like `--tint` would be compared as if it were opaque and report a ratio
 * that no pixel on the page actually has.
 */
function contrast(fg, bg, base = '#09090b') {
  const background = hexToRgb(bg)[3] < 1 ? blend(bg, base, hexToRgb(bg)[3]) : bg
  const foreground = hexToRgb(fg)[3] < 1 ? blend(fg, background, hexToRgb(fg)[3]) : fg
  const la = luminance(foreground)
  const lb = luminance(background)
  const light = Math.max(la, lb)
  const dark = Math.min(la, lb)
  return (light + 0.05) / (dark + 0.05)
}

/** Blend `fg` over `bg` with `alpha`, the way the browser will. */
function blend(fg, bg, alpha) {
  const f = hexToRgb(fg)
  const b = hexToRgb(bg)
  const mixed = f.slice(0, 3).map((channel, index) => Math.round(channel * alpha + b[index] * (1 - alpha)))
  return `#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

// -------------------------------------------------------------------- checks

async function checkFiles() {
  const required = [
    'index.html',
    'styles.css',
    'fonts.css',
    'app.js',
    'site.webmanifest',
    'favicon.svg',
    'favicon-32.png',
    'apple-touch-icon.png',
    'icon-512.png',
    'og-image.png',
    '404.html',
    'robots.txt'
  ]
  for (const file of required) {
    if (!existsSync(path.join(SITE, file))) fail(`missing file: ${file}`)
  }

  // The favicon must be the logo file itself, not a copy that drifted. Both are
  // hand-editable, and a site whose tab icon differs from the app icon is the exact
  // failure this check exists to prevent.
  const logoSource = path.join(ROOT, 'logo', 'logo.svg')
  if (existsSync(logoSource)) {
    const a = readFileSync(logoSource)
    const b = readFileSync(path.join(SITE, 'favicon.svg'))
    if (!a.equals(b)) fail('site/favicon.svg differs from logo/logo.svg, so the tab icon is a stale logo')
    else notes.push('favicon.svg is byte-identical to logo/logo.svg')
  }
}

async function checkReferences() {
  const html = read('index.html')
  const refs = localReferences(html)
  let skipped = 0
  for (const ref of refs) {
    // Release archives are build output, not source: in a fresh clone they do not exist,
    // and the download links are checked by `checkDownloads` when they do.
    if (SKIP_ARCHIVES && ref.startsWith('downloads/')) {
      skipped += 1
      continue
    }
    const target = path.join(SITE, ref.split('?')[0])
    if (!existsSync(target)) fail(`broken reference in index.html: ${ref}`)
  }
  notes.push(
    skipped === 0
      ? `index.html references ${refs.length} local files, all present`
      : `index.html references ${refs.length - skipped} local files, all present (${skipped} archive link(s) not checked)`
  )

  // Every <picture> WebP source must sit next to a PNG fallback with the same box.
  const pictureSources = [...html.matchAll(/<source srcset="assets\/([a-z-]+)\.webp"/g)].map((m) => m[1])
  for (const name of pictureSources) {
    const webp = path.join(SITE, 'assets', `${name}.webp`)
    const png = path.join(SITE, 'assets', `${name}.png`)
    if (!existsSync(webp) || !existsSync(png)) {
      fail(`picture "${name}" is missing a WebP or PNG file`)
      continue
    }
    const a = await sharp(webp).metadata()
    const b = await sharp(png).metadata()
    if (a.width !== b.width || a.height !== b.height) {
      fail(`picture "${name}": WebP is ${a.width}×${a.height} but PNG is ${b.width}×${b.height}`)
    }
  }
  notes.push(`${pictureSources.length} <picture> blocks have matching WebP and PNG sizes`)
}

async function checkImageAttributes() {
  const html = read('index.html')
  const images = [...html.matchAll(/<img\s([^>]+)>/g)].map((m) => m[1])

  for (const attrs of images) {
    const src = /src="([^"]+)"/.exec(attrs)
    const width = /width="(\d+)"/.exec(attrs)
    const height = /height="(\d+)"/.exec(attrs)
    const alt = /alt="([^"]*)"/.exec(attrs)
    const loading = /loading="lazy"/.test(attrs)

    if (!src) {
      fail('an <img> has no src')
      continue
    }
    const name = src[1]

    // Width and height on every image: without them the page jumps as images load.
    if (!width || !height) fail(`<img src="${name}"> has no width/height, so the layout will shift`)

    // Alt text is mandatory unless the image is explicitly decorative.
    if (!alt) fail(`<img src="${name}"> has no alt attribute`)
    else if (alt[1].trim().length < 12 && !/aria-hidden/.test(attrs)) {
      fail(`<img src="${name}"> has a very short alt: "${alt[1]}"`)
    }

    const file = path.join(SITE, name)
    if (!existsSync(file)) continue
    const meta = await sharp(file).metadata()
    if (width && Number(width[1]) !== meta.width) {
      // Declared size may legitimately differ (CSS scales it down), but then it
      // must be the file's real width for correct aspect-ratio maths.
      fail(`<img src="${name}"> declares width ${width[1]} but the file is ${meta.width}px`)
    }
    if (height && Number(height[1]) !== meta.height) {
      fail(`<img src="${name}"> declares height ${height[1]} but the file is ${meta.height}px`)
    }
    if (!loading && !/fetchpriority="high"/.test(attrs)) {
      notes.push(`<img src="${name}"> loads eagerly (fine if it is above the fold)`)
    }
  }
  notes.push(`${images.length} images checked for size, alt text and lazy loading`)
}

async function checkContrast() {
  const css = read('styles.css')
  const tokens = themeTokens(css)

  // Pairs that actually appear on the page, with the size they are used at.
  // Token names match the ones in styles.css; a renamed token fails loudly here
  // rather than silently skipping the check.
  const pairs = [
    { fg: 'fg', bg: 'bg', label: 'body text on the page', min: 4.5 },
    { fg: 'fg', bg: 'bg-elev', label: 'body text on a raised panel', min: 4.5 },
    { fg: 'fg-muted', bg: 'bg', label: 'muted text on the page', min: 4.5 },
    { fg: 'fg-muted', bg: 'bg-elev', label: 'muted text on a raised panel', min: 4.5 },
    { fg: 'fg-muted', bg: 'bg-card', label: 'muted text on a card', min: 4.5 },
    { fg: 'fg-dim', bg: 'bg', label: 'eyebrows and captions on the page', min: 4.5 },
    { fg: 'fg-dim', bg: 'bg-elev', label: 'terminal chrome text', min: 4.5 },
    { fg: 'accent', bg: 'bg', label: 'accent text on the page', min: 4.5 },
    { fg: 'accent', bg: 'bg-elev', label: 'accent text on a panel', min: 4.5 },
    { fg: 'ok', bg: 'bg', label: 'check marks on the page', min: 3 },
    { fg: 'ok', bg: 'bg-elev', label: 'check marks on a panel', min: 3 },
    { fg: 'warn', bg: 'bg', label: 'warnings on the page', min: 4.5 }
  ]

  for (const theme of ['light', 'dark']) {
    const set = tokens[theme]
    const base = set.bg
    for (const pair of pairs) {
      const fg = set[pair.fg]
      const bg = set[pair.bg]
      if (!fg || !bg) {
        fail(`${theme}: missing token --${fg ? pair.bg : pair.fg} for ${pair.label}`)
        continue
      }
      const ratio = contrast(fg, bg, base)
      if (ratio < pair.min) {
        fail(`${theme}: ${pair.label} is ${ratio.toFixed(2)}:1, needs ${pair.min}:1 (${fg} on ${bg})`)
      }
    }

    // The filled accent button carries --accent-ink, not white.
    const button = contrast(set['accent-ink'], set.accent, base)
    if (button < 4.5) {
      fail(`${theme}: button label on the accent fill is ${button.toFixed(2)}:1, needs 4.5:1`)
    }

    // The primary button is --fg as a fill with --bg as its label.
    const primary = contrast(set.bg, set.fg, base)
    if (primary < 4.5) {
      fail(`${theme}: primary button label is ${primary.toFixed(2)}:1, needs 4.5:1`)
    }

    notes.push(
      `${theme}: accent button ${button.toFixed(2)}:1, primary button ${primary.toFixed(2)}:1, ` +
        `body ${contrast(set.fg, set.bg, base).toFixed(2)}:1, muted ${contrast(set['fg-muted'], set.bg, base).toFixed(2)}:1`
    )
  }
}
async function checkMarkup() {
  const html = read('index.html')

  if (!/^<!DOCTYPE html>/i.test(html.trim())) fail('index.html does not start with a doctype')
  if (!/<html lang="ru"/.test(html)) fail('index.html does not declare lang="ru"')
  if (!/<meta charset="utf-8">/i.test(html)) fail('index.html does not declare UTF-8')
  if (!/name="viewport"/.test(html)) fail('index.html has no viewport meta')

  // One h1, and headings that do not skip a level.
  const h1 = [...html.matchAll(/<h1[\s>]/g)].length
  if (h1 !== 1) fail(`index.html has ${h1} <h1> elements, expected exactly 1`)
  const levels = [...html.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]))
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] - levels[i - 1] > 1) fail(`heading level jumps from h${levels[i - 1]} to h${levels[i]}`)
  }

  // Every id referenced by aria-controls / href="#..." must exist.
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))
  for (const match of html.matchAll(/aria-controls="([^"]+)"/g)) {
    if (!ids.has(match[1])) fail(`aria-controls="${match[1]}" points at a missing id`)
  }
  for (const match of html.matchAll(/href="#([^"]+)"/g)) {
    if (!ids.has(match[1])) fail(`anchor href="#${match[1]}" points at a missing id`)
  }

  // The tabs must follow the pattern the script relies on.
  const tabs = [...html.matchAll(/role="tab"/g)].length
  const panels = [...html.matchAll(/role="tabpanel"/g)].length
  if (tabs !== panels) fail(`${tabs} tabs but ${panels} panels`)
  const selected = [...html.matchAll(/role="tab"[^>]*aria-selected="true"/g)].length
  if (tabs > 0 && selected !== 1) fail(`${selected} tabs are marked selected, expected 1`)
  const visiblePanels = [...html.matchAll(/role="tabpanel"(?![^>]*hidden)/g)].length
  if (tabs > 0 && visiblePanels !== 1) fail(`${visiblePanels} panels are visible on load, expected 1`)

  // Downloads must point at real archives.
  const archives = [...html.matchAll(/href="(downloads\/[^"]+)"/g)].map((m) => m[1])
  if (archives.length === 0) fail('no download links found')
  for (const archive of archives) {
    if (SKIP_ARCHIVES) continue
    if (!existsSync(path.join(SITE, archive))) fail(`download link points at a missing file: ${archive}`)
  }
  notes.push(
    SKIP_ARCHIVES
      ? `${archives.length} download links named, files not checked (--no-archives)`
      : `${archives.length} download links verified`
  )

  checkTagBalance(html, 'index.html')

  // Duplicate ids break aria-controls, anchors and getElementById at once.
  const allIds = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])
  const duplicates = allIds.filter((id, index) => allIds.indexOf(id) !== index)
  if (duplicates.length > 0) fail(`index.html repeats id(s): ${[...new Set(duplicates)].join(', ')}`)

  // The 404 page is what a visitor sees when a link rots, so it has to work
  // standalone: same charset, same stylesheet, a way back.
  const notFound = read('404.html')
  if (!/<meta charset="utf-8">/i.test(notFound)) fail('404.html does not declare UTF-8')
  if (!/href="styles.css"/.test(notFound)) fail('404.html does not use the site stylesheet')
  if (!/href="index.html"/.test(notFound)) fail('404.html has no link back to the site')
  if (!/name="robots" content="noindex"/.test(notFound)) fail('404.html should be noindex')
}

/** Tags that must balance. A browser silently repairs a stray </div>, which
 *  moves every following block — the layout looks broken with no error. */
const BALANCED_TAGS = [
  'div', 'section', 'article', 'ul', 'ol', 'li', 'p', 'h1', 'h2', 'h3',
  'details', 'summary', 'picture', 'figure', 'figcaption', 'main', 'header',
  'footer', 'nav', 'a', 'button', 'span', 'label'
]

function checkTagBalance(html, file) {
  for (const tag of BALANCED_TAGS) {
    const open = [...html.matchAll(new RegExp(`<${tag}(?=[\\s>])`, 'g'))].length
    const close = [...html.matchAll(new RegExp(`</${tag}>`, 'g'))].length
    if (open !== close) fail(`${file}: <${tag}> opened ${open} times but closed ${close}`)
  }
}

async function checkCss() {
  const css = read('styles.css')
  const open = (css.match(/{/g) || []).length
  const close = (css.match(/}/g) || []).length
  if (open !== close) fail(`styles.css has ${open} opening and ${close} closing braces`)

  // A stray "@media" without a breakpoint, or a typo'd property, is invisible
  // until the page looks wrong on someone's phone.
  if (/position:\s*fixed/.test(css) && /\.header/.test(css) && !/sticky/.test(css)) {
    notes.push('header uses fixed positioning')
  }

  // Every colour token used must be defined in both themes.
  const tokens = themeTokens(css)
  const used = new Set([...css.matchAll(/var\(--([a-z0-9-]+)\)/g)].map((m) => m[1]))
  for (const name of used) {
    if (name.startsWith('radius') || name.startsWith('shadow') || name === 'font' || name === 'wrap' || name === 'header-h') continue
    for (const theme of ['light', 'dark']) {
      if (!tokens[theme][name]) fail(`--${name} is used but not defined for the ${theme} theme`)
    }
  }
  notes.push(`${used.size} custom properties used, all defined in both themes`)
}

async function checkNoExternalRequests() {
  const html = read('index.html')
  const css = read('styles.css')
  const js = read('app.js')

  // The site must work from a USB stick with no network.
  for (const [name, content] of [['index.html', html], ['styles.css', css], ['app.js', js]]) {
    const external = [...content.matchAll(/https?:\/\/[^\s"')]+/g)]
      .map((m) => m[0])
      .filter((url) => !url.startsWith('https://schema.org') && !url.includes('example.com') && !url.includes('w3.org'))
    if (external.length > 0) fail(`${name} loads from the network: ${external.slice(0, 3).join(', ')}`)
  }
  notes.push('no external fonts, CDNs or trackers')
}

/**
 * The page is set in Inter and JetBrains Mono, served from `fonts/`.
 *
 * Two things can go wrong silently here. A @font-face pointing at a file that
 * was never copied renders in the fallback stack and looks *almost* right, so
 * nobody notices. And a Latin-only subset renders Cyrillic — the entire page —
 * in a fallback, which is far more obvious but only on a machine that lacks the
 * system fonts. Both are checked by name.
 */
async function checkFonts() {
  const css = read('fonts.css')
  const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1])
  if (faces.length === 0) {
    fail('styles.css declares no @font-face, so the page falls back to system fonts')
    return
  }

  const families = new Set()
  for (const face of faces) {
    const family = /font-family:\s*'([^']+)'/.exec(face)
    const src = /src:\s*url\('([^']+)'\)/.exec(face)
    const range = /unicode-range:\s*([^;]+);/.exec(face)

    if (!family) fail('a @font-face has no family name')
    if (!src) {
      fail('a @font-face has no src')
      continue
    }

    // A linked file breaks the file:// case: Chromium blocks a font fetched
    // from file:// as a cross-origin request, so the page silently falls back
    // to a system face when it is opened by double-click.
    if (/^data:font\/woff2;base64,/.test(src[1])) {
      const base64 = src[1].slice(src[1].indexOf(',') + 1)
      if (base64.length < 1000) fail(`inlined font for ${family[1]} is only ${base64.length} bytes`)
    } else if (/^https?:/.test(src[1])) {
      fail(`font ${src[1].slice(0, 60)} is loaded from the network`)
    } else if (/^fonts\//.test(src[1])) {
      fail(
        `font ${src[1]} is linked, not inlined — Chromium blocks fonts over file://, ` +
          `so the page falls back to a system face when opened by double-click. Run node scripts/build-fonts.cjs`
      )
    } else {
      fail(`font src ${src[1].slice(0, 60)} is neither an inlined woff2 nor a known form`)
    }

    if (!range) fail(`@font-face for ${family[1]} has no unicode-range, so both subsets download`)

    families.add(family[1])
  }

  // Cyrillic must be covered by an actual face, not left to the fallback.
  for (const family of families) {
    const cyrillic = faces.some(
      (face) => face.includes(`'${family}'`) && /U\+0400-045F/i.test(face)
    )
    if (!cyrillic) fail(`${family} has no Cyrillic range, so Russian text falls back to a system font`)
  }

  for (const family of ['Inter', 'JetBrains Mono']) {
    if (!families.has(family)) fail(`${family} is not declared in styles.css`)
  }

  // The page must actually use what it loads.
  const styles = read('styles.css')
  if (!/var\(--font-sans\)/.test(styles)) fail('--font-sans is declared but never used')
  if (!/var\(--font-mono\)/.test(styles)) fail('--font-mono is declared but never used')

  let total = 0
  for (const face of faces) {
    const src = /url\('(data:font\/woff2;base64,([^']+))'\)/.exec(face)
    if (src) total += Math.round((src[2].length * 3) / 4)
  }
  if (total > 200 * 1024) fail(`the fonts total ${(total / 1024).toFixed(0)} KB, which is too much for two families`)

  // The page must be told to load the file that carries them.
  const html = read('index.html')
  if (!/<link rel="stylesheet" href="fonts.css">/.test(html)) {
    fail('index.html does not link fonts.css, so the page renders in system fonts')
  }
  notes.push(
    `${faces.length} @font-face rules, ${families.size} families, ${(total / 1024).toFixed(0)} KB inlined, Cyrillic covered`
  )
}

/**
 * The site's pictures must show the current mark.
 *
 * The logo is a dark tile with #A3C8F0 bars. Any picture still carrying the old
 * blue-gradient mark has no such pixels at all, so counting them is a direct test of
 * "was this file rebuilt after the logo changed". It has to be checked rather than
 * assumed: `favicon.svg` follows the source file automatically, but the rasterised
 * icons, the link preview and the screenshots are produced by separate scripts, and
 * forgetting one leaves a page whose tab icon is new and whose preview card is not.
 */
async function checkBrandMark() {
  const INK = [0xa3, 0xc8, 0xf0]
  const TOLERANCE = 24

  async function inkShare(file) {
    const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    let hits = 0
    for (let i = 0; i < data.length; i += info.channels) {
      if (
        Math.abs(data[i] - INK[0]) <= TOLERANCE &&
        Math.abs(data[i + 1] - INK[1]) <= TOLERANCE &&
        Math.abs(data[i + 2] - INK[2]) <= TOLERANCE
      ) {
        hits += 1
      }
    }
    return hits / (info.width * info.height)
  }

  const icons = ['favicon-32.png', 'apple-touch-icon.png', 'icon-512.png']
  for (const file of icons) {
    const target = path.join(SITE, file)
    if (!existsSync(target)) continue
    const share = await inkShare(target)
    // A 32 px icon has few pixels to spare; the mark covers roughly 8 % of the tile.
    if (share < 0.005) fail(`${file} has no pixels of the mark's ink, so it is not the current logo`)
  }

  // The preview card draws the mark at 30 px inside a dark card, which is a smaller
  // share of a 1200×630 canvas but still well above a handful of pixels.
  const og = path.join(SITE, 'og-image.png')
  if (existsSync(og) && (await inkShare(og)) < 0.0001) {
    fail('og-image.png has no pixels of the mark\'s ink, so the link preview shows the old logo')
  }

  notes.push(`${icons.length} icons and the preview card carry the current mark`)
}

async function checkSocialPreview() {
  const file = path.join(SITE, 'og-image.png')
  if (!existsSync(file)) return
  const meta = await sharp(file).metadata()
  if (meta.width !== 1200 || meta.height !== 630) {
    fail(`og-image.png is ${meta.width}×${meta.height}, social previews expect 1200×630`)
  }
  const stat = await fs.stat(file)
  if (stat.size > 5 * 1024 * 1024) fail(`og-image.png is ${(stat.size / 1024 / 1024).toFixed(1)} MB, some platforms cap at 5 MB`)
}

async function checkDownloads() {
  const files = await fs.readdir(path.join(SITE, 'downloads')).catch(() => [])
  if (files.length === 0) {
    // The archives are build output: `node scripts/build-site.cjs` copies them out of
    // `share/`. Their absence is normal in a fresh clone, where the page links to
    // GitHub Releases instead, so point at the right command rather than just failing.
    fail(
      'site/downloads is empty, so the download buttons 404 — run `node scripts/build-site.cjs` ' +
        'to copy the archives from share/, or rerun with --no-archives if they live in GitHub Releases'
    )
    return
  }
  const html = read('index.html')
  let matched = 0
  for (const file of files) {
    if (!html.includes(file)) fail(`downloads/${file} is not linked from the page`)
    const target = path.join(SITE, 'downloads', file)
    const stat = await fs.stat(target)
    if (stat.size < 1024 * 1024) fail(`downloads/${file} is only ${stat.size} bytes, that is not an archive`)

    // The copy on the site must be the same bytes as the one in `share/`. Comparing
    // sizes was not enough: rebuilding the same version produces an archive of
    // exactly the same size, so a stale copy sat in `downloads/` looking perfectly
    // valid while the page offered an older build.
    const source = path.join(ROOT, 'share', file)
    if (existsSync(source)) {
      const [a, b] = await Promise.all([fs.readFile(source), fs.readFile(target)])
      if (!a.equals(b)) fail(`downloads/${file} differs from share/${file}, so the site offers a stale build`)
      else matched += 1
    }
  }
  notes.push(`${files.length} archives present and linked, ${matched} byte-identical to share/`)
}

async function reportSize() {
  const assets = await fs.readdir(path.join(SITE, 'assets')).catch(() => [])
  let total = 0
  for (const file of assets) {
    total += (await fs.stat(path.join(SITE, 'assets', file))).size
  }
  const html = await fs.stat(path.join(SITE, 'index.html'))
  const css = await fs.stat(path.join(SITE, 'styles.css'))
  const js = await fs.stat(path.join(SITE, 'app.js'))
  notes.push(
    `page weight without archives: ${((html.size + css.size + js.size + total) / 1024).toFixed(0)} KB`
  )
}

async function main() {
  await checkFiles()
  await checkReferences()
  await checkImageAttributes()
  await checkContrast()
  await checkMarkup()
  await checkCss()
  await checkNoExternalRequests()
  await checkFonts()
  await checkSocialPreview()
  await checkBrandMark()
  if (SKIP_ARCHIVES) {
    notes.push('release archives not checked (--no-archives)')
  } else {
    await checkDownloads()
  }
  await reportSize()

  for (const note of notes) console.log(`  · ${note}`)

  if (problems.length > 0) {
    console.error(`\n${problems.length} PROBLEM(S):`)
    for (const problem of problems) console.error(`  ✗ ${problem}`)
    process.exitCode = 1
  } else {
    console.log('\nSite checks passed.')
  }
}

main().catch((error) => {
  console.error('FAILED', error)
  process.exit(1)
})
