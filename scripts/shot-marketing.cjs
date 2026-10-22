/**
 * Regenerates `site/screenshots/` from the live page.
 *
 * These are the pictures used in the SMM posts and the README, so they have to
 * be taken from the shipped page rather than mocked up. Each one is captured
 * over CDP with a fixed viewport, which keeps them byte-stable between runs
 * apart from genuine design changes.
 *
 * Usage: node scripts/shot-marketing.cjs
 */

const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { pathToFileURL } = require('node:url')

const PORT = 9440
const OUT = path.join(__dirname, '..', 'site', 'screenshots')
const PAGE = pathToFileURL(path.join(__dirname, '..', 'site', 'index.html')).href

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function connect() {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'flushot-shot-'))
  const edge = spawn(
    path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--hide-scrollbars',
      '--force-device-scale-factor=2',
      'about:blank'
    ],
    { stdio: 'ignore' }
  )

  for (let attempt = 0; attempt < 150; attempt += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break
    } catch {
      /* not up yet */
    }
    await sleep(120)
  }

  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
  const target = targets.find((entry) => entry.type === 'page')
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })

  let nextId = 1
  const pending = new Map()
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const waiter = pending.get(message.id)
    if (!waiter) return
    pending.delete(message.id)
    if (message.error) waiter.reject(new Error(message.error.message))
    else waiter.resolve(message.result)
  })

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId
      nextId += 1
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })

  const close = async () => {
    ws.close()
    edge.kill()
    await fs.rm(profile, { recursive: true, force: true }).catch(() => {})
  }

  await send('Page.enable')
  await send('Runtime.enable')
  return { send, close }
}

async function shoot(send, { width, height, theme, file, clip }) {
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 2,
    mobile: width < 500
  })
  await send('Page.navigate', { url: PAGE })
  await sleep(900)

  await send('Runtime.evaluate', {
    expression: `(async () => {
      await document.fonts.ready
      if (document.documentElement.dataset.theme !== '${theme}') {
        document.querySelector('[data-theme-toggle]').click()
      }
      // Reveal-on-scroll must not leave a screenshot half-faded.
      document.querySelectorAll('[data-rise]').forEach((el) => { el.style.opacity = '1'; el.style.transform = 'none' })
    })()`,
    awaitPromise: true
  })
  await sleep(500)

  const params = { format: 'png', captureBeyondViewport: true }
  if (clip) {
    const box = await send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const el = document.querySelector(${JSON.stringify(clip)})
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { x: 0, y: Math.round(r.top + scrollY), width: ${width}, height: Math.round(r.height) }
      })()`
    })
    if (!box.result.value) throw new Error(`cannot find ${clip}`)
    params.clip = { ...box.result.value, scale: 1 }
  } else {
    params.clip = { x: 0, y: 0, width, height, scale: 1 }
  }

  const shot = await send('Page.captureScreenshot', params)
  const buffer = Buffer.from(shot.data, 'base64')
  await fs.writeFile(path.join(OUT, file), buffer)
  console.log(`${file.padEnd(32)} ${width}×${params.clip.height}  ${(buffer.length / 1024).toFixed(0)} KB`)
}

async function main() {
  await fs.mkdir(OUT, { recursive: true })
  const { send, close } = await connect()
  try {
    await shoot(send, { width: 1440, height: 900, theme: 'dark', file: 'страница-десктоп-тёмная.png' })
    await shoot(send, { width: 1440, height: 900, theme: 'light', file: 'страница-десктоп.png' })
    await shoot(send, { width: 390, height: 844, theme: 'dark', file: 'страница-телефон.png' })
    await shoot(send, { width: 1440, height: 900, theme: 'dark', file: 'раздел-возможности.png', clip: '#features' })
    await shoot(send, { width: 1440, height: 900, theme: 'dark', file: 'раздел-клавиши.png', clip: '#hotkeys' })
    await shoot(send, { width: 1440, height: 900, theme: 'dark', file: 'раздел-скачать.png', clip: '#download' })
    await shoot(send, { width: 1440, height: 900, theme: 'light', file: 'вкладка-настройки.png', clip: '#screens' })
  } finally {
    await close()
  }
}

main().catch((error) => {
  console.error('FAILED', error)
  process.exit(1)
})
