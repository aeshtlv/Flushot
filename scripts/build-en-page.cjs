/**
 * Builds the English landing page from the Russian one.
 *
 * Why generated and not written twice: the two pages must stay identical in
 * structure — same sections, same ids, same anchors, same picture slots — and two
 * hand-written files drift the first time a section is added to only one of them.
 * Here every word lives in `scripts/en-page-text.cjs` as an exact substring of
 * `site/index.html`, the build replaces them all, and then it refuses to write
 * anything if a single Cyrillic character survived. A missing translation is a
 * failed build, not an English page with a Russian paragraph in the middle.
 *
 * The output is committed like any other source file, because the server serves
 * static files and nothing is compiled on deploy.
 *
 *     node scripts/build-en-page.cjs
 */

const fs = require('node:fs')
const { execFileSync } = require('node:child_process')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const SITE = path.join(ROOT, 'site')
const SOURCE = path.join(SITE, 'index.html')
const TARGET = path.join(SITE, 'en', 'index.html')
const TEXT = require('./en-page-text.cjs')

const CYRILLIC = /[\u0400-\u04FF]/

/**
 * Files the English page loads from the site root. The page lives one level
 * down, so each of these gains `../`; images go to their own directory instead.
 */
const ROOT_FILES = [
  'favicon.svg',
  'favicon-32.png',
  'apple-touch-icon.png',
  'site.webmanifest',
  'fonts.css',
  'styles.css',
  'app.js'
]

function main() {
  let page = fs.readFileSync(SOURCE, 'utf8')

  // ------------------------------------------------------------- the words
  // Longest first: a short entry ("Готово") would otherwise cut into a longer
  // one that contains it ("Готово, снимок в буфере") and leave a fragment.
  const pairs = [...TEXT].sort((a, b) => b[0].length - a[0].length)
  const unused = []
  let replaced = 0
  for (const [from, to] of pairs) {
    const count = page.split(from).length - 1
    if (count === 0) {
      unused.push(from.replace(/\s+/g, ' ').slice(0, 70))
      continue
    }
    page = page.split(from).join(to)
    replaced += count
  }

  // ------------------------------------------------------------- the page
  page = page.replace('<html lang="ru" data-theme="dark">', '<html lang="en" data-theme="dark">')
  // Both pages claim the same canonical URL only if this is missed, and a
  // canonical that points at the other language is worse than none at all.
  page = page.replace('<link rel="canonical" href="https://flushot.ink/">', '<link rel="canonical" href="https://flushot.ink/en/">')
  page = page.replace('<meta property="og:url" content="https://flushot.ink/">', '<meta property="og:url" content="https://flushot.ink/en/">')
  page = page.replace('<meta property="og:locale" content="ru_RU">', '<meta property="og:locale" content="en_GB">')
  // The structured-data block declares the document's language too, and on the
  // English page the Russian declaration contradicts `lang="en"`. The currency
  // stays RUB: the price is what it is, and converting it would invent a number.
  page = page.replace('"inLanguage": "ru"', '"inLanguage": "en"')
  // The link preview is a separate picture per language: the card shows the
  // program as that reader sees it. Applied to the URL without its `?v=` query,
  // because that hash changes whenever the Russian card is regenerated and a
  // replacement pinned to the old one would silently stop matching. The query is
  // put back by `stamp-assets.cjs`, which runs at the end of this script.
  page = page.replace(/https:\/\/flushot\.ink\/og-image\.png(\?v=[0-9a-f]{8})?/g, 'https://flushot.ink/og-image-en.png')
  // A search engine reading the card should see the English description, which
  // the table already supplies; the locale is what was wrong here.
  page = page.replace('"priceCurrency": "RUB"', '"priceCurrency": "RUB"')

  // The switch points the other way on this page.
  page = page.replace(
    /<a class="lang-switch" href="en\/" hreflang="en" lang="en" data-lang-switch\n\s*aria-label="[^"]*">[^<]*<\/a>/,
    `<a class="lang-switch" href="../" hreflang="ru" lang="ru" data-lang-switch
         aria-label="Русская версия">RU</a>`
  )

  // ------------------------------------------------------------- the paths
  for (const file of ROOT_FILES) {
    page = page.replaceAll(`="${file}`, `="../${file}`)
  }
  page = page.replaceAll('="assets/', '="../assets/en/')
  page = page.replaceAll('srcset="assets/', 'srcset="../assets/en/')

  // -------------------------------------------------------- nothing left
  if (unused.length > 0) {
    console.error(`${unused.length} translation(s) match nothing in site/index.html:`)
    for (const entry of unused) console.error(`  · ${entry}`)
    console.error('The Russian page changed and the table did not follow.')
    process.exit(1)
  }

  // One string is Russian on purpose: the link back to the Russian version is
  // labelled in Russian, because someone who does not read English has to be able
  // to find their way back. It is removed before the sweep so that the sweep stays
  // absolute everywhere else.
  const SWITCH_LABEL = 'aria-label="Русская версия"'
  if (page.split(SWITCH_LABEL).length - 1 !== 1) {
    console.error('the link back to the Russian page is missing or duplicated')
    process.exit(1)
  }
  const scannable = page.split(SWITCH_LABEL).join('')

  if (!page.includes('https://flushot.ink/og-image-en.png')) {
    console.error('the English page still points its link preview at the Russian card')
    process.exit(1)
  }

  const left = []
  for (const [index, line] of scannable.split('\n').entries()) {
    if (CYRILLIC.test(line)) left.push(`${index + 1}: ${line.trim().slice(0, 90)}`)
  }
  if (left.length > 0) {
    console.error(`${left.length} line(s) still contain Russian:`)
    for (const entry of left.slice(0, 20)) console.error(`  · ${entry}`)
    if (left.length > 20) console.error(`  … and ${left.length - 20} more`)
    process.exit(1)
  }

  fs.mkdirSync(path.dirname(TARGET), { recursive: true })
  fs.writeFileSync(TARGET, page, 'utf8')

  // Stamping is part of generating this page, not a separate step the author has
  // to remember: the copy rewrites every asset URL, so the `?v=` hashes the
  // Russian page carries are the wrong ones for these files. Doing it here means
  // one command produces a complete page and "generate, then forget to stamp"
  // cannot happen.
  execFileSync(process.execPath, [path.join(__dirname, 'stamp-assets.cjs')], {
    cwd: path.join(__dirname, '..'),
    stdio: 'ignore'
  })

  const kb = Math.round(Buffer.byteLength(page) / 1024)
  console.log(`site/en/index.html  ${replaced} replacement(s) from ${TEXT.length} entries  ${kb} KB`)
  console.log('No Russian left on the page, and every asset reference is stamped.')
}

main()
