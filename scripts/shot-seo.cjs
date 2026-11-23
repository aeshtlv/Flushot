/**
 * Renders every search page in headless Edge, at desktop and phone widths, and measures what a
 * screenshot cannot tell you: horizontal overflow, clipped text, elements wider than the viewport.
 *
 * A page can pass every markup check and still be broken — a heading that runs under the header, a
 * grid that does not collapse on a phone, a long Russian word pushing a card off the screen. This
 * loads the real page and measures the rendered result, then saves a screenshot for a human.
 *
 * Usage: node scripts/shot-seo.cjs [--page=ru|en|both] [--slug=free-screenshot-tool]
 */

const path = require('node:path')
const fs = require('node:fs/promises')
const fsSync = require('node:fs')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { pathToFileURL } = require('node:url')

const ROOT = path.join(__dirname, '..')
const SITE = path.join(ROOT, 'site')
const ARGS = process.argv.join(' ')
const PAGE = /--page=(ru|en|both)/.exec(ARGS)?.[1] ?? 'both'
const ONLY = /--slug=([a-z-]+)/.exec(ARGS)?.[1] ?? null
const OUT_ROOT = path.join(ROOT, '.tmp', 'seo-shots')
const PORT = 9411

const EDGE_CANDIDATES = [
  path.join(process.env['ProgramFiles'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
]

const WIDTHS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 820, height: 1000 },
  { name: 'phone', width: 390, height: 844 }
]

const problems = []
const notes = []

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function findEdge() {
  const found = EDGE_CANDIDATES.find((candidate) => fsSync.existsSync(candidate))
  if (!found) throw new Error('Edge not found')
  return found
}

async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }))
  let id = 1
  const pending = new Map()
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result)
  })
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const myId = id++
      pending.set(myId, { resolve, reject })
      ws.send(JSON.stringify({ id: myId, method, params }))
    })
  await send('Runtime.enable')
  await send('Page.enable')
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || 'eval failed')
    return result.result.value
  }
  return { ws, send, evaluate }
}

/** Every page to render, as a site-relative path. */
function pagesToRender() {
  const { PAGES } = require('./seo-pages.cjs')
  const out = []
  for (const page of PAGES) {
    if (ONLY && page.slug !== ONLY) continue
    if (PAGE === 'ru' || PAGE === 'both') out.push({ slug: page.slug, lang: 'ru', file: `${page.slug}/index.html` })
    if (PAGE === 'en' || PAGE === 'both') out.push({ slug: page.slug, lang: 'en', file: `en/${page.slug}/index.html` })
  }
  return out
}

async function main() {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'flushot-seo-'))
  const edge = spawn(
    findEdge(),
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      'about:blank'
    ],
    { stdio: 'ignore' }
  )

  for (let attempt = 0; attempt < 150; attempt++) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break
    } catch {
      /* waiting */
    }
    await sleep(120)
  }

  const target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page')
  const page = await connect(target)
  await fs.mkdir(OUT_ROOT, { recursive: true })

  for (const entry of pagesToRender()) {
    for (const size of WIDTHS) {
      await page.send('Emulation.setDeviceMetricsOverride', {
        width: size.width,
        height: size.height,
        deviceScaleFactor: 1,
        mobile: size.name === 'phone'
      })

      const url = pathToFileURL(path.join(SITE, entry.file)).href
      await page.send('Page.navigate', { url })
      // The reveal animation and the fonts both settle inside this window; measuring earlier
      // reports positions from a page that is still moving.
      await sleep(1100)

      const where = `${entry.lang} ${entry.slug} @${size.name}`

      const metrics = await page.evaluate(`(function () {
        const doc = document.documentElement;
        const overflow = doc.scrollWidth - doc.clientWidth;

        // Anything sticking out of the viewport, by the amount it sticks out.
        const out = [];
        for (const node of document.querySelectorAll('body *')) {
          const rect = node.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) continue;
          const over = Math.round(rect.right - doc.clientWidth);
          if (over > 1) {
            out.push({
              tag: node.tagName.toLowerCase(),
              cls: (node.className && node.className.toString().slice(0, 40)) || '',
              over
            });
          }
        }

        // Text that is cut off inside its own box.
        const clipped = [];
        for (const node of document.querySelectorAll('h1, h2, h3, p, li, span, summary')) {
          if (node.children.length) continue;
          if (node.scrollWidth > node.clientWidth + 1 && getComputedStyle(node).overflow !== 'visible') {
            clipped.push(node.textContent.trim().slice(0, 40));
          }
        }

        return {
          overflow,
          overflowNodes: out.slice(0, 5),
          clipped: clipped.slice(0, 5),
          h1: document.querySelectorAll('h1').length,
          downloadButtons: document.querySelectorAll('a.btn[href*="#download"]').length,
          height: Math.round(document.body.scrollHeight)
        };
      })()`)

      if (metrics.overflow > 1) {
        problems.push(`${where}: horizontal overflow of ${metrics.overflow}px`)
        for (const node of metrics.overflowNodes) {
          problems.push(`  ${node.tag}.${node.cls} sticks out by ${node.over}px`)
        }
      }
      if (metrics.clipped.length) {
        problems.push(`${where}: clipped text — ${metrics.clipped.join(' | ')}`)
      }
      if (metrics.h1 !== 1) problems.push(`${where}: ${metrics.h1} <h1> elements`)
      if (metrics.downloadButtons === 0) problems.push(`${where}: no download button`)

      const shot = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
      const name = `${entry.lang}-${entry.slug}-${size.name}.png`
      await fs.writeFile(path.join(OUT_ROOT, name), Buffer.from(shot.data, 'base64'))
      notes.push(`${name}  ${size.width}×${size.height}  page height ${metrics.height}px  downloads ${metrics.downloadButtons}`)
    }
  }

  page.ws.close()
  edge.kill()
  await fs.rm(profile, { recursive: true, force: true }).catch(() => {})

  for (const note of notes) console.log(`  · ${note}`)
  if (problems.length) {
    console.error(`\n${problems.length} PROBLEM(S):`)
    for (const problem of problems) console.error(`  ✗ ${problem}`)
    process.exitCode = 1
  } else {
    console.log(`\n${notes.length} renders: no overflow, no clipped text, one H1 and a download button on each`)
  }
}

main().catch((error) => {
  console.error('FAILED', error)
  process.exit(1)
})
