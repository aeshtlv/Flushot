/**
 * Stamps every local asset reference with a hash of the file it points at.
 *
 * Why this exists: without it, a visitor who has been to the site before keeps
 * the old stylesheet for as long as the cache headers allow. Two deploys in one
 * day then reach two devices at different times, and the same page looks like
 * two different pages — which is exactly the report that prompted this script.
 *
 * The fix is the standard one: give every asset a URL that changes when its
 * content changes, and let the server cache it forever. The reference becomes
 *
 *     styles.css?v=4f1c9a02
 *
 * where the eight hex characters are the first bytes of the file's SHA-256. The
 * server can then answer with `immutable, max-age=31536000`: a year is safe
 * because a changed file gets a new URL, and a URL nobody asks for again cannot
 * be served stale.
 *
 * The stamp lives in the repository, so it is committed like any other source
 * change, and `verify-site.cjs` fails when it is out of date. Run this after
 * touching anything under site/ that the page loads:
 *
 *     node scripts/stamp-assets.cjs
 */

const { createHash } = require('node:crypto')
const { existsSync, readFileSync, writeFileSync } = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const SITE = path.join(ROOT, 'site')
const ORIGIN = 'https://flushot.ink/'

// Only these extensions are assets. The test matters: `content="1200"` and
// `content="summary_large_image"` are meta tags, not files, and a rule that
// simply took every attribute value would try to hash them.
const ASSET = /\.(css|js|mjs|png|webp|jpg|jpeg|avif|svg|ico|woff2|webmanifest)$/

// Served with `no-cache` and fetched by crawlers and browsers directly, so a
// query string on them would be noise. index.html and 404.html are documents.
const UNSTAMPED = new Set(['robots.txt', 'sitemap.xml', 'index.html', '404.html'])

function isLocal(url) {
  if (!url) return false
  if (url.startsWith('#') || url.startsWith('data:') || url.startsWith('mailto:')) return false
  if (url.startsWith('//')) return false
  if (/^[a-z]+:/i.test(url) && !url.startsWith(ORIGIN)) return false
  return true
}

/**
 * The on-disk file a reference points at, or null when it is not a local asset.
 *
 * `base` is the directory of the document doing the linking, relative to site/.
 * The English page lives in `en/` and links to `../styles.css`, so a path can
 * climb out of the site root if it is resolved from the root alone — the URL has
 * to be resolved where the browser would resolve it.
 */
function targetOf(url, base = '') {
  if (!isLocal(url)) return null
  const withoutOrigin = url.startsWith(ORIGIN) ? url.slice(ORIGIN.length) : url
  const [pathPart] = withoutOrigin.split(/[?#]/)
  if (!pathPart || UNSTAMPED.has(pathPart)) return null
  if (!ASSET.test(pathPart)) return null
  // A URL that names the origin is absolute by definition: it is resolved from the
  // root, whatever document it happens to sit in. Only a path relative to the
  // document — `../styles.css` on the English page — hangs off `base`.
  const from = url.startsWith(ORIGIN) ? '' : base
  return { pathPart, base: from, file: path.resolve(SITE, from, pathPart) }
}

/**
 * The hash of a file's content, as a fresh clone would see it.
 *
 * Text is hashed with line endings normalised: `.gitattributes` keeps everything
 * in site/ on LF, but a checkout on Windows can still hand back CRLF for a file
 * whose attributes were added later, and then one commit would produce two
 * different hashes on two machines.
 *
 * Images and fonts are hashed as raw bytes. Running the same normalisation over
 * them would be a silent corruption of the hash: latin1 maps bytes one-to-one, so
 * the string round-trips, but a PNG that happens to contain the byte pair 0x0D
 * 0x0A would be rewritten and would hash differently from the file being served.
 */
const TEXT = /\.(css|js|mjs|svg|webmanifest|html|json|txt)$/

function hashOf(file) {
  const content = readFileSync(file)
  if (TEXT.test(file)) {
    return createHash('sha256')
      .update(content.toString('latin1').replace(/\r\n/g, '\n'), 'latin1')
      .digest('hex')
      .slice(0, 8)
  }
  return createHash('sha256').update(content).digest('hex').slice(0, 8)
}

/** The same URL carrying the current stamp, or null if it is not a local asset. */
function stamped(url, base) {
  const target = targetOf(url, base)
  if (!target) return null
  if (!existsSync(target.file)) return { missing: target.pathPart }
  const absolute = url.startsWith(ORIGIN)
  const prefix = absolute ? ORIGIN : ''
  return { url: `${prefix}${target.pathPart}?v=${hashOf(target.file)}`, file: target.pathPart }
}

function rewrite(source, pattern) {
  const file = path.join(SITE, source)
  const base = path.dirname(source) === '.' ? '' : path.dirname(source)
  const original = readFileSync(file, 'utf8')
  const changed = []
  const missing = []

  const updated = original.replace(pattern, (match, prefix, url, suffix) => {
    const result = stamped(url, base)
    if (!result) return match
    if (result.missing) {
      missing.push(result.missing)
      return match
    }
    if (result.url !== url) changed.push(result.file)
    return `${prefix}${result.url}${suffix}`
  })

  if (updated !== original) writeFileSync(file, updated)
  return { source, changed: [...new Set(changed)], missing: [...new Set(missing)] }
}

// Order matters. The manifest is rewritten first because index.html links to it,
// and the manifest's own content decides the hash that link has to carry.
const PAGES = [
  // Icons are referenced by property, not by attribute.
  ['site.webmanifest', /("src"\s*:\s*")([^"]+)(")/g],
  // href, src, and content on the social preview: stylesheets, scripts, images.
  ['index.html', /((?:href|src|content)=")([^"]+)(")/g],
  // Generated from the Russian page by scripts/build-en-page.cjs, so it is
  // always stamped after it.
  ['en/index.html', /((?:href|src|content)=")([^"]+)(")/g],
  ['privacy.html', /((?:href|src|content)=")([^"]+)(")/g],
  ['en/privacy.html', /((?:href|src|content)=")([^"]+)(")/g],
  ['404.html', /((?:href|src|content)=")([^"]+)(")/g]
]

// The search pages, in both languages. Read from the data rather than listed here, so a page added
// to that file is stamped without a second edit — the omission this change exists to prevent.
try {
  for (const page of require('./seo-pages.cjs').PAGES) {
    PAGES.push([`${page.slug}/index.html`, /((?:href|src|content)=")([^"]+)(")/g])
    PAGES.push([`en/${page.slug}/index.html`, /((?:href|src|content)=")([^"]+)(")/g])
  }
} catch (error) {
  console.log(`search pages skipped: ${error.message}`)
}

const results = []
for (const [file, pattern] of PAGES) {
  if (!existsSync(path.join(SITE, file))) continue
  results.push(rewrite(file, pattern))
}

let total = 0
for (const result of results) {
  if (result.changed.length) {
    total += result.changed.length
    console.log(`${result.source}: ${result.changed.join(', ')}`)
  }
  for (const missing of result.missing) {
    console.log(`${result.source}: ${missing} is referenced but missing on disk`)
  }
}

console.log(
  total === 0
    ? 'every local reference already carries the current hash'
    : `${total} reference(s) stamped`
)
