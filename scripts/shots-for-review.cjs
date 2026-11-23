/**
 * Full-page screenshots of the three search pages, for review.
 *
 * The audit scripts capture the viewport, which is the right thing for measuring the first screen.
 * Reviewing a page is different: the whole document has to be visible, or the reader has to scroll
 * a picture. This captures the full height instead.
 *
 * Usage: node scripts/shots-for-review.cjs
 */

const path = require('node:path')
const fs = require('node:fs/promises')
const fsSync = require('node:fs')
const os = require('node:os')
const http = require('node:http')
const { spawn } = require('node:child_process')

const ROOT = path.join(__dirname, '..')
const SITE = path.join(ROOT, 'site')
const OUT = path.join(ROOT, '.tmp', 'seo-review')
const PORT = 9431
const BROWSER_PORT = 9433

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
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'flushot-review-'))
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
  await fs.mkdir(OUT, { recursive: true })

  const shots = []
  for (const entry of PAGES) {
    for (const [lang, width, height, label] of [
      ['ru', 1440, 900, 'desktop'],
      ['ru', 390, 844, 'phone'],
      ['en', 1440, 900, 'desktop']
    ]) {
      await page.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: width <= 560
      })
      const url = lang === 'en' ? `http://127.0.0.1:${PORT}/en/${entry.slug}/` : `http://127.0.0.1:${PORT}/${entry.slug}/`
      await page.send('Page.navigate', { url })
      await sleep(900)

      // Walk the page so every lazy picture is loaded before the full-height capture, otherwise the
      // lower half of the picture is empty by construction.
      await page.evaluate(`(async function () {
        const step = window.innerHeight * 0.8;
        for (let y = 0; y < document.body.scrollHeight; y += step) {
          window.scrollTo(0, y);
          await new Promise(function (r) { setTimeout(r, 70); });
        }
        window.scrollTo(0, 0);
        await new Promise(function (r) { setTimeout(r, 500); });
        return true;
      })()`)
      // The reveal animation starts after a delay and would leave blocks invisible in the capture.
      await page.evaluate(`(function () {
        const style = document.createElement('style');
        style.textContent = '*, *::before, *::after { animation: none !important; transition: none !important; }' +
          '.reveal, [data-rise] { opacity: 1 !important; transform: none !important; }';
        document.head.appendChild(style);
        document.querySelectorAll('.reveal').forEach(function (n) { n.classList.add('is-in'); });
        return true;
      })()`)
      await sleep(400)

      const dimensions = await page.evaluate(`({ width: document.documentElement.scrollWidth, height: document.body.scrollHeight })`)
      const shot = await page.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: dimensions.width, height: dimensions.height, scale: 1 }
      })
      const name = `${entry.slug}-${lang}-${label}.png`
      await fs.writeFile(path.join(OUT, name), Buffer.from(shot.data, 'base64'))
      shots.push(`${name}  ${dimensions.width}×${dimensions.height}`)
    }
  }

  page.ws.close()
  edge.kill()
  server.close()
  await fs.rm(profile, { recursive: true, force: true }).catch(() => {})

  for (const shot of shots) console.log(`  · ${shot}`)
  console.log(`\n${shots.length} full-page screenshots in .tmp/seo-review/`)
}

main().catch((error) => {
  console.error('FAILED', error)
  process.exit(1)
})
