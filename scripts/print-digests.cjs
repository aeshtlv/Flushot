/**
 * Print the SHA-256 of every release archive in `share/`.
 *
 * The download page publishes these digests next to the buttons, because the
 * program is unsigned and Windows warns about it: a hash is the only way for a
 * reader to tell whether the file they received is the file we shipped.
 *
 * Run this after the archives are rebuilt, paste the three values into
 * `site/index.html`, and `npm run verify:site` will refuse to pass if the page
 * and the files disagree.
 *
 * Usage: node scripts/print-digests.cjs
 */

const path = require('node:path')
const fs = require('node:fs')
const { createHash } = require('node:crypto')

const ROOT = path.join(__dirname, '..')
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version

const archives = fs
  .readdirSync(path.join(ROOT, 'share'))
  .filter((name) => name.endsWith('.zip'))
  .sort()

if (archives.length === 0) {
  console.error('share/ holds no archives — build them first (see docs/DEVELOPMENT.md)')
  process.exit(1)
}

for (const name of archives) {
  const file = path.join(ROOT, 'share', name)
  const data = fs.readFileSync(file)
  const digest = createHash('sha256').update(data).digest('hex')
  const size = (data.length / 1024 / 1024).toFixed(1)
  const stale = name.includes(version) ? '' : `  (not ${version} — the page shows the current release only)`
  console.log(`${digest}  ${size.padStart(5)} MB  ${name}${stale}`)
}
