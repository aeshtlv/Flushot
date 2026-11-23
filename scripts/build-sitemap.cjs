/**
 * Writes `site/sitemap.xml` from the pages that exist.
 *
 * Hand-maintained, this file is wrong within a week: a page gets added and the sitemap does not
 * learn about it, or a URL changes and the old one keeps being submitted. Generating it means the
 * sitemap is a statement about the site as it is, and the check in `verify-site.cjs` compares the
 * two so a page that exists but is missing here is a red test rather than a silent omission.
 *
 * Every entry carries the full hreflang set for both languages plus `x-default`, because a page
 * that is translated and does not say so competes with itself in search.
 *
 * Usage: node scripts/build-sitemap.cjs
 */

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const SITE = path.join(ROOT, 'site')
const ORIGIN = 'https://flushot.ink'
const { PAGES } = require('./seo-pages.cjs')

/**
 * One `<url>` entry.
 *
 * `alternates` is a list of `[hreflang, href]`; the order is the order they are written, and
 * `x-default` belongs last by convention.
 */
function entry(loc, alternates, changefreq, priority) {
  const links = alternates
    .map(([lang, href]) => `    <xhtml:link rel="alternate" hreflang="${lang}" href="${href}"/>`)
    .join('\n')
  return `  <url>
    <loc>${loc}</loc>
${links}
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`
}

const urls = []

// The landing page and its translation.
urls.push(
  entry(`${ORIGIN}/`, [['ru', `${ORIGIN}/`], ['en', `${ORIGIN}/en/`], ['x-default', `${ORIGIN}/`]], 'weekly', '1.0')
)
urls.push(
  entry(`${ORIGIN}/en/`, [['ru', `${ORIGIN}/`], ['en', `${ORIGIN}/en/`], ['x-default', `${ORIGIN}/`]], 'weekly', '0.9')
)

// The search pages. Priority 0.8: they exist to be found, but the landing page is where the
// download and the full picture live, so they must not outrank it.
for (const page of PAGES) {
  const ru = `${ORIGIN}/${page.slug}/`
  const en = `${ORIGIN}/en/${page.slug}/`
  const alternates = [['ru', ru], ['en', en], ['x-default', ru]]
  urls.push(entry(ru, alternates, 'monthly', '0.8'))
  urls.push(entry(en, alternates, 'monthly', '0.7'))
}

// The policy. Listed because a page that only exists to be linked from a consent banner should
// still be findable, and its URL is what the banner points at.
urls.push(
  entry(
    `${ORIGIN}/privacy.html`,
    [
      ['ru', `${ORIGIN}/privacy.html`],
      ['en', `${ORIGIN}/en/privacy.html`],
      ['x-default', `${ORIGIN}/privacy.html`]
    ],
    'yearly',
    '0.3'
  )
)
urls.push(
  entry(
    `${ORIGIN}/en/privacy.html`,
    [
      ['ru', `${ORIGIN}/privacy.html`],
      ['en', `${ORIGIN}/en/privacy.html`],
      ['x-default', `${ORIGIN}/privacy.html`]
    ],
    'yearly',
    '0.3'
  )
)

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join('\n')}
</urlset>
`

fs.writeFileSync(path.join(SITE, 'sitemap.xml'), xml, 'utf8')
console.log(`sitemap.xml: ${urls.length} urls`)
