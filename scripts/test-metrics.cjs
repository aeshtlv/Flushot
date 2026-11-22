/**
 * Proves the consent gate by watching the network, not by reading the source.
 *
 * `verify-site.cjs` can check that the banner is not in the markup and that only
 * one file names the Metrika host. It cannot check the thing that actually matters:
 * that no request goes to Yandex until the visitor presses "Accept".
 *
 * So this loads the real page in a real browser and records every request the
 * browser makes. Two copies of `site/` are built for it, both with a counter number
 * forced in place of whatever the file currently holds:
 *
 *   `off` — the number is emptied. This must behave as if Metrika did not exist:
 *           no banner, no request, nothing stored.
 *   `on`  — a made-up number is set, never the site's real one. The banner must
 *           appear and *still* nothing may be requested; "Decline" must be
 *           remembered; only "Accept" may load the tag.
 *
 * The fake number is deliberate. If the interception below ever stopped working,
 * the worst case would be a hit against a counter that does not exist, not a fake
 * visit in the statistics of the real site.
 *
 * Requests to the tag host are intercepted and failed on purpose, for the same
 * reason: the point is to observe the attempt without contacting Yandex at all.
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
const TAG_URL = `https://${TAG_HOST}/metrika/tag.js`

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

/** A copy of the site whose metrics.js carries `id`. */
async function copyWithId(root, name, id) {
  const directory = path.join(root, name)
  await fs.cp(SITE, directory, { recursive: true })
  const file = path.join(directory, 'metrics.js')
  const original = await fs.readFile(file, 'utf8')
  const pattern = /var METRIKA_ID = '[^']*';/
  if (!pattern.test(original)) throw new Error('metrics.js no longer has the METRIKA_ID line to replace')
  await fs.writeFile(file, original.replace(pattern, `var METRIKA_ID = '${id}';`), 'utf8')
  return directory
}

async function main() {
  const edgePath = findEdge()
  if (!edgePath) throw new Error('Microsoft Edge is not installed')

  // What the committed file actually configures, checked separately from the two
  // synthetic copies: turning counting off is done by emptying this string, and
  // anything else in it is a typo the tag would silently ignore.
  const committed = await fs.readFile(path.join(SITE, 'metrics.js'), 'utf8')
  const configured = /var METRIKA_ID = '([^']*)';/.exec(committed)
  if (!configured) throw new Error('metrics.js has no METRIKA_ID line to configure')
  const liveId = configured[1]
  const problems = []
  if (liveId !== '' && !/^[0-9]{6,9}$/.test(liveId)) {
    problems.push(`the committed counter number is "${liveId}", which Yandex would never issue`)
  }
  console.log(
    liveId === ''
      ? 'counting is off in the committed file: no third-party request, no cookie, no banner'
      : `counting is on in the committed file, counter ${liveId}`
  )

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flushot-metrics-'))
  const offDirectory = await copyWithId(root, 'off', '')
  const onDirectory = await copyWithId(root, 'on', FAKE_ID)

  const off = await serve(offDirectory)
  const on = await serve(onDirectory)

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

  console.log(`\n[1] number emptied, as if counting were off — ${off.port}`)
  await reset(`http://127.0.0.1:${off.port}/`)
  let current = await state()
  record('no banner', current.banner, false)
  record('nothing stored', current.consent, null)
  record('counter id is empty', current.id, '')
  record('no request to the tag host', tagRequests().length, 0)

  console.log(`\n[2] number set, first visit — ${on.port}`)
  await reset(`http://127.0.0.1:${on.port}/`)
  current = await state()
  record('the banner asks', current.banner, true)
  record('the counter is configured', current.id, FAKE_ID)
  record('still nothing requested before a click', tagRequests().length, 0)
  record('nothing stored before an answer', current.consent, null)
  record('no Metrika global exists yet', await evaluate('typeof window.ym'), 'undefined')

  // The banner is the only thing a visitor sees before deciding, so it has to be
  // readable and clickable rather than merely present.
  const layout = await evaluate(`(() => {
    const banner = document.querySelector('[data-consent="banner"]');
    const box = banner.getBoundingClientRect();
    const buttons = [...banner.querySelectorAll('button')].map((button) => {
      const r = button.getBoundingClientRect();
      return { text: button.textContent.trim().slice(0, 20), w: Math.round(r.width), h: Math.round(r.height), inView: r.top >= 0 && r.bottom <= innerHeight };
    });
    return {
      inside: box.top >= 0 && box.left >= 0 && box.bottom <= innerHeight && box.right <= innerWidth,
      w: Math.round(box.width),
      h: Math.round(box.height),
      buttons,
      pageScrollsSideways: document.documentElement.scrollWidth > innerWidth + 1
    };
  })()`)
  record('the banner fits on screen', layout.inside, true)
  record('it does not widen the page', layout.pageScrollsSideways, false)
  record('it offers exactly two answers', layout.buttons.length, 2)
  record(
    'both answers are comfortably clickable',
    layout.buttons.every((button) => button.h >= 28 && button.w >= 60 && button.inView),
    true
  )

  console.log('  ... visitor presses Decline')
  await evaluate(`document.querySelector('[data-consent-decline]').click()`)
  await sleep(400)
  current = await state()
  record('the banner closes', current.banner, false)
  record('the refusal is remembered', current.consent, 'no')
  record('the tag was not loaded', current.loaded, false)
  record('no request to the tag host', tagRequests().length, 0)

  console.log('  ... next visit')
  await reset(`http://127.0.0.1:${on.port}/`)
  current = await state()
  record('it does not ask again', current.banner, false)
  record('and still requests nothing', tagRequests().length, 0)

  console.log('  ... visitor clears the answer and presses Accept')
  await evaluate(`localStorage.removeItem('flushot-analytics')`)
  await reset(`http://127.0.0.1:${on.port}/`)
  await evaluate(`document.querySelector('[data-consent-accept]').click()`)
  await sleep(700)
  current = await state()
  record('the answer is remembered', current.consent, 'yes')
  record('the tag is requested only after the click', tagRequests().length > 0, true)
  record('and it is the configured counter\u2019s script', tagRequests()[0] || '', TAG_URL)
  // tag.js reads `window.ym` and drains `ym.a`; it never defines `ym` itself. A page
  // that loads the tag first and calls `ym` on its load event therefore never
  // initialises the counter, with no error anywhere. This is the assertion that
  // catches that, and it holds even though the tag cannot load in this test.
  record('a queue stub exists for the tag to drain', await evaluate('typeof window.ym'), 'function')
  const queued = await evaluate(
    'window.ym && Array.isArray(window.ym.a) ? window.ym.a.map(function (entry) { return [entry[0], entry[1]] }) : null'
  )
  // The id goes in as a number, the way the official snippet passes it.
  record('the init call is queued', queued, [[Number(FAKE_ID), 'init']])

  console.log('  ... next visit')
  await reset(`http://127.0.0.1:${on.port}/`)
  current = await state()
  record('no banner when the answer is stored', current.banner, false)
  record('the tag loads on its own', tagRequests().length > 0, true)

  console.log('\n[3] the policy page admits it counts and lets you change your mind')
  await reset(`http://127.0.0.1:${on.port}/privacy.html`)
  requests.length = 0
  const policy = await evaluate(`(() => ({
    counter: /\u042f\u043d\u0434\u0435\u043a\u0441\\.\u041c\u0435\u0442\u0440\u0438\u043a\u0430/.test(document.body.textContent),
    reset: Boolean(document.querySelector('[data-consent-reset]'))
  }))()`)
  record('the policy names Metrika', policy.counter, true)
  record('and offers a way to withdraw', policy.reset, true)

  ws.close()
  edge.kill()
  off.server.close()
  on.server.close()
  await fs.rm(root, { recursive: true, force: true }).catch(() => {})
  await fs.rm(profile, { recursive: true, force: true }).catch(() => {})

  if (problems.length > 0) {
    console.error(`\n${problems.length} problem(s):`)
    for (const problem of problems) console.error(`  \u2717 ${problem}`)
    process.exit(1)
  }
  console.log('\nThe counter never runs without an explicit "Accept".')
}

main().catch((error) => {
  console.error('FAILED', error)
  process.exit(1)
})
