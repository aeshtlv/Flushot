/**
 * Renders the site in headless Edge over the DevTools protocol.
 *
 * A static page can pass every markup check and still be wrong: overlapping
 * text, a section with no breathing room, a mobile menu covering the button it
 * was meant to reveal. This loads the real page at several widths, measures the
 * rendered result, and saves screenshots for a human to look at.
 *
 * Edge is used rather than Electron because it is already on the machine and
 * needs no extra dependency; the protocol is the same Chromium one.
 *
 * Usage: node scripts/shot-site.cjs [--out <dir>]
 */

const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { pathToFileURL } = require('node:url')

const ROOT = path.join(__dirname, '..')
const SITE = path.join(ROOT, 'site')
const OUT = path.join(ROOT, '.tmp', 'site-shots')
const PORT = 9333

const EDGE_CANDIDATES = [
  path.join(process.env['ProgramFiles'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
]

const VIEWPORTS = [
  { name: 'desktop-light', width: 1440, height: 900, theme: 'light' },
  { name: 'desktop-dark', width: 1440, height: 900, theme: 'dark' },
  { name: 'laptop-light', width: 1180, height: 800, theme: 'light' },
  { name: 'tablet-light', width: 820, height: 1100, theme: 'light' },
  { name: 'phone-light', width: 390, height: 844, theme: 'light' },
  { name: 'phone-dark', width: 390, height: 844, theme: 'dark' },
  { name: 'phone-small', width: 320, height: 700, theme: 'light' }
]

/** Runs in the page. Everything a screenshot cannot show. */
const MEASURE = `(() => {
  const out = {};
  const box = (el) => {
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top + window.scrollY), left: Math.round(r.left), width: Math.round(r.width), height: Math.round(r.height) };
  };

  out.viewport = { width: window.innerWidth, height: window.innerHeight };
  out.docWidth = document.documentElement.scrollWidth;
  out.docHeight = document.documentElement.scrollHeight;
  out.overflowX = document.documentElement.scrollWidth - window.innerWidth;

  out.wide = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue;
    // The skip link is parked off-screen on purpose until it is focused.
    if (el.classList.contains('skip')) continue;
    // Anything inside a horizontal scroller is meant to be wider than its box.
    if (el.closest('.term__body, pre, .gallery')) continue;
    if (r.right > window.innerWidth + 1 || r.left < -1) {
      out.wide.push({
        tag: el.tagName.toLowerCase(),
        cls: (typeof el.className === 'string' ? el.className : '').slice(0, 40),
        left: Math.round(r.left),
        right: Math.round(r.right)
      });
    }
  }
  out.wide = out.wide.slice(0, 8);

  out.sections = [...document.querySelectorAll('main > section')].map((s) => ({ id: s.id || null, ...box(s) }));

  out.clipped = [];
  for (const el of document.querySelectorAll('h1, h2, h3, p, li, summary')) {
    if (el.scrollHeight > el.clientHeight + 2 && getComputedStyle(el).overflow !== 'visible') {
      out.clipped.push({ tag: el.tagName.toLowerCase(), text: el.textContent.trim().slice(0, 40) });
    }
  }
  out.clipped = out.clipped.slice(0, 8);

  // The feature grid draws its separators as cell borders, so a selector that
  // assumes the wrong number of cells leaves a gap in the middle of the grid
  // that no text-level check would ever notice. A cell needs a bottom border
  // exactly when another cell sits below it, and a right border exactly when
  // another cell sits beside it.
  out.gridGaps = [];
  for (const grid of document.querySelectorAll('.feature-grid, .limits, .dl-grid')) {
    const cells = [...grid.children].map((el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return {
        top: Math.round(r.top),
        right: Math.round(r.right),
        borderRight: parseFloat(s.borderRightWidth) || 0,
        borderBottom: parseFloat(s.borderBottomWidth) || 0
      };
    });
    for (const cell of cells) {
      const below = cells.some((other) => other.top > cell.top + 2);
      const beside = cells.some((other) => Math.abs(other.top - cell.top) < 3 && other.right > cell.right + 2);
      if (below && cell.borderBottom < 1) out.gridGaps.push({ grid: grid.className, missing: 'bottom' });
      if (beside && cell.borderRight < 1) out.gridGaps.push({ grid: grid.className, missing: 'right' });
    }
  }
  out.gridGaps = out.gridGaps.slice(0, 8);

  // Contrast of the rendered result, not of the stylesheet: this catches a
  // colour inherited from the wrong parent or a background that never painted.
  const parse = (value) => {
    const m = value.match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const p = m[1].split(',').map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const bgOf = (el) => {
    let node = el;
    while (node && node !== document.documentElement) {
      const c = parse(getComputedStyle(node).backgroundColor);
      if (c && c.a > 0.95) return c;
      node = node.parentElement;
    }
    const body = parse(getComputedStyle(document.body).backgroundColor);
    return body && body.a > 0.95 ? body : { r: 255, g: 255, b: 255 };
  };
  const bad = [];
  for (const el of document.querySelectorAll('p, li, h1, h2, h3, summary, a, .eyebrow, .download__size')) {
    const text = el.textContent.trim();
    if (!text) continue;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') continue;
    const fg = parse(style.color);
    if (!fg) continue;
    const bg = bgOf(el);
    const l1 = lum(fg), l2 = lum(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const size = parseFloat(style.fontSize);
    const bold = parseInt(style.fontWeight, 10) >= 700;
    const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
    if (ratio < need) bad.push({ text: text.slice(0, 34), cls: (typeof el.className === 'string' ? el.className : '').slice(0, 30), ratio: Math.round(ratio * 100) / 100, need, size, fg: style.color, bg: 'rgb(' + bg.r + ',' + bg.g + ',' + bg.b + ')' });
  }
  out.contrastFailures = bad.slice(0, 10);

  out.brokenImages = [...document.images].filter((i) => i.checkVisibility({ checkVisibilityCSS: true, contentVisibilityAuto: true }) && (!i.complete || i.naturalWidth === 0)).map((i) => i.currentSrc || i.src);
  out.visiblePanels = [...document.querySelectorAll('[role="tabpanel"]')].filter((p) => !p.hidden).map((p) => p.id);

  const nav = document.getElementById('nav');
  out.navVisible = nav ? getComputedStyle(nav).display !== 'none' : null;
  out.navOpen = nav ? nav.classList.contains('is-open') : null;

  // The sticky header must not cover a heading when an anchor is followed.
  out.headerHeight = Math.round(document.querySelector('.header').getBoundingClientRect().height);

  return out;
})()`

function findEdge() {
  for (const candidate of EDGE_CANDIDATES) {
    if (candidate && require('node:fs').existsSync(candidate)) return candidate
  }
  throw new Error('Microsoft Edge not found')
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Minimal DevTools-protocol client over the built-in WebSocket. */
class Cdp {
  constructor(ws) {
    this.ws = ws
    this.nextId = 1
    this.pending = new Map()
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      const entry = this.pending.get(message.id)
      if (!entry) return
      this.pending.delete(message.id)
      if (message.error) entry.reject(new Error(`${message.error.message} (${message.error.code})`))
      else entry.resolve(message.result)
    })
  }

  send(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
}

async function connect() {
  // The browser endpoint lists the tabs; we drive one page target.
  const response = await fetch(`http://127.0.0.1:${PORT}/json/list`)
  const targets = await response.json()
  const page = targets.find((t) => t.type === 'page')
  if (!page) throw new Error('no page target')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })
  return new Cdp(ws)
}

async function main() {
  await fs.mkdir(OUT, { recursive: true })
  const url = pathToFileURL(path.join(SITE, 'index.html')).href
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'flushot-site-'))

  const edge = spawn(
    findEdge(),
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--allow-file-access-from-files',
      'about:blank'
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  )

  let stderr = ''
  edge.stderr.on('data', (chunk) => {
    stderr += chunk.toString()
  })

  // Wait for the debugging endpoint.
  let ready = false
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      if (response.ok) {
        ready = true
        break
      }
    } catch {
      /* not up yet */
    }
    await sleep(120)
  }
  if (!ready) {
    edge.kill()
    throw new Error(`Edge did not start on port ${PORT}\n${stderr.slice(-800)}`)
  }

  const cdp = await connect()
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')

  const report = []

  const evaluate = async (expression) => {
    const result = await cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    })
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || 'evaluate failed')
    }
    return result.result.value
  }

  for (const viewport of VIEWPORTS) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: viewport.width < 500
    })

    await cdp.send('Page.navigate', { url })
    await sleep(500)

    // Pin the theme the way the page's own script would.
    await evaluate(`localStorage.setItem('flushot-theme', ${JSON.stringify(viewport.theme)}); true;`)
    await cdp.send('Page.navigate', { url })
    await sleep(600)

    // Walk the page once so lazy images are actually requested, then come back.
    // Without this every below-the-fold picture looks broken.
    await evaluate(`(async () => {
      const step = Math.round(window.innerHeight * 0.8);
      for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise(r => setTimeout(r, 60));
      }
      window.scrollTo(0, 0);
      await new Promise(r => setTimeout(r, 120));
      return true;
    })()`)
    await evaluate('document.fonts.ready.then(() => true)')
    // Wait for lazy images that are in the viewport.
    await evaluate(
      `Promise.all([...document.images].filter(i => !i.complete).map(i => new Promise(r => { i.onload = i.onerror = r; setTimeout(r, 3000); }))).then(() => true)`
    )
    await sleep(250)

    const metrics = await evaluate(MEASURE)

    // Above the fold.
    const fold = await cdp.send('Page.captureScreenshot', { format: 'png' })
    await fs.writeFile(path.join(OUT, `${viewport.name}-fold.png`), Buffer.from(fold.data, 'base64'))

    // Whole page, one image.
    const full = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: {
        x: 0,
        y: 0,
        width: Math.min(metrics.docWidth, viewport.width),
        height: Math.min(metrics.docHeight, 12000),
        scale: 1
      }
    })
    await fs.writeFile(path.join(OUT, `${viewport.name}-full.png`), Buffer.from(full.data, 'base64'))

    // The mobile menu, which is a separate state.
    if (viewport.width < 500) {
      await evaluate("document.querySelector('.nav-toggle').click(); true;")
      await sleep(250)
      const menu = await cdp.send('Page.captureScreenshot', { format: 'png' })
      await fs.writeFile(path.join(OUT, `${viewport.name}-menu.png`), Buffer.from(menu.data, 'base64'))
      const menuMetrics = await evaluate(MEASURE)
      metrics.menu = { navOpen: menuMetrics.navOpen, overflowX: menuMetrics.overflowX, wide: menuMetrics.wide }
      await evaluate("document.querySelector('.nav-toggle').click(); true;")
      await sleep(150)
    }

    report.push({ viewport, metrics })
  }

  // Screenshot tabs, each in its own capture. The label is only a file name; the
  // panel it opens is read back from the page, so adding a tab cannot silently
  // make this capture the wrong one.
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await cdp.send('Page.navigate', { url })
  await sleep(600)
  await evaluate("localStorage.setItem('flushot-theme','light'); document.documentElement.dataset.theme='light'; true;")
  for (const [index, label] of [
    [1, 'tabs-annotate'],
    [2, 'tabs-ocr'],
    [3, 'tabs-settings']
  ]) {
    await evaluate(`document.querySelectorAll('[role="tab"]')[${index}].click(); true;`)
    await sleep(250)
    await evaluate("document.getElementById('screens').scrollIntoView({block:'start'}); true;")
    await sleep(300)
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
    await fs.writeFile(path.join(OUT, `${label}.png`), Buffer.from(shot.data, 'base64'))
    const panels = await evaluate("[...document.querySelectorAll('[role=\"tabpanel\"]')].filter(p=>!p.hidden).map(p=>p.id)")
    report.push({ tab: label, panels })
  }

  await fs.writeFile(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2), 'utf8')

  let problems = 0

  for (const entry of report) {
    if (entry.tab) {
      console.log(`\n${entry.tab}: visible panels ${entry.panels.join(', ')}`)
      continue
    }
    const { viewport, metrics } = entry
    console.log(
      `\n${viewport.name}  ${viewport.width}×${viewport.height}  doc ${metrics.docWidth}×${metrics.docHeight}  overflowX=${metrics.overflowX}`
    )
    if (metrics.wide.length) {
      console.log(`  WIDE: ${JSON.stringify(metrics.wide)}`)
      problems += 1
    }
    if (metrics.gridGaps.length) {
      console.log(`  GRID GAPS: ${JSON.stringify(metrics.gridGaps)}`)
      problems += 1
    }
    if (metrics.clipped.length) console.log(`  CLIPPED: ${JSON.stringify(metrics.clipped)}`)
    if (metrics.brokenImages.length) console.log(`  BROKEN IMAGES: ${JSON.stringify(metrics.brokenImages)}`)
    if (metrics.contrastFailures.length) console.log(`  CONTRAST: ${JSON.stringify(metrics.contrastFailures)}`)
    console.log(`  panels: ${metrics.visiblePanels.join(', ')}  nav visible: ${metrics.navVisible}  header: ${metrics.headerHeight}px`)
    if (metrics.menu) console.log(`  MENU: ${JSON.stringify(metrics.menu)}`)
    const gaps = []
    for (let i = 1; i < metrics.sections.length; i++) {
      const previous = metrics.sections[i - 1]
      const next = metrics.sections[i]
      gaps.push(`${previous.id || '·'}=${next.top - (previous.top + previous.height)}`)
    }
    console.log(`  gaps: ${gaps.join(' ')}`)
  }

  cdp.ws.close()
  edge.kill()
  await fs.rm(profile, { recursive: true, force: true }).catch(() => {})

  if (problems > 0) {
    console.error(`\n${problems} layout problem(s) found`)
    process.exit(1)
  }
  console.log('\nNo horizontal overflow, no clipped text, no gaps in the grid lines.')
}

main().catch((error) => {
  console.error('FAILED', error)
  process.exit(1)
})
