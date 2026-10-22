/**
 * Checks the *deployed* page, not the local copy.
 *
 * `verify-site.cjs` inspects files on disk: links, contrast, markup. It cannot
 * see the things that only go wrong on a server — a missing MIME type, a font
 * that 404s, a redirect that drops the path, an HTML page cached from before the
 * deploy. This script loads the URL over the network in a real browser and
 * reports the numbers that reveal those failures.
 *
 * Usage:
 *   node scripts/check-live.cjs                       # https://flushot.ink/
 *   node scripts/check-live.cjs https://example.com/  # any other address
 *
 * Requires Edge or Chrome on Windows, like `shot-site.cjs`. Exits non-zero on a
 * problem, so it can be the last step of a deploy.
 */

const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const URL_TO_CHECK = process.argv[2] || 'https://flushot.ink/'

const BROWSER_CANDIDATES = [
  path.join(process.env['ProgramFiles'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  path.join(process.env['ProgramFiles'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  path.join(process.env['ProgramFiles(x86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe')
]

const WIDTHS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'small', width: 320, height: 700 }
]

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function findBrowser() {
  for (const candidate of BROWSER_CANDIDATES) {
    if (candidate && fs.existsSync(candidate)) return candidate
  }
  throw new Error('no Edge or Chrome found; this check needs a headless browser')
}

async function waitForEndpoint(port, tries = 60) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (response.ok) return await response.json()
    } catch {
      /* not up yet */
    }
    await sleep(250)
  }
  throw new Error('browser did not expose the debugging endpoint')
}

/** Minimal Chrome DevTools Protocol client over the WebSocket the browser exposes. */
class Cdp {
  constructor(socket) {
    this.socket = socket
    this.nextId = 1
    this.pending = new Map()
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id)
        this.pending.delete(message.id)
        if (message.error) reject(new Error(message.error.message))
        else resolve(message.result)
      }
    })
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId
    this.nextId += 1
    const payload = { id, method, params }
    if (sessionId) payload.sessionId = sessionId
    this.socket.send(JSON.stringify(payload))
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      setTimeout(() => reject(new Error(`${method} timed out`)), 45000)
    })
  }
}

async function main() {
  const browserPath = findBrowser()
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flushot-live-'))
  const port = 9300 + Math.floor(Math.random() * 400)
  const browser = spawn(
    browserPath,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
      `--user-data-dir=${userDataDir}`,
      `--remote-debugging-port=${port}`,
      'about:blank'
    ],
    { stdio: 'ignore' }
  )

  const problems = []
  try {
    await waitForEndpoint(port)
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    const page = targets.find((target) => target.type === 'page')
    const socket = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve)
      socket.addEventListener('error', reject)
    })
    const cdp = new Cdp(socket)

    await cdp.send('Page.enable')
    await cdp.send('Network.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Log.enable')

    const failures = []
    const consoleErrors = []
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.method === 'Network.responseReceived') {
        const { url, status } = message.params.response
        if (status >= 400) failures.push(`${status} ${url}`)
      }
      if (message.method === 'Log.entryAdded') {
        const entry = message.params.entry
        if (entry.level === 'error') consoleErrors.push(entry.text)
      }
    })

    console.log(`checking ${URL_TO_CHECK}\n`)

    for (const viewport of WIDTHS) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
        mobile: viewport.width < 700
      })
      await cdp.send('Page.navigate', { url: URL_TO_CHECK })
      await sleep(2000)

      // Some screenshots on the page carry `loading="lazy"`, so they only start
      // downloading once they come near the viewport. Scroll the whole page first,
      // otherwise an image that has not been reached yet looks like a broken one.
      await cdp.send('Runtime.evaluate', {
        awaitPromise: true,
        expression: `(async () => {
          const step = window.innerHeight * 0.8
          for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
            window.scrollTo(0, y)
            await new Promise((r) => setTimeout(r, 120))
          }
          window.scrollTo(0, 0)
          await new Promise((r) => setTimeout(r, 800))
        })()`
      })
      await sleep(1200)

      const { result } = await cdp.send('Runtime.evaluate', {
        returnByValue: true,
        expression: `(() => {
          const doc = document.documentElement
          const wide = [...document.querySelectorAll('body *')]
            .filter((el) => {
              const r = el.getBoundingClientRect()
              return r.width > 0 && (r.right > doc.clientWidth + 1 || r.left < -1)
            })
            .slice(0, 5)
            .map((el) => el.tagName + '.' + (el.className || '').toString().slice(0, 30))
          const interLoaded = [...document.fonts].filter((f) => f.family.includes('Inter') && f.status === 'loaded').length
          const monoLoaded = [...document.fonts].filter((f) => f.family.includes('JetBrains') && f.status === 'loaded').length
          const images = [...document.images]
          // Images inside a hidden tab panel have no box, so the browser never
          // starts their lazy load. Those are not broken, they are simply not shown
          // yet — only images that occupy space and still have no pixels count.
          const broken = images
            .filter((img) => img.getClientRects().length > 0)
            .filter((img) => !img.complete || img.naturalWidth === 0)
            .map((img) => img.currentSrc || img.src)
          return {
            title: document.title,
            scrollWidth: doc.scrollWidth,
            clientWidth: doc.clientWidth,
            docHeight: doc.scrollHeight,
            overflowX: doc.scrollWidth - doc.clientWidth,
            wide,
            interLoaded,
            monoLoaded,
            imageCount: images.length,
            brokenImages: broken,
            h1: (document.querySelector('h1')?.innerText || '').replace(/\\s+/g, ' ').trim()
          }
        })()`
      })

      const measured = result.value
      const label = `${viewport.name} ${viewport.width}x${viewport.height}`
      console.log(`${label}  doc ${measured.clientWidth}x${measured.docHeight}  overflowX=${measured.overflowX}`)
      console.log(`  h1: ${measured.h1}`)
      console.log(`  fonts loaded: Inter ${measured.interLoaded}, JetBrains ${measured.monoLoaded}`)
      console.log(`  images: ${measured.imageCount}, broken: ${measured.brokenImages.length}`)
      if (measured.overflowX > 0) {
        problems.push(`${label}: horizontal overflow ${measured.overflowX}px (${measured.wide.join(', ')})`)
      }
      if (measured.interLoaded === 0) problems.push(`${label}: Inter did not load`)
      if (measured.brokenImages.length > 0) {
        problems.push(`${label}: broken images ${measured.brokenImages.slice(0, 3).join(', ')}`)
      }
    }

    if (failures.length > 0) {
      problems.push(`failed requests: ${[...new Set(failures)].slice(0, 5).join(', ')}`)
    }
    if (consoleErrors.length > 0) {
      problems.push(`console errors: ${[...new Set(consoleErrors)].slice(0, 3).join(' | ')}`)
    }

    console.log(`\nnetwork failures: ${failures.length}`)
    console.log(`console errors: ${consoleErrors.length}`)
  } finally {
    browser.kill()
    await sleep(500)
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true })
    } catch {
      /* Windows may hold the lock for a moment */
    }
  }

  if (problems.length > 0) {
    console.error(`\n${problems.length} PROBLEM(S):`)
    for (const problem of problems) console.error(`  x ${problem}`)
    process.exitCode = 1
  } else {
    console.log('\nThe deployed page is intact.')
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
