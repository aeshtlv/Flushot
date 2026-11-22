/**
 * Builds the English pages from the Russian ones.
 *
 * Why generated and not written twice: the pages must stay identical in structure —
 * same sections, same ids, same anchors, same picture slots — and two hand-written
 * files drift the first time a section is added to only one of them. Here every
 * word lives in a translation table as an exact substring of the Russian page, the
 * build replaces them all, and then it refuses to write anything if a single
 * Cyrillic character survived. A missing translation is a failed build, not an
 * English page with a Russian paragraph in the middle.
 *
 * Two pages are built, both into `en/`: the landing page and the privacy policy.
 * They share every path rule because both Russian sources sit at the site root and
 * both English targets sit one directory below it — which is what lets one engine
 * serve both without a per-page depth argument.
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

const CYRILLIC = /[\u0400-\u04FF]/

/** Prefix every root-relative reference gains on a page one level down. */
const ROOT_PREFIX = '../'

/**
 * Files the English pages load from the site root. They live one level down, so
 * each of these gains `../`; images go to their own directory instead.
 */
const ROOT_FILES = [
  'favicon.svg',
  'favicon-32.png',
  'apple-touch-icon.png',
  'site.webmanifest',
  'fonts.css',
  'styles.css',
  'app.js',
  'metrics.js'
]

const LANG_SWITCH = new RegExp(
  '<a class="lang-switch" href="[^"]*" hreflang="en" lang="en" data-lang-switch\\n\\s*aria-label="[^"]*">[^<]*<\\/a>'
)

const PAGES = [
  {
    source: 'index.html',
    target: 'en/index.html',
    text: require('./en-page-text.cjs'),
    switchTo: 'RU',
    switchHref: '../',
    // The landing page is the one that carries the social preview card.
    expectEnglishCard: true,
    rules: [
      // Only the canonical and the sharing URL move to /en/: a blanket swap of the
      // origin would also rewrite the picture addresses, and the card replacement
      // below would then match nothing.
      ['<link rel="canonical" href="https://flushot.ink/">', '<link rel="canonical" href="https://flushot.ink/en/">'],
      [
        '<meta property="og:url" content="https://flushot.ink/">',
        '<meta property="og:url" content="https://flushot.ink/en/">'
      ],
      // The link preview is a separate picture per language: the card shows the
      // program as that reader sees it. Applied to the URL without its `?v=` query,
      // because that hash changes whenever the Russian card is regenerated and a
      // replacement pinned to the old one would silently stop matching. The query is
      // put back by `stamp-assets.cjs`, which runs at the end of this script.
      [/https:\/\/flushot\.ink\/og-image\.png(\?v=[0-9a-f]{8})?/g, 'https://flushot.ink/og-image-en.png']
    ]
  },
  {
    source: 'privacy.html',
    target: 'en/privacy.html',
    text: require('./en-privacy-text.cjs'),
    switchTo: 'RU',
    switchHref: '../privacy.html',
    expectEnglishCard: false,
    rules: [
      [
        '<link rel="canonical" href="https://flushot.ink/privacy.html">',
        '<link rel="canonical" href="https://flushot.ink/en/privacy.html">'
      ],
      // The links that walk back into the site: the brand, the way back, the footer.
      ['="index.html', `="${ROOT_PREFIX}index.html`]
    ]
  }
]

/**
 * Splits a rule list into plain replacements and regular expressions, applied in
 * the order they were written: the canonical and hreflang URLs are absolute, so the
 * plain swap has to happen before anything looks at `https://flushot.ink/` again.
 */
function applyRules(page, rules) {
  let out = page
  for (const [from, to] of rules) {
    out = from instanceof RegExp ? out.replace(from, to) : out.split(from).join(to)
  }
  return out
}

function renderPage(config) {
  const source = path.join(SITE, config.source)
  const target = path.join(SITE, config.target)
  const text = config.text
  let page = fs.readFileSync(source, 'utf8')

  // ------------------------------------------------------------- the words
  // Longest first: a short entry ("Готово") would otherwise cut into a longer
  // one that contains it ("Готово, снимок в буфере") and leave a fragment.
  const pairs = [...text].sort((a, b) => b[0].length - a[0].length)
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
  // Both languages claim the same canonical URL only if this is missed, and a
  // canonical that points at the other language is worse than none at all.
  page = applyRules(page, config.rules)
  page = page.replace('<meta property="og:locale" content="ru_RU">', '<meta property="og:locale" content="en_GB">')
  // The structured-data block declares the document's language too, and on the
  // English page the Russian declaration contradicts `lang="en"`. The currency
  // stays RUB: the price is what it is, and converting it would invent a number.
  page = page.replace('"inLanguage": "ru"', '"inLanguage": "en"')

  // The switch points the other way on this page, and stays on the same document:
  // someone reading the privacy policy in English wants the policy, not the landing
  // page.
  if (!LANG_SWITCH.test(page)) {
    console.error(`${config.source}: the language switch is missing or not in the expected shape`)
    process.exit(1)
  }
  page = page.replace(
    LANG_SWITCH,
    `<a class="lang-switch" href="${config.switchHref}" hreflang="ru" lang="ru" data-lang-switch
         aria-label="Русская версия">${config.switchTo}</a>`
  )

  // ------------------------------------------------------------- the paths
  for (const file of ROOT_FILES) {
    page = page.replaceAll(`="${file}`, `="${ROOT_PREFIX}${file}`)
  }
  page = page.replaceAll('="assets/', `="${ROOT_PREFIX}assets/en/`)
  page = page.replaceAll('srcset="assets/', `srcset="${ROOT_PREFIX}assets/en/`)

  // -------------------------------------------------------- nothing left
  if (unused.length > 0) {
    console.error(`${unused.length} translation(s) for ${config.source} match nothing:`)
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
    console.error(`${config.source}: the link back to the Russian page is missing or duplicated`)
    process.exit(1)
  }
  const scannable = page.split(SWITCH_LABEL).join('')

  if (config.expectEnglishCard && !page.includes('https://flushot.ink/og-image-en.png')) {
    console.error(`${config.source}: the English page still points its link preview at the Russian card`)
    process.exit(1)
  }

  const left = []
  for (const [index, line] of scannable.split('\n').entries()) {
    if (CYRILLIC.test(line)) left.push(`${index + 1}: ${line.trim().slice(0, 90)}`)
  }
  if (left.length > 0) {
    console.error(`${config.target} still has ${left.length} line(s) with Russian:`)
    for (const entry of left.slice(0, 20)) console.error(`  · ${entry}`)
    if (left.length > 20) console.error(`  … and ${left.length - 20} more`)
    process.exit(1)
  }

  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, page, 'utf8')

  const kb = Math.round(Buffer.byteLength(page) / 1024)
  console.log(`site/${config.target}  ${replaced} replacement(s) from ${text.length} entries  ${kb} KB`)
}

for (const config of PAGES) renderPage(config)

// Stamping is part of generating these pages, not a separate step the author has
// to remember: the copies rewrite every asset URL, so the `?v=` hashes the Russian
// pages carry are the wrong ones for these files. Doing it here means one command
// produces complete pages and "generate, then forget to stamp" cannot happen.
execFileSync(process.execPath, [path.join(__dirname, 'stamp-assets.cjs')], {
  cwd: ROOT,
  stdio: 'ignore'
})

console.log('No Russian left on the pages, and every asset reference is stamped.')
