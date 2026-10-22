/**
 * Checks the Markdown documentation the way `verify-site.cjs` checks the site.
 *
 * A README rots quietly: a renamed file, a moved section, an image that was deleted — all
 * of it renders as a plain blue link that 404s, and nobody clicks every link in a document
 * they just wrote. So the links are checked here, including anchors, because `#сборка-и-
 * упаковка` in one file pointing at a heading that was renamed in another is the exact
 * failure that a split into several documents invites.
 *
 * Usage: node scripts/verify-docs.cjs
 */

const path = require('node:path')
const { existsSync, readFileSync, statSync } = require('node:fs')

const ROOT = path.join(__dirname, '..')

/** Every document that is part of the public face of the repository. */
const DOCUMENTS = [
  'README.md',
  'README.en.md',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'LICENSE',
  'docs/ARCHITECTURE.md',
  'docs/DEVELOPMENT.md',
  'docs/GITHUB.md',
  'docs/ROADMAP.md'
]

const problems = []
const notes = []

/** GitHub's heading anchor: lowercase, drop punctuation, spaces become hyphens. */
function anchorOf(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
}

/** Headings of a document, skipping the ones inside fenced code blocks. */
function headings(text) {
  const found = new Set()
  let fenced = false
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced
      continue
    }
    if (fenced) continue
    const match = /^(#{1,6})\s+(.*)$/.exec(line)
    if (match) found.add(anchorOf(match[2]))
  }
  return found
}

/** Remove fenced blocks and inline code, so examples are not mistaken for real links. */
function prose(text) {
  const withoutFences = text.replace(/^\s*```[\s\S]*?^\s*```/gm, '')
  return withoutFences.replace(/`[^`\n]*`/g, '')
}

/** `[text](target)` and `![alt](target)`, plus HTML `<img src="...">`. */
function links(text) {
  const source = prose(text)
  const found = []
  const pattern = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
  let match
  while ((match = pattern.exec(source)) !== null) {
    found.push(match[1])
  }
  const imgPattern = /<img[^>]*\ssrc="([^"]+)"/g
  while ((match = imgPattern.exec(source)) !== null) {
    found.push(match[1])
  }
  return found
}

function main() {
  const cache = new Map()
  const read = (file) => {
    if (!cache.has(file)) cache.set(file, readFileSync(path.join(ROOT, file), 'utf8'))
    return cache.get(file)
  }

  for (const document of DOCUMENTS) {
    if (!existsSync(path.join(ROOT, document))) {
      problems.push(`${document} is missing`)
      continue
    }
    const text = read(document)
    let checked = 0

    for (const target of links(text)) {
      if (/^(https?:|mailto:|tel:|data:)/.test(target)) continue

      // `../../releases/latest/download/x.zip` is a GitHub route, not a file.
      if (target.includes('/releases/')) continue

      const [rawPath, rawAnchor] = target.split('#')
      // `ПРОЧТИ%20МЕНЯ.txt` is how the space has to be written in Markdown.
      const decoded = rawPath === '' ? '' : decodeURIComponent(rawPath)
      const resolved = decoded === '' ? document : path.resolve(ROOT, path.dirname(document), decoded)
      const relative = path.relative(ROOT, resolved).replace(/\\/g, '/')

      if (!existsSync(resolved)) {
        problems.push(`${document}: ${target} does not exist`)
        continue
      }
      checked += 1

      if (rawAnchor) {
        if (!statSync(resolved).isFile() || !relative.endsWith('.md')) {
          problems.push(`${document}: ${target} has an anchor but is not a Markdown file`)
          continue
        }
        const anchors = headings(read(relative))
        if (!anchors.has(rawAnchor)) {
          problems.push(`${document}: ${target} points at a missing heading`)
        }
      }
    }
    notes.push(`${document}: ${checked} local link(s) resolve`)
  }

  // Every document must be reachable from the README, otherwise nobody finds it.
  const readme = read('README.md')
  for (const document of DOCUMENTS) {
    if (document === 'README.md') continue
    if (!readme.includes(document)) problems.push(`${document} is not linked from README.md`)
  }
  notes.push('every document is linked from README.md')

  // The repository must not promise archives it does not have, and the README must name
  // the version that package.json declares.
  const version = JSON.parse(read('package.json')).version
  if (!readme.includes(version)) problems.push(`README.md does not mention version ${version}`)
  const changelog = read('CHANGELOG.md')
  if (!changelog.includes(version)) problems.push(`CHANGELOG.md has no entry for ${version}`)
  notes.push(`version ${version} appears in README.md and CHANGELOG.md`)

  for (const note of notes) console.log(`  · ${note}`)

  if (problems.length > 0) {
    console.error(`\n${problems.length} PROBLEM(S):`)
    for (const problem of problems) console.error(`  ✗ ${problem}`)
    process.exitCode = 1
  } else {
    console.log('\nDocumentation links resolve.')
  }
}

main()
