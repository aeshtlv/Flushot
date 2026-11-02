/**
 * What the first screen actually shows, block by block.
 *
 * The hero carries the whole first impression, and "is the product visible when
 * the page opens" is not something a screenshot answers — the browser window is a
 * different height on every machine. This prints where each hero block starts and
 * ends relative to the fold at the sizes people really open the page at.
 *
 * The numbers are the reason `styles.css` reorders the hero when the viewport is
 * shorter than 721 px: at 1366 × 625 the screenshot of the program started below
 * the fold entirely, and on the page it is the only real proof that this is a
 * finished desktop application rather than a screenshot tool announcement.
 *
 * Usage: node scripts/measure-fold.cjs
 */

const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { pathToFileURL } = require('node:url')

const ROOT = path.join(__dirname, '..')
const CDP_PORT = 9511
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const VIEWPORTS = [
  { name: '1440×900', width: 1440, height: 900 },
  { name: '1180×800', width: 1180, height: 800 },
  { name: '1366×625 с панелями', width: 1366, height: 625 },
  { name: '820×1100', width: 820, height: 1100 },
  { name: '390×844', width: 390, height: 844 }
]

// Extra sizes from the command line, for checking a specific window:
//   node scripts/measure-fold.cjs 1280x700 1440x760
for (const argument of process.argv.slice(2)) {
  const match = /^(\d+)x(\d+)$/.exec(argument)
  if (!match) {
    console.error(`не понимаю размер «${argument}» — нужен вид 1280x700`)
    process.exit(1)
  }
  const [, width, height] = match
  VIEWPORTS.push({ name: `${width}×${height}`, width: Number(width), height: Number(height), extra: true })
}

const PROBE = `(() => {
  const at = (selector) => {
    const element = document.querySelector(selector)
    if (!element) return null
    const rect = element.getBoundingClientRect()
    return { top: Math.round(rect.top + window.scrollY), bottom: Math.round(rect.bottom + window.scrollY) }
  }
  return {
    fold: window.innerHeight,
    header: at('header'),
    eyebrow: at('.hero .eyebrow'),
    title: at('.hero__title'),
    sub: at('.hero__sub'),
    actions: at('.hero__actions'),
    note: at('.hero__note'),
    preview: at('.hero__preview'),
    features: at('.feature-grid')
  }
})()`

async function main() {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'flushot-fold-'))
  const edge = spawn(
    path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    [
      '--headless=new',
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--hide-scrollbars',
      'about:blank'
    ],
    { stdio: 'ignore' }
  )

  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).ok) break
    } catch {
      /* not up yet */
    }
    await sleep(120)
  }

  const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()
  const ws = new WebSocket(targets.find((entry) => entry.type === 'page').webSocketDebuggerUrl)
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
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
    return result.result.value
  }

  await send('Page.enable')
  await send('Runtime.enable')
  const url = pathToFileURL(path.join(ROOT, 'site', 'index.html')).href
  const problems = []

  try {
    for (const viewport of VIEWPORTS) {
      await send('Emulation.setDeviceMetricsOverride', {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
        mobile: viewport.width < 500
      })
      await send('Page.navigate', { url })
      await sleep(900)
      await evaluate('document.fonts.ready.then(() => true)')
      await sleep(250)
      const m = await evaluate(PROBE)
      const fold = m.fold
      const visibleShare = (block) => {
        if (!block) return 0
        const visible = Math.max(0, Math.min(fold, block.bottom) - Math.max(0, block.top))
        return visible / (block.bottom - block.top)
      }
      const row = (label, block) => {
        if (!block) return ''
        const share = Math.round(visibleShare(block) * 100)
        const mark = share === 100 ? 'целиком' : share === 0 ? 'не видно' : share + '%'
        return `  ${label.padEnd(20)} ${String(block.top).padStart(5)} … ${String(block.bottom).padStart(5)}   ${mark}`
      }
      console.log(`\n${viewport.name} — сгиб ${fold}px, высота шапки ${m.header.bottom - m.header.top}px`)
      for (const [label, block] of [
        ['надзаголовок', m.eyebrow],
        ['заголовок', m.title],
        ['подзаголовок', m.sub],
        ['кнопки', m.actions],
        ['строка под кнопками', m.note],
        ['снимок программы', m.preview],
        ['возможности', m.features]
      ]) {
        console.log(row(label, block))
      }

      // Two things have to survive every window height. The headline has to be
      // readable in full — it is the sentence that says what the program is, and
      // half a sentence is worse than a smaller one. And enough of the program
      // screenshot has to be on screen to be recognisable as a desktop window;
      // below about a fifth of its height it reads as a decorative band.
      for (const [label, block, need] of [
        ['заголовок', m.title, 1],
        ['кнопки', m.actions, 1],
        ['снимок программы', m.preview, 0.15]
      ]) {
        const share = visibleShare(block)
        if (block && share < need) {
          problems.push(
            `${viewport.name}: ${label} виден на ${Math.round(share * 100)}%, нужно не меньше ${Math.round(need * 100)}%`
          )
        }
      }
    }
  } finally {
    ws.close()
    edge.kill()
    await fs.rm(profile, { recursive: true, force: true }).catch(() => {})
  }

  if (problems.length > 0) {
    console.error(`\n${problems.length} ПРОБЛЕМ(Ы):`)
    for (const problem of problems) console.error(`  ✗ ${problem}`)
    process.exitCode = 1
    return
  }
  console.log('\nПервый экран помещается: заголовок целиком, кнопки и снимок программы видны.')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
