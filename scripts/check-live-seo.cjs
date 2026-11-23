/**
 * The live site, checked as a visitor and as a crawler would find it.
 *
 * A deploy that returns 200 is not the same as pages that work. This walks every one of them on the
 * real domain and checks the things a bad deploy breaks quietly: the canonical URL pointing at the
 * address actually served, the two languages linking to each other rather than to a file path, the
 * asset stamps resolving, the sitemap listing URLs that answer, and robots.txt allowing them.
 *
 * It is a network test, so it is separate from `verify` — that one runs offline against `site/` and
 * has to stay fast enough to run on every edit. This one runs after a deploy.
 *
 * Usage: node scripts/check-live-seo.cjs
 */

const BASE = 'https://flushot.ink'
const PAGES = ['free-screenshot-tool', 'rounded-screenshot', 'screenshot-annotation']

const problems = []
const ok = []

async function get(url) {
  const response = await fetch(url, { redirect: 'follow' })
  return { status: response.status, text: await response.text(), url: response.url }
}

async function main() {
  for (const slug of PAGES) {
    for (const [lang, url] of [
      ['ru', `${BASE}/${slug}/`],
      ['en', `${BASE}/en/${slug}/`]
    ]) {
      const page = await get(url)
      const where = `${lang} ${slug}`

      if (page.status !== 200) {
        problems.push(`${where}: answered ${page.status}`)
        continue
      }

      // The canonical must name the address that was served, or the two languages compete for the
      // same query and neither wins.
      const canonical = /<link rel="canonical" href="([^"]+)">/.exec(page.text)
      if (!canonical) problems.push(`${where}: no canonical link`)
      else if (canonical[1] !== url) problems.push(`${where}: canonical says ${canonical[1]}, served at ${url}`)

      for (const tag of ['ru', 'en', 'x-default']) {
        if (!page.text.includes(`hreflang="${tag}"`)) problems.push(`${where}: no hreflang="${tag}"`)
      }

      // The language switch has to land on the same page in the other language, not on the home page.
      const switchHref = /<a class="lang-switch" href="([^"]+)"/.exec(page.text)
      if (!switchHref) problems.push(`${where}: no language switch`)
      else {
        const expected = lang === 'en' ? `${BASE}/${slug}/` : `${BASE}/en/${slug}/`
        const resolved = new URL(switchHref[1], url).href
        if (resolved !== expected) problems.push(`${where}: the switch goes to ${resolved}, expected ${expected}`)
      }

      // An accidental noindex is the one failure that makes a page invisible however good it is.
      const robots = /<meta[^>]+name="robots"[^>]*>/i.exec(page.text)
      const robotsContent = robots ? /content="([^"]*)"/i.exec(robots[0]) : null
      if (robotsContent && /noindex/i.test(robotsContent[1])) problems.push(`${where}: told not to be indexed`)
      if (/noindex/i.test(page.headers?.get?.('x-robots-tag') || '')) problems.push(`${where}: not indexable by header`)

      // Every local asset must load: a stale ?v= stamp or a wrong ../ prefix shows up here and
      // nowhere else.
      const assets = [...page.text.matchAll(/(?:src|href)="([^"]+)"/g)]
        .map((match) => match[1])
        .filter((value) => !/^(https?:|mailto:|#|data:)/.test(value))
      const unique = [...new Set(assets)]
      let failed = 0
      for (const asset of unique) {
        const response = await fetch(new URL(asset, url).href)
        if (response.status !== 200) {
          problems.push(`${where}: ${asset} answered ${response.status}`)
          failed += 1
        }
      }

      ok.push(`${where}: ${page.status}, canonical, hreflang, ${unique.length - failed}/${unique.length} assets`)
    }
  }

  // The sitemap has to list what is served, and everything it lists has to answer.
  const sitemap = await get(`${BASE}/sitemap.xml`)
  if (sitemap.status !== 200) problems.push(`sitemap.xml answered ${sitemap.status}`)
  const locs = [...sitemap.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1])
  for (const slug of PAGES) {
    for (const url of [`${BASE}/${slug}/`, `${BASE}/en/${slug}/`]) {
      if (!locs.includes(url)) problems.push(`sitemap.xml does not list ${url}`)
    }
  }
  let answered = 0
  for (const loc of locs) {
    const response = await get(loc)
    if (response.status !== 200) problems.push(`sitemap lists ${loc}, which answered ${response.status}`)
    else answered += 1
  }
  ok.push(`sitemap.xml: ${locs.length} urls, ${answered} of them answer`)

  const robots = await get(`${BASE}/robots.txt`)
  if (robots.status !== 200) problems.push(`robots.txt answered ${robots.status}`)
  if (!robots.text.includes('Sitemap: https://flushot.ink/sitemap.xml')) problems.push('robots.txt does not name the sitemap')
  if (!/^Allow: \/$/m.test(robots.text)) problems.push('robots.txt does not allow the site')
  ok.push('robots.txt: allows the site and names the sitemap')

  // The landing page has to link to all of them, or they are reachable only through the sitemap.
  const home = await get(`${BASE}/`)
  for (const slug of PAGES) {
    if (!home.text.includes(`href="${slug}/"`)) problems.push(`the landing page does not link to ${slug}/`)
  }
  ok.push('the landing page links to all three pages')

  for (const line of ok) console.log(`  ok    ${line}`)
  if (problems.length) {
    console.log(`\n${problems.length} PROBLEM(S):`)
    for (const problem of problems) console.log(`  ✗ ${problem}`)
    process.exit(1)
  }
  console.log('\nEvery page, asset, sitemap entry and robots rule answers on the live site.')
}

main().catch((error) => {
  console.error('FAILED', error.message)
  process.exit(1)
})
