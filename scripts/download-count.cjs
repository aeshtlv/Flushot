/**
 * Prints how many times each release archive has been downloaded.
 *
 * GitHub counts downloads, not installations: someone who downloads the zip, unpacks
 * it, and never opens it counts the same as someone who uses the program daily. That
 * is the honest number available without telemetry, and saying "downloads" is the
 * reason the program can keep claiming it sends nothing about the user anywhere.
 *
 * Replacing an asset resets its counter, so a release that is re-uploaded reports 0
 * until people download it again. That is why `docs/GITHUB.md` says to publish a new
 * version rather than rebuild the same one.
 *
 * The landing page shows the same number, so the counter can write it too:
 *
 * Usage:
 *   node scripts/download-count.cjs                       # print
 *   node scripts/download-count.cjs --write               # also update README.md
 *   node scripts/download-count.cjs --write --site <dir>  # and the landing page
 *
 * `<dir>` is a checkout of the `site` branch, because the landing page lives there
 * and the two branches never meet.
 */

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const REPO = 'aeshtlv/Flushot'
const BEGIN = '<!-- downloads:begin -->'
const END = '<!-- downloads:end -->'

const token = resolveToken()

function resolveToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN
  const file = path.join(ROOT, '.tmp', 'gh-token.txt')
  try {
    return fs.readFileSync(file, 'utf8').trim()
  } catch {
    return null
  }
}

async function api(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'flushot-download-count',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  })
  if (!response.ok) throw new Error(`${url} → ${response.status} ${await response.text()}`)
  return response.json()
}

/** "149" for 149, "1,2 тыс." for 1 234 — the number people can read at a glance. */
function human(value, language) {
  if (value < 1000) return String(value)
  const thousands = (value / 1000).toFixed(value < 10_000 ? 1 : 0).replace('.', ',')
  return language === 'ru' ? `${thousands} тыс.` : `${thousands.replace(',', '.')}k`
}

async function main() {
  const releases = await api(`https://api.github.com/repos/${REPO}/releases?per_page=100`)
  if (!Array.isArray(releases) || releases.length === 0) throw new Error('no releases found')

  let total = 0
  const rows = []
  for (const release of releases) {
    for (const asset of release.assets) {
      total += asset.download_count
      rows.push({
        version: release.tag_name,
        name: asset.name,
        downloads: asset.download_count,
        sizeMB: Math.round((asset.size / 1024 / 1024) * 10) / 10
      })
    }
  }

  rows.sort((a, b) => b.downloads - a.downloads)
  for (const row of rows) {
    console.log(`${String(row.downloads).padStart(6)}  ${row.version.padEnd(8)} ${row.name}`)
  }
  console.log(`${String(total).padStart(6)}  total across ${releases.length} release(s)`)

  const latest = releases.find((release) => !release.prerelease && !release.draft) ?? releases[0]
  const latestTotal = latest.assets.reduce((sum, asset) => sum + asset.download_count, 0)
  const line = `Скачано с GitHub для **${latest.tag_name}**: ${human(latestTotal, 'ru')} — из них ${latest.assets
    .map((asset) => `${human(asset.download_count, 'ru')} ${asset.name.replace(/^Flushot-[\d.]+-/, '')}`)
    .join(', ')}. Считаются скачивания, не установки.`

  console.log(`\n${line}`)

  if (process.argv.includes('--write')) {
    const file = path.join(ROOT, 'README.md')
    const source = fs.readFileSync(file, 'utf8')
    if (!source.includes(BEGIN) || !source.includes(END)) throw new Error('the markers are missing from README.md')
    const next = source.replace(
      new RegExp(`${BEGIN}[\\s\\S]*?${END}`),
      `${BEGIN}\n${line}\n${END}`
    )
    fs.writeFileSync(file, next, 'utf8')
    console.log('README.md updated')
  }

  const siteIndex = process.argv.indexOf('--site')
  if (siteIndex > 0) {
    const directory = process.argv[siteIndex + 1]
    if (!directory) throw new Error('--site needs a directory: the checkout of the site branch')
    const page = path.join(directory, 'site', 'index.html')
    if (!fs.existsSync(page)) throw new Error(`no landing page at ${page}`)
    const html = fs.readFileSync(page, 'utf8')
    if (!html.includes('data-downloads')) {
      throw new Error('the landing page has no data-downloads element to fill')
    }
    // Only the number: the words around it belong to the page, and rewriting them
    // here would put a second copy of the interface text in a script.
    const next = html.replace(/(<b data-downloads>)[^<]*(<\/b>)/, `$1${human(total, 'ru')}$2`)
    fs.writeFileSync(page, next, 'utf8')
    console.log(`landing page updated: ${human(total, 'ru')} across ${releases.length} release(s)`)
  }

  // A release without these files cannot update anyone, and the failure would only
  // show up on a user's machine days later.
  const names = latest.assets.map((asset) => asset.name)
  const required = [
    `Flushot-${latest.tag_name.replace(/^v/, '')}-x64.exe`,
    'latest.yml',
    `Flushot-${latest.tag_name.replace(/^v/, '')}-x64.exe.blockmap`
  ]
  const missing = required.filter((name) => !names.includes(name))
  if (missing.length > 0) {
    console.error(`\nthe release is missing files the updater needs: ${missing.join(', ')}`)
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
