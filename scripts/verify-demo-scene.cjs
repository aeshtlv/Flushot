/**
 * Measures the demo scene that demo mode draws.
 *
 * The scene is a product artefact: it appears on the landing page, in the README
 * and in the store-style screenshots. Text in SVG does not wrap and does not
 * shrink, so a slightly-too-long label silently runs into the column next to it
 * or off the window. Neither is visible in a unit test, and a model reviewing
 * this cannot look at the picture, so the geometry is measured instead:
 *
 *  - every <text> must stay inside the window it belongs to,
 *  - no two <text> elements may overlap,
 *  - the sidebar labels must not run past the sidebar edge,
 *  - the table columns must not collide.
 *
 * Usage: node scripts/verify-demo-scene.cjs
 */

const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')
const { spawn } = require('node:child_process')
const ts = require('typescript')

const ROOT = path.join(__dirname, '..')
const PORT = 9355

/** Compile the scene module and get the SVG string out of it. */
async function loadScene() {
  const source = await fs.readFile(path.join(ROOT, 'src', 'renderer', 'overlay', 'demoScene.ts'), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flushot-scene-'))
  const file = path.join(tempDir, 'demoScene.cjs')
  await fs.writeFile(file, compiled, 'utf8')
  const module = require(file)
  const svg = module.demoSceneSvg()
  await fs.rm(tempDir, { recursive: true, force: true })
  return svg
}

function findEdge() {
  const candidates = [
    path.join(process.env['ProgramFiles'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  ]
  return candidates.find((c) => require('node:fs').existsSync(c))
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Runs inside the page: measure every text node in rendered coordinates. */
const MEASURE = `(() => {
  const svg = document.querySelector('svg');
  const box = svg.getBoundingClientRect();
  const items = [];
  for (const node of svg.querySelectorAll('text')) {
    const r = node.getBoundingClientRect();
    items.push({
      content: node.textContent.slice(0, 40),
      x: Math.round(r.left - box.left),
      y: Math.round(r.top - box.top),
      w: Math.round(r.width),
      h: Math.round(r.height),
      right: Math.round(r.right - box.left),
      bottom: Math.round(r.bottom - box.top),
      size: parseFloat(getComputedStyle(node).fontSize)
    });
  }
  return { width: Math.round(box.width), height: Math.round(box.height), items };
})()`

async function main() {
  const svg = await loadScene()
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flushot-scene-run-'))
  const svgFile = path.join(tempDir, 'scene.svg')
  await fs.writeFile(svgFile, svg, 'utf8')

  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'flushot-scene-profile-'))
  const edge = spawn(
    findEdge(),
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--hide-scrollbars',
      '--window-size=1400,900',
      'about:blank'
    ],
    { stdio: 'ignore' }
  )

  let ready = false
  for (let i = 0; i < 100; i++) {
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

  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
  const page = targets.find((t) => t.type === 'page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })

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

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Page.navigate', { url: `file:///${svgFile.replace(/\\/g, '/')}` })
  await sleep(700)

  const result = await send('Runtime.evaluate', { expression: MEASURE, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description)
  const { width, height, items } = result.result.value

  const problems = []

  if (width !== 1280 || height !== 720) {
    problems.push(`scene is ${width}×${height}, expected 1280×720`)
  }

  // The window inside the scene, matching demoScene.ts.
  const windowBox = { left: 80, top: 44, right: 1200, bottom: 676 }
  const sidebarRight = 80 + 232

  for (const item of items) {
    if (item.x < windowBox.left || item.right > windowBox.right) {
      problems.push(`"${item.content}" is outside the window horizontally (${item.x}..${item.right})`)
    }
    if (item.y < windowBox.top || item.bottom > windowBox.bottom) {
      problems.push(`"${item.content}" is outside the window vertically (${item.y}..${item.bottom})`)
    }
  }

  // Sidebar labels must not cross into the content column.
  const sidebarLabels = items.filter((i) => i.x < sidebarRight && i.x > windowBox.left && i.y > 88 && i.y < 560)
  for (const item of sidebarLabels) {
    if (item.right > sidebarRight - 8) {
      problems.push(`sidebar label "${item.content}" runs into the content column (ends at ${item.right})`)
    }
  }

  // No two text elements may overlap. Text that merely sits on the same baseline
  // in different columns is fine, so overlap means both axes intersect.
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i]
      const b = items[j]
      const overlapX = Math.min(a.right, b.right) - Math.max(a.x, b.x)
      const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y)
      if (overlapX > 2 && overlapY > 2) {
        problems.push(`"${a.content}" overlaps "${b.content}" by ${overlapX}×${overlapY}px`)
      }
    }
  }

  // Table columns: the plan/fact/delta numbers must not touch each other.
  const numbers = items.filter((i) => /^[+−]?\d/.test(i.content) && i.y > 340 && i.y < 560)
  for (let i = 1; i < numbers.length; i++) {
    const previous = numbers[i - 1]
    const current = numbers[i]
    if (Math.abs(previous.y - current.y) < 6 && current.x < previous.right + 4) {
      problems.push(`table cells "${previous.content}" and "${current.content}" are too close`)
    }
  }

  console.log(`Scene: ${width}×${height}, ${items.length} text elements measured`)

  // A short inventory helps spot a scene that silently lost its content.
  const groups = {
    sidebar: items.filter((i) => i.x < sidebarRight).length,
    heading: items.filter((i) => i.size >= 20).length,
    body: items.filter((i) => i.size >= 12 && i.size < 20).length,
    small: items.filter((i) => i.size < 12).length
  }
  console.log(`Elements by area: sidebar ${groups.sidebar}, headings ${groups.heading}, body ${groups.body}, small ${groups.small}`)

  const biggest = items.reduce((max, item) => Math.max(max, item.right), 0)
  console.log(`Rightmost text edge: ${biggest}px (window ends at ${windowBox.right})`)

  ws.close()
  edge.kill()
  await fs.rm(profile, { recursive: true, force: true }).catch(() => {})
  await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})

  if (problems.length > 0) {
    console.error(`\n${problems.length} PROBLEM(S):`)
    for (const problem of problems) console.error(`  ✗ ${problem}`)
    process.exitCode = 1
  } else {
    console.log('\nDemo scene geometry is clean.')
  }
}

main().catch((error) => {
  console.error('FAILED', error)
  process.exit(1)
})
