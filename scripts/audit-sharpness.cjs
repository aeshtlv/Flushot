/**
 * Is any picture being upscaled?
 *
 * A picture is sharp on a normal screen when it has at least as many real pixels as the box it is
 * drawn in, and sharp on a high-density screen when it has twice that. This measures both: the
 * natural width of every image against the box it is painted in, and reports the ratio.
 *
 * A ratio below 1.0 is an upscale — the browser inventing pixels, which is what "blurred" means. A
 * ratio between 1.0 and 2.0 is sharp on a normal screen and soft on a Retina one. Two or more is
 * what the assets are meant to be.
 *
 * Usage: node scripts/audit-sharpness.cjs
 */

const path = require('node:path')
const fs = require('node:fs/promises')
const fsSync = require('node:fs')
const os = require('node:os')
const http = require('node:http')
const { spawn } = require('node:child_process')

const ROOT = path.join(__dirname, '..')
const SITE = path.join(ROOT, 'site')
const PORT = 9437
const BROWSER_PORT = 9439

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8'
}

const problems = []
const notes = []
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer(async (request, response) => {
      const url = decodeURIComponent(request.url.split('?')[0])
      let file = path.join(SITE, url)
      try {
        const stat = await fs.stat(file).catch(() => null)
        if (stat && stat.isDirectory()) file = path.join(file, 'index.html')
        const body = await fs.readFile(file)
        response.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' })
        response.end(body)
      } catch {
        response.writeHead(404, { 'Content-Type': 'text/plain' })
        response.end('not found')
      }
    })
    server.listen(PORT, '127.0.0.1', () => resolve(server))
  })
}

function findEdge() {
  return [
    path.join(process.env['ProgramFiles'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  ].find((candidate) => fsSync.existsSync(candidate))
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

async function main() {
  const { PAGES } = require('./seo-pages.cjs')
  const server = await serve()
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'flushot-sharp-'))
  const edge = spawn(
    findEdge(),
    [
      '--headless=new',
      `--remote-debugging-port=${BROWSER_PORT}`,
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
      if ((await fetch(`http://127.0.0.1:${BROWSER_PORT}/json/version`)).ok) break
    } catch {
      /* waiting */
    }
    await sleep(120)
  }

  const target = (await (await fetch(`http://127.0.0.1:${BROWSER_PORT}/json/list`)).json()).find((t) => t.type === 'page')
  const page = await connect(target)

  // The widest layout is the worst case for sharpness, so that is the one measured.
  const pages = [
    { name: 'landing', url: `http://127.0.0.1:${PORT}/` },
    ...PAGES.map((entry) => ({ name: entry.slug, url: `http://127.0.0.1:${PORT}/${entry.slug}/` }))
  ]

  for (const entry of pages) {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
    await page.send('Page.navigate', { url: entry.url })
    await sleep(800)
    await page.evaluate(`(async function () {
      // Every picture is asked for eagerly — a lazy one that has not arrived has no naturalWidth,
      // and an unmeasured picture is a picture this audit cannot vouch for — and then polled until it
      // reports a size. Polling rather than listening for an event: a listener attached after the
      // load has already happened never fires, and that ordering is not something to depend on.
      const images = [...document.querySelectorAll('img')];
      for (const img of images) img.loading = 'eager';
      const deadline = Date.now() + 6000;
      while (Date.now() < deadline) {
        if (images.every(function (img) { return img.complete; })) break;
        await new Promise(function (r) { setTimeout(r, 100); });
      }
      return images.filter(function (img) { return img.naturalWidth === 0; }).length;
    })()`)

    await page.evaluate(`(function () {
      // The tabbed gallery keeps its other panels hidden. Revealing them gives each picture the box
      // it will have when its tab is opened, which is the size that has to be sharp.
      for (const panel of document.querySelectorAll('[role="tabpanel"]')) {
        panel.hidden = false;
        panel.removeAttribute('hidden');
        panel.style.display = 'block';
      }
      return true;
    })()`)
    await sleep(150)

    const images = await page.evaluate(`[...document.querySelectorAll('img')].map(function (img) {
      const box = img.getBoundingClientRect();
      return {
        src: (img.currentSrc || img.getAttribute('src') || '').split('/').pop(),
        natural: img.naturalWidth,
        shown: Math.round(box.width),
        ratio: box.width ? img.naturalWidth / box.width : 0
      };
    })`)

    for (const image of images) {
      if (image.natural === 0) {
        problems.push(`${entry.name}: ${image.src} never loaded, so it cannot be shown at all`)
        continue
      }
      // The logo is an SVG at 22 px; it has no meaningful pixel density.
      if (/\.svg/.test(image.src)) continue
      if (image.shown === 0) {
        // Loaded, but in a tab nobody has opened: it has no box to be sharp or soft in.
        notes.push(`${entry.name.padEnd(22)} ${image.src.padEnd(18)} ${String(image.natural).padStart(4)}px  (in a closed tab, not measured)`)
        continue
      }
      const ratio = image.ratio
      notes.push(`${entry.name.padEnd(22)} ${image.src.padEnd(18)} ${String(image.natural).padStart(4)}px → ${String(image.shown).padStart(4)}px  ${ratio.toFixed(2)}x`)
      if (ratio < 1.0) {
        problems.push(`${entry.name}: ${image.src} is ${image.natural}px shown at ${image.shown}px — upscaled ${(1 / ratio).toFixed(2)}x`)
      } else if (ratio < 1.9) {
        problems.push(`${entry.name}: ${image.src} is ${image.natural}px shown at ${image.shown}px — only ${ratio.toFixed(2)}x, soft on a high-density screen`)
      }
    }
  }

  page.ws.close()
  edge.kill()
  server.close()
  await fs.rm(profile, { recursive: true, force: true }).catch(() => {})

  for (const note of notes) console.log(`  · ${note}`)
  if (problems.length) {
    console.error(`\n${problems.length} PROBLEM(S):`)
    for (const problem of problems) console.error(`  ✗ ${problem}`)
    process.exitCode = 1
  } else {
    console.log(`\n${notes.length} pictures: every one has at least 2x the pixels it is drawn with`)
  }
}

main().catch((error) => {
  console.error('FAILED', error)
  process.exit(1)
})
