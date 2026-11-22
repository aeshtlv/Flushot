/**
 * Proves the consent gate by watching the network, not by reading the source.
 *
 * `verify-site.cjs` can check that the banner is not in the markup and that only
 * one file names the Metrika host. It cannot check the thing that actually matters:
 * that no request goes to Yandex until the visitor presses "Accept".
 *
 * So this loads the real page in a real browser three times and records every
 * request the browser makes:
 *
 *   1. As shipped, with no counter configured — the page must behave as if
 *      Metrika did not exist: no banner, no request, nothing stored.
 *   2. Configured, first visit — the banner appears and *still* nothing is
 *      requested; "Decline" is remembered and the next visit does not ask again.
 *   3. Configured, "Accept" — only then is the tag requested, and the answer is
 *      remembered, so the next visit loads it without asking.
 *
 * The request is intercepted and failed on purpose: the point is to observe the
 * attempt without ever contacting Yandex, so running this test cannot create a
 * visit in someone's statistics.
 *
 * Usage: node scripts/test-metrics.cjs
 */

const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')
const http = require('node:http')
const { spawn } = require('node:child_process')

const ROOT = path.join(__dirname, '..')
const SITE = path.join(ROOT, 'site')
const PORT = 9387
const FAKE_ID = '12345678'
const TAG_HOST = 'mc.yandex.ru'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function findEdge() {
  const candidates = [
    path.join(process.env['ProgramFiles'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  ]
  return candidates.find((candidate) => require('node:fs').existsSync(candidate))
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8'
}

/** A static server over a directory, so the page runs over http and not file://. */
function serve(directory) {
  return new Promise((resolve) => {
    const server = http.createServer(async (request, response) => {
      const url = decodeURIComponent((request.url || '/').split('?')[0])
      const file = path.join(directory, url === '/' ? 'index.html' : url)
      try {
        const body = await fs.readFile(file)
        response.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' })
        response.end(body)
      } catch {
        response.writeHead(404, { 'content-type': 'text/plain' })
        response.end('not found')
      }
    })
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}

async function main() {
  const edgePath = findEdge()
  if (!edgePath) throw new Error('Microsoft Edge is not installed')

  // Two copies of the site: one exactly as committed, one with a counter number.
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flushot-metrics-'))
  const shipped = path.join(root, 'shipped')
  const configured = path.join(root, 'configured')
  await fs.cp(SITE, shipped, { recursive: true })
  await fs.cp(SITE, configured, { recursive: true })

  const metricsPath = path.join(configured, 'metrics.js')
  const original = await fs.readFile(metricsPath, 'utf8')
  const patched = original.replace("var METRIKA_ID = '';", `var METRIKA_ID = '${FAKE_ID}';`)
  if (patched === original) throw new Error('metrics.js no longer has the METRIKA_ID line to replace')
  await fs.writeFile(metricsPath, patched, 'utf8')

  const asShipped = await serve(shipped)
  const withCounter = await serve(configured)

  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'flushot-metrics-profile-'))
  const edge = spawn(
    edgePath,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--disable-extensions',
      '--window-size=1280,900',
      'about:blank'
    ],
    { stdio: 'ignore' }
  )

  let ready = false
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) {
        ready = true
        break
      }
    } catch {
      /* not up yet */
    }
    await sleep(120)
  }
  if (!ready) throw new Error('Edge did not start')

  const target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page')
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })

  let id = 1
  const pending = new Map()
  const requests = []

  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)

    if (message.method === 'Network.requestWillBeSent') {
      requests.push(message.params.request.url)
      return
    }
    // Every request to the tag host is failed here, so the test observes the
    // attempt without ever reaching Yandex.
    if (message.method === 'Fetch.requestPaused') {
      ws.send(
        JSON.stringify({
          id: id++,
          method: 'Fetch.failRequest',
          params: { requestId: message.params.requestId, errorReason: 'Aborted' }
        })
      )
      return
    }
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

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Network.enable')
  await send('Fetch.enable', { patterns: [{ urlPattern: `*${TAG_HOST}*` }] })

  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || 'eval failed')
    return result.result.value
  }

  const problems = []
  const record = (label, actual, expected) => {
    const pass = JSON.stringify(actual) === JSON.stringify(expected)
    console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}: ${JSON.stringify(actual)}`)
    if (!pass) problems.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }

  const tagRequests = () => requests.filter((url) => url.includes(TAG_HOST))
  const reset = async (url) => {
    requests.length = 0
    await send('Page.navigate', { url: 'about:blank' })
    await sleep(120)
    await send('Page.navigate', { url })
    await sleep(900)
  }
  /** The state of the page as a visitor would find it. */
  const state = () =>
    evaluate(`(() => {
      const banner = document.querySelector('[data-consent="banner"]');
      return {
        banner: Boolean(banner),
        consent: (function () {
          try { return localStorage.getItem('flushot-analytics'); } catch (error) { return 'unavailable'; }
        })(),
        loaded: window.flushotMetrics ? window.flushotMetrics.loaded() : null,
        id: window.flushotMetrics ? window.flushotMetrics.id : null
      };
    })()`)

  console.log(`\n[1] as shipped, no counter configured — ${asShipped.port}`)
  await reset(`http://127.0.0.1:${asShipped.port}/`)
  let current = await state()
  record('no banner', current.banner, false)
  record('nothing stored', current.consent, null)
  record('counter id is empty', current.id, '')
  record('no request to the tag host', tagRequests().length, 0)
  // The gate has to be the reason, not luck: the same page with a number must ask.
  record('the tag host never appears in any request', requests.filter((u) => u.includes(TAG_HOST)).length, 0)

  console.log(`\n[2] configured, first visit — ${withCounter.port}`)
  await reset(`http://127.0.0.1:${withCounter.port}/`)
  current = await state()
  record('the banner asks', current.banner, true)
  record('the counter is configured', current.id, FAKE_ID)
  record('still nothing requested before a click', tagRequests().length, 0)
  record('nothing stored before an answer', current.consent, null)

  console.log('  ... visitor presses Decline')
  await evaluate(`document.querySelector('[data-consent-decline]').click()`)
  await sleep(400)
  current = await state()
  record('the banner closes', current.banner, false)
  record('the refusal is remembered', current.consent, 'no')
  record('the tag was not loaded', current.loaded, false)
  record('no request to the tag host', tagRequests().length, 0)

  console.log('  ... next visit')
  await reset(`http://127.0.0.1:${withCounter.port}/`)
  current = await state()
  record('it does not ask again', current.banner, false)
  record('and still requests nothing', tagRequests().length, 0)

  console.log('  ... visitor clears the answer and presses Accept')
  await evaluate(`localStorage.removeItem('flushot-analytics')`)
  await reset(`http://127.0.0.1:${withCounter.port}/`)
  await evaluate(`document.querySelector('[data-consent-accept]').click()`)
  await sleep(700)
  current = await state()
  record('the answer is remembered', current.consent, 'yes')
  record('the tag is requested only after the click', tagRequests().length > 0, true)
  record('and it is the configured counter\'s script', tagRequests()[0] || '', `https://${TAG_HOST}/metrika/tag.js`)

  console.log('  ... next visit')
  await reset(`http://127.0.0.1:${withCounter.port}/`)
  current = await state()
  record('no banner when the answer is stored', current.banner, false)
  record('the tag loads on its own', tagRequests().length > 0, true)

  console.log('\n[3] the policy page admits it counts')
  await reset(`http://127.0.0.1:${withCounter.port}/privacy.html`)
  requests.length = 0
  const policy = await evaluate(`(() => ({
    counter: /Яндекс\\.Метрика/.test(document.body.textContent),
    reset: Boolean(document.querySelector('[data-consent-reset]'))
  }))()`)
  record('the policy names Metrika', policy.counter, true)
  record('and offers a way to withdraw', policy.reset, true)

  ws.close()
  edge.kill()
  asShipped.server.close()
  withCounter.server.close()
  await fs.rm(root, { recursive: true, force: true }).catch(() => {})
  await fs.rm(profile, { recursive: true, force: true }).catch(() => {})

  if (problems.length > 0) {
    console.error(`\n${problems.length} problem(s):`)
    for (const problem of problems) console.error(`  ✗ ${problem}`)
    process.exit(1)
  }
  console.log('\nThe counter never runs without an explicit "Accept".')
}

main().catch((error) => {
  console.error('FAILED', error)
  process.exit(1)
})
