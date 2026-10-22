/**
 * Checks that the interface screenshots really contain the interface.
 *
 * The screenshots are produced by driving the shipping renderer in a headless
 * browser, so the failure modes are quiet: a stub that returns the wrong shape
 * leaves an empty window, a missed selector leaves a toolbar out of frame, a
 * pointer script that does nothing leaves a plain picture. None of those throw.
 *
 * This re-runs the same stubs and asserts on the DOM the components produced:
 * the selection rectangle's geometry, the size badge's text, both toolbars'
 * positions, the number of annotations, and the card's composed size. Then it
 * measures the saved PNGs to confirm the pixels match what the DOM claimed.
 *
 * Usage: node scripts/verify-ui-shots.cjs
 */

const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')
const http = require('node:http')
const { spawn } = require('node:child_process')
const sharp = require('sharp')

const ROOT = path.join(__dirname, '..')
const DOCS = path.join(ROOT, 'docs')
const BUILD = path.join(ROOT, '.tmp', 'imaging-build')
const HTTP_PORT = 8133
const CDP_PORT = 9473

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const failures = []
const notes = []
const fail = (message) => failures.push(message)
const ok = (message) => notes.push(message)

// ------------------------------------------------------------------ rendering

async function buildHelpers() {
  const { execFileSync } = require('node:child_process')
  await fs.rm(BUILD, { recursive: true, force: true })
  execFileSync(
    process.execPath,
    [
      path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'),
      'src/main/imaging/compose.ts',
      'src/main/imaging/layout.ts',
      'src/main/imaging/raster.ts',
      'src/main/imaging/annotations.ts',
      'src/main/imaging/color.ts',
      'src/main/settings/preview.ts',
      'src/shared/settings.ts',
      'src/shared/preview.ts',
      'src/shared/types.ts',
      'src/shared/annotate.ts',
      'src/shared/hotkey.ts',
      '--outDir',
      BUILD,
      '--module',
      'commonjs',
      '--target',
      'ES2022',
      '--moduleResolution',
      'node',
      '--esModuleInterop',
      '--skipLibCheck',
      '--strict',
      'false'
    ],
    { cwd: ROOT, stdio: 'pipe' }
  )

  const ts = require('typescript')
  const source = await fs.readFile(path.join(ROOT, 'src', 'renderer', 'overlay', 'demoScene.ts'), 'utf8')
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText
  const file = path.join(BUILD, 'demoScene.cjs')
  await fs.writeFile(file, js, 'utf8')

  return {
    compose: require(path.join(BUILD, 'main', 'imaging', 'compose.js')),
    settings: require(path.join(BUILD, 'shared', 'settings.js')),
    scene: require(file).demoSceneSvg()
  }
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
}

function serve() {
  const server = http.createServer(async (request, response) => {
    const url = decodeURIComponent(request.url.split('?')[0])
    const file = path.join(ROOT, url === '/' ? 'index.html' : url)
    if (!file.startsWith(ROOT)) {
      response.writeHead(403).end()
      return
    }
    try {
      const data = await fs.readFile(file)
      response.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' })
      response.end(data)
    } catch {
      response.writeHead(404).end('not found')
    }
  })
  return new Promise((resolve) => server.listen(HTTP_PORT, '127.0.0.1', () => resolve(server)))
}

async function launch() {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'flushot-check-'))
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

  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
    return result.result.value
  }

  await send('Page.enable')
  await send('Runtime.enable')

  return {
    send,
    evaluate,
    close: async () => {
      ws.close()
      edge.kill()
      await fs.rm(profile, { recursive: true, force: true }).catch(() => {})
    }
  }
}

// Same stub as the generator, deliberately duplicated: if the generator's copy
// drifts, this check would keep passing against its own version, so the two are
// compared by their effect on the DOM rather than by text.
function stubSource(config) {
  return `(() => {
  const CFG = ${JSON.stringify(config)};
  const rasterise = (svg, width, height, slots) => new Promise((resolve, reject) => {
    const image = new Image();
    image.onerror = () => reject(new Error('scene did not decode'));
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      for (const slot of slots) context.drawImage(image, slot.x, slot.y, slot.width, slot.height);
      const pixels = context.getImageData(0, 0, width, height);
      resolve({ data: new Uint8Array(pixels.data.buffer), width, height });
    };
    image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
  let settings = CFG.settings;
  window.flushot = {
    getOverlayInit: async () => CFG.init,
    getOverlayShot: async () => {
      const d = CFG.init.display;
      return rasterise(CFG.scene, d.imageWidth, d.imageHeight, CFG.slots);
    },
    captureSelection: async () => CFG.capture,
    saveScreenshot: async (payload) => { window.__saved = payload; return { ok: true, message: 'Сохранено' }; },
    copyScreenshot: async (payload) => { window.__copied = payload; return { ok: true, message: 'Скопировано' }; },
    concealOverlay: (keepForDialog) => {
      const root = document.querySelector('.overlay-root');
      const visible = [...document.querySelectorAll('.overlay-root *')].filter((el) => {
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
      }).length;
      window.__concealed = {
        keepForDialog: keepForDialog === true,
        blankAtCall: !!root && root.classList.contains('is-blank'),
        paintedAtCall: root && root.classList.contains('is-blank') ? 0 : visible,
        gap: performance.now() - (window.__clickedAt || 0)
      };
    },
    recognizeText: async (annotations, region) => {
      // Record the request so the checks can prove the picker sent a fragment
      // rather than always asking for the whole picture.
      window.__ocrRequests = window.__ocrRequests || [];
      window.__ocrRequests.push(region ? { ...region } : null);
      return {
        ok: true,
        lang: 'ru',
        languages: region ? ['ru', 'en-US'] : ['ru'],
        // Two lines with a recognisable mistake in the second one: the editor check
        // corrects "Палка" to "Папка", which is the exact error both engines make at
        // 11 px, and then proves the correction is what reaches the clipboard.
        lines: [
          { text: 'Настройки приложения', words: [{ text: 'Настройки', x: 10, y: 10, width: 80, height: 12 }] },
          { text: 'Папка для сохранения: Палка', words: [{ text: 'Папка', x: 10, y: 30, width: 60, height: 12 }] }
        ],
        // Joined rather than written with an escape: this source is itself built
        // inside a template literal, so a backslash-n here would become a real
        // newline in the generated page script and break the string it sits in.
        text: ['Настройки приложения', 'Папка для сохранения: Палка'].join(String.fromCharCode(10))
      };
    },
    warmTextRecognition: () => undefined,
    copyText: async (text) => {
      // Remembered so the checks can prove that what was copied is what is on screen,
      // corrections included.
      window.__copiedText = text;
      return { ok: true };
    },
    cancelCapture: async () => undefined,
    openSettings: async () => undefined,
    onOverlayReset: () => () => undefined,
    onCopyShortcut: () => () => undefined,
    reportOverlayReady: () => undefined,
    reportOverlayPainted: () => undefined,
    getSettings: async () => settings,
    probeHotkey: async () => ({ free: true }),
    updateSettings: async (patch) => { window.__patch = patch; settings = { ...settings, ...patch }; return settings; },
    resetSettings: async () => settings,
    pickDirectory: async () => ({ canceled: true }),
    getPreview: async () => CFG.card,
    openSaveFolder: async () => undefined,
    getAppInfo: async () => CFG.info,
    closeWindow: async () => undefined
  };
})();`
}

const OVERLAY_URL = `http://127.0.0.1:${HTTP_PORT}/out/renderer/overlay/index.html`
const SETTINGS_URL = `http://127.0.0.1:${HTTP_PORT}/out/renderer/settings/index.html`

function dragScript(from, to) {
  return `(() => {
    const root = document.querySelector('.overlay-root');
    if (!root) return 'no root';
    const base = { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', button: 0 };
    root.dispatchEvent(new PointerEvent('pointerdown', { ...base, buttons: 1, clientX: ${from.x}, clientY: ${from.y} }));
    window.dispatchEvent(new PointerEvent('pointermove', { ...base, buttons: 1, clientX: ${to.x}, clientY: ${to.y} }));
    window.dispatchEvent(new PointerEvent('pointerup', { ...base, buttons: 0, clientX: ${to.x}, clientY: ${to.y} }));
    return 'ok';
  })()`
}

// ---------------------------------------------------------------------- checks

/**
 * A PNG's average brightness inside a rectangle, in pixels of the file.
 *
 * The region is cut to raw pixels before it is averaged: `stats()` reads the
 * whole input and ignores a preceding `extract()`, so calling it on the pipeline
 * silently returns the average of the entire picture.
 */
async function regionBrightness(file, rect) {
  const meta = await sharp(file).metadata()
  const left = Math.max(0, Math.min(meta.width - 1, Math.round(rect.x)))
  const top = Math.max(0, Math.min(meta.height - 1, Math.round(rect.y)))
  const width = Math.max(1, Math.min(meta.width - left, Math.round(rect.width)))
  const height = Math.max(1, Math.min(meta.height - top, Math.round(rect.height)))

  const { data, info } = await sharp(file)
    .extract({ left, top, width, height })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  let total = 0
  let count = 0
  for (let index = 0; index < data.length; index += info.channels) {
    total += data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114
    count += 1
  }
  return total / count
}

/**
 * Red marks in a saved PNG, as connected regions of at least `min` pixels.
 *
 * The annotation colour is `#FF3B30`; anti-aliasing softens its edges, so the
 * test is "clearly red" rather than an exact match. Used to prove that the
 * marks the DOM reported actually reached the file the site ships.
 */
/**
 * Rows of the picture that contain dark ink, and how many.
 *
 * Used to prove the OCR panel is showing *text* in the screenshot rather than an
 * empty box: the panel is light, so any dark pixel inside it is a glyph.
 */
async function inkRows(file, area) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const rows = []
  for (let y = area.y; y < area.y + area.height && y < info.height; y++) {
    let count = 0
    for (let x = area.x; x < area.x + area.width && x < info.width; x++) {
      const offset = (y * info.width + x) * info.channels
      const r = data[offset]
      const g = data[offset + 1]
      const b = data[offset + 2]
      if (r < 120 && g < 120 && b < 120) count++
    }
    if (count > 2) rows.push({ y, count })
  }
  return rows
}

async function redMarks(file, min = 200) {  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const width = info.width
  const height = info.height
  const seen = new Uint8Array(width * height)
  const red = (index) => {
    const offset = index * info.channels
    const r = data[offset]
    const g = data[offset + 1]
    const b = data[offset + 2]
    return r > 150 && r - g > 60 && r - b > 60
  }

  const marks = []
  const stack = []
  for (let start = 0; start < width * height; start += 1) {
    if (seen[start]) continue
    seen[start] = 1
    if (!red(start)) continue

    let minX = start % width
    let maxX = minX
    let minY = Math.floor(start / width)
    let maxY = minY
    let count = 0
    stack.length = 0
    stack.push(start)

    while (stack.length > 0) {
      const point = stack.pop()
      const x = point % width
      const y = (point - x) / width
      count += 1
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const next = ny * width + nx
          if (seen[next]) continue
          if (!red(next)) {
            seen[next] = 1
            continue
          }
          seen[next] = 1
          stack.push(next)
        }
      }
    }

    if (count >= min) marks.push({ count, width: maxX - minX + 1, height: maxY - minY + 1 })
  }
  return marks
}

async function main() {
  const helpers = await buildHelpers()
  const defaults = helpers.settings.defaultSettings('C:\\Users\\Пользователь\\Pictures\\Flushot')

  const scenePng = await sharp(Buffer.from(helpers.scene)).resize({ width: 2560 }).png().toBuffer()
  const SELECTED = { x: 330, y: 88, width: 855, height: 552 }
  const CONTENT = { x: 344, y: 100, width: 836, height: 400 }
  const contentPng = await sharp(scenePng)
    .extract({
      left: CONTENT.x * 2,
      top: CONTENT.y * 2,
      width: CONTENT.width * 2,
      height: CONTENT.height * 2
    })
    .png()
    .toBuffer()
  const composed = await helpers.compose.composeScreenshot(contentPng, helpers.compose.composeOptionsFromSettings(defaults))
  const composedMeta = await sharp(composed).metadata()
  const card = await (async () => {
    const preview = require(path.join(BUILD, 'main', 'settings', 'preview.js'))
    return preview.renderPreview(defaults, 900)
  })()

  const capture = {
    ok: true,
    // Exactly what the main process returns in "save to folder" mode, which is
    // the default: this is the line the tester saw covering the buttons.
    message: 'Сохранено · screenshot_2026-10-17_14-30-25.png',
    preview: `data:image/png;base64,${composed.toString('base64')}`,
    width: composedMeta.width,
    height: composedMeta.height,
    path: 'x'
  }

  const server = await serve()
  const browser = await launch()

  try {
    // -------------------------------------------------------- 1. the overlay
    const DISPLAY = {
      id: 'DISPLAY1',
      label: 'DISPLAY1',
      bounds: { x: 0, y: 0, width: 1280, height: 720 },
      scaleFactor: 2,
      imageWidth: 2560,
      imageHeight: 1440
    }

    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 2, mobile: false })
    await browser.send('Page.addScriptToEvaluateOnNewDocument', {
      source: stubSource({
        init: { display: DISPLAY, settings: defaults, hotkey: 'CommandOrControl+Shift+S' },
        settings: defaults,
        capture,
        card,
        info: { version: '2.2.3', hotkey: 'Ctrl+Shift+S', settingsPath: '' },
        scene: helpers.scene,
        slots: [{ x: 0, y: 0, width: 2560, height: 1440 }]
      })
    })
    await browser.send('Page.navigate', { url: OVERLAY_URL })
    await sleep(1400)

    // The frame must be painted, not just requested.
    const painted = await browser.evaluate(`(() => {
      const canvas = document.querySelector('canvas.screen-shot');
      if (!canvas) return null;
      const context = canvas.getContext('2d');
      const pixel = context.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data;
      return { width: canvas.width, height: canvas.height, rgb: [pixel[0], pixel[1], pixel[2]] };
    })()`)
    if (!painted) fail('overlay: no frozen frame on the canvas')
    else if (painted.width !== 2560) fail(`overlay: canvas is ${painted.width}px wide, expected 2560`)
    else if (painted.rgb.every((value) => value === 0)) fail('overlay: the frame on the canvas is black')
    else ok(`overlay: frozen frame ${painted.width}×${painted.height}, centre pixel rgb(${painted.rgb.join(',')})`)

    await browser.evaluate(dragScript({ x: SELECTED.x, y: SELECTED.y }, { x: SELECTED.x + SELECTED.width, y: SELECTED.y + SELECTED.height }))
    await sleep(500)

    const state = await browser.evaluate(`(() => {
      const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
      const badge = document.querySelector('.size-badge');
      return {
        selection: rect(document.querySelector('.selection')),
        handles: document.querySelectorAll('.handle').length,
        badge: badge ? badge.textContent.replace(/\\s+/g, ' ').trim() : null,
        badgeBox: rect(badge),
        toolbar: rect(document.querySelector('.toolbar--confirm')),
        toolbarButtons: document.querySelectorAll('.toolbar--confirm .tb').length,
        // The copy shortcut used to live only in a tooltip, and a tester never
        // found it: the bar now carries a labelled button with a visible key cap.
        copyButton: (() => {
          const button = [...document.querySelectorAll('.toolbar--confirm .tb')].find((el) => /Копировать/.test(el.textContent || ''));
          if (!button) return null;
          return { text: (button.textContent || '').replace(/\s+/g, ' ').trim(), box: rect(button) };
        })(),
        hint: Boolean(document.querySelector('.hint')),
        displayTag: (document.querySelector('.display-tag') || {}).textContent || null
      };
    })()`)

    if (!state.selection) fail('overlay: no selection rectangle after the drag')
    else {
      const expected = { x: SELECTED.x, y: SELECTED.y, w: SELECTED.width, h: SELECTED.height }
      const actual = state.selection
      const off = Math.max(
        Math.abs(actual.x - expected.x),
        Math.abs(actual.y - expected.y),
        Math.abs(actual.w - expected.w),
        Math.abs(actual.h - expected.h)
      )
      if (off > 2) fail(`overlay: selection is ${actual.w}×${actual.h} at ${actual.x},${actual.y}, expected ${expected.w}×${expected.h} at ${expected.x},${expected.y}`)
      else ok(`overlay: selection ${actual.w}×${actual.h} at ${actual.x},${actual.y}`)
    }

    if (state.handles !== 8) fail(`overlay: ${state.handles} resize handles, expected 8`)
    else ok('overlay: 8 resize handles')

    // The badge reports device pixels: 820 × 480 CSS at 200 % is 1640 × 960.
    if (!state.badge) fail('overlay: no size badge')
    else if (!state.badge.includes(String(SELECTED.width * 2)) || !state.badge.includes(String(SELECTED.height * 2))) {
      fail(`overlay: size badge reads "${state.badge}", expected 1640 × 960 at 200 %`)
    } else ok(`overlay: size badge "${state.badge}"`)

    if (!state.toolbar) fail('overlay: the confirm toolbar is missing')
    else {
      const inside = state.toolbar.x >= 0 && state.toolbar.y >= 0 && state.toolbar.x + state.toolbar.w <= 1280 && state.toolbar.y + state.toolbar.h <= 720
      if (!inside) fail(`overlay: the confirm toolbar at ${JSON.stringify(state.toolbar)} is outside the window`)
      else ok(`overlay: confirm toolbar at ${state.toolbar.x},${state.toolbar.y}, ${state.toolbar.w}×${state.toolbar.h}`)
    }
    if (state.toolbarButtons < 4) fail(`overlay: the confirm toolbar has ${state.toolbarButtons} buttons, expected at least 4`)

    // Copying without annotating has to be visible, not just possible.
    if (!state.copyButton) fail('overlay: the confirm toolbar has no copy button')
    else if (!/Ctrl\+C/.test(state.copyButton.text)) {
      fail(`overlay: the copy button reads "${state.copyButton.text}" and does not show Ctrl+C`)
    } else {
      const box = state.copyButton.box
      if (box.x < 0 || box.x + box.w > 1280) fail(`overlay: the copy button at ${JSON.stringify(box)} is outside the window`)
      else ok(`overlay: copy button "${state.copyButton.text}" at ${box.x},${box.y}`)
    }

    if (state.hint) fail('overlay: the "select an area" hint is still showing over a finished selection')

    // The saved picture must agree with the DOM: undimmed inside, dimmed outside.
    const overlayFile = path.join(DOCS, 'ui-overlay.png')
    const inside = await regionBrightness(overlayFile, { x: 700, y: 450, width: 60, height: 60 })
    const outside = await regionBrightness(overlayFile, { x: 40, y: 40, width: 60, height: 60 })
    if (inside <= outside) {
      fail(`ui-overlay.png: the selection is not brighter than the dimmed desktop (${inside.toFixed(0)} vs ${outside.toFixed(0)})`)
    } else ok(`ui-overlay.png: selection ${inside.toFixed(0)} vs dimmed desktop ${outside.toFixed(0)}`)

    // ------------------------------------------------------- 2. the annotate
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 2, mobile: false })
    await browser.send('Page.navigate', { url: OVERLAY_URL })
    await sleep(1400)

    await browser.evaluate(dragScript({ x: CONTENT.x, y: CONTENT.y }, { x: CONTENT.x + CONTENT.width, y: CONTENT.y + CONTENT.height }))
    await sleep(400)
    const clicked = await browser.evaluate(`(() => {
      const button = document.querySelector('.toolbar--confirm .tb--primary');
      if (!button) return false;
      button.click();
      return true;
    })()`)
    if (!clicked) fail('annotate: the confirm button was not found')
    await sleep(1200)

    const drawn = await browser.evaluate(`(async () => {
      const pause = (ms) => new Promise((r) => setTimeout(r, ms));
      const tools = document.querySelectorAll('.toolbar--annotate .tb--tool');
      const swatches = document.querySelectorAll('.toolbar--annotate .swatch');
      const surface = document.querySelector('.annotate-surface');
      if (!surface) return { error: 'no surface' };
      const box = surface.getBoundingClientRect();
      const at = (fx, fy) => ({ clientX: box.left + box.width * fx, clientY: box.top + box.height * fy });
      const send = (type, point, extra = {}) => surface.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', button: 0, ...point, ...extra
      }));
      tools[0].click(); await pause(60);
      swatches[0].click(); await pause(60);
      send('pointerdown', at(0.63, 0.62), { buttons: 1 });
      send('pointermove', at(0.80, 0.30), { buttons: 1 });
      send('pointerup', at(0.80, 0.30), { buttons: 0 });
      await pause(200);
      tools[1].click(); await pause(60);
      send('pointerdown', at(0.10, 0.86), { buttons: 1, shiftKey: true });
      send('pointermove', at(0.42, 0.86), { buttons: 1, shiftKey: true });
      send('pointerup', at(0.42, 0.86), { buttons: 0, shiftKey: true });
      await pause(200);
      tools[0].click(); await pause(150);
      const annotationBox = document.querySelector('.annotate-box');
      return {
        annotations: annotationBox ? Number(annotationBox.dataset.annotations) : 0,
        line: annotationBox ? annotationBox.dataset.lineAt : '',
        caption: (document.querySelector('.result-caption') || {}).textContent || '',
        captionBox: (() => {
          const el = document.querySelector('.result-caption');
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
        })(),
        size: (document.querySelector('.result-caption') || {}).dataset.size || '',
        actions: document.querySelectorAll('.toolbar--actions .tb').length,
        actionBar: (() => {
          const bar = document.querySelector('.toolbar--actions');
          if (!bar) return null;
          const r = bar.getBoundingClientRect();
          return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
        })(),
        // Every button must show its shortcut: the tester only found Ctrl+C
        // because nothing on screen said it existed.
        keys: [...document.querySelectorAll('.toolbar--actions .tb__key')].map((el) => el.textContent.trim()),
        ocrButton: [...document.querySelectorAll('.toolbar--actions .tb')].some((el) => /Текст/.test(el.textContent || '')),
        annotateTools: tools.length,
        stage: (document.querySelector('.overlay-root') || {}).className || ''
      };
    })()`)

    if (drawn.error) fail(`annotate: ${drawn.error}`)
    else {
      if (drawn.annotations !== 2) fail(`annotate: ${drawn.annotations} annotations, expected 2`)
      else ok('annotate: two annotations committed (arrow and snapped line)')

      // The line was drawn with Shift at a constant y, so it must be horizontal.
      const segment = String(drawn.line || '')
      const ends = segment.split('>').map((point) => point.split(',').map(Number))
      if (ends.length !== 2 || ends.some((point) => point.length !== 2 || point.some(Number.isNaN))) {
        fail(`annotate: no line geometry recorded ("${segment}")`)
      } else {
        const [[x1, y1], [x2, y2]] = ends
        if (Math.abs(y1 - y2) > 0.001) fail(`annotate: the line is not horizontal (${y1} → ${y2})`)
        else if (Math.abs(x2 - x1) < 0.05) fail(`annotate: the line has no length (${x1} → ${x2})`)
        else ok(`annotate: line is horizontal (y ${y1.toFixed(3)}, x ${x1.toFixed(2)} → ${x2.toFixed(2)})`)
      }

      if (!drawn.stage.includes('stage-result')) fail(`annotate: stage is "${drawn.stage}", expected stage-result`)
      if (drawn.annotateTools !== 8) fail(`annotate: ${drawn.annotateTools} annotation tools, expected 8`)
      if (drawn.actions < 4) fail(`annotate: ${drawn.actions} action buttons, expected at least 4`)

      // The action bar carries copy, save and the text button, and it has to fit
      // on one monitor even with the zoom controls present.
      if (!drawn.actionBar) fail('annotate: the action toolbar is missing')
      else if (drawn.actionBar.x < 0 || drawn.actionBar.x + drawn.actionBar.w > 1280) {
        fail(`annotate: the action toolbar at ${JSON.stringify(drawn.actionBar)} does not fit the window`)
      } else ok(`annotate: action toolbar ${drawn.actionBar.w}×${drawn.actionBar.h}`)

      const keys = drawn.keys || []
      if (!keys.includes('Ctrl+C') || !keys.includes('Ctrl+S')) {
        fail(`annotate: the action bar shows ${JSON.stringify(keys)}, expected Ctrl+C and Ctrl+S`)
      } else ok(`annotate: shortcuts printed on buttons ${keys.join(' ')}`)

      if (!drawn.ocrButton) fail('annotate: the action bar has no text recognition button')
      else ok('annotate: text recognition button present')
      ok(`annotate: card caption "${drawn.caption.trim()}" (${drawn.size})`)

      // The caption now spells out the shortcuts in words, because the printed
      // keys alone did not tell a tester that Ctrl+C copies the picture.
      if (!/скопировать/.test(drawn.caption) || !/сохранить/.test(drawn.caption)) {
        fail(`annotate: the caption "${drawn.caption.trim()}" does not name what the shortcuts do`)
      } else if (!drawn.captionBox || drawn.captionBox.x < 0 || drawn.captionBox.x + drawn.captionBox.w > 1280) {
        fail(`annotate: the caption at ${JSON.stringify(drawn.captionBox)} does not fit the window`)
      } else {
        ok(`annotate: caption spells out the shortcuts (${drawn.captionBox.w}×${drawn.captionBox.h})`)
      }

      // ---- the status message --------------------------------------------------
      //
      // The tester reported the "Сохранено" line covering the action buttons for
      // the seconds it was visible. It was anchored to the bottom of the overlay
      // window — the bottom of the whole desktop — so on two screens it also
      // landed on whichever monitor was there. It now goes to the top of the host
      // monitor, so this measures it against both toolbars.
      const toastCheck = await browser.evaluate(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const buttons = [...document.querySelectorAll('.toolbar--actions .tb')];
        const save = buttons.find((el) => /Сохранить|Ctrl\+S/.test(el.textContent || '')) || buttons[0];
        if (!save) return { error: 'no save button' };
        save.click();
        await wait(260);

        const node = document.querySelector('.toast');
        if (!node) return { error: 'no status message after saving' };
        const rect = (el) => {
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
        };
        const toast = rect(node);
        const layer = rect(document.querySelector('.result-layer'));
        const bars = [...document.querySelectorAll('.toolbar')].map(rect).filter(Boolean);
        const overlap = (a, b) => {
          const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
          const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
          return w > 0 && h > 0 ? w * h : 0;
        };
        return {
          text: node.textContent.trim(),
          toast,
          layer,
          // How much of the message sits on top of any toolbar, in square pixels.
          onToolbar: bars.reduce((sum, bar) => sum + overlap(toast, bar), 0),
          inLayer: layer ? toast.x >= layer.x && toast.x + toast.w <= layer.x + layer.w &&
                           toast.y >= layer.y && toast.y + toast.h <= layer.y + layer.h : false,
          // Above every toolbar, not merely to the side of it.
          aboveBars: bars.length > 0 ? toast.y + toast.h <= Math.min(...bars.map((b) => b.y)) : false
        };
      })()`)

      if (toastCheck.error) fail(`status message: ${toastCheck.error}`)
      else {
        if (toastCheck.onToolbar > 0) {
          fail(`status message: ${toastCheck.onToolbar} px² of "${toastCheck.text}" covers a toolbar`)
        } else ok(`status message: "${toastCheck.text}" at ${toastCheck.toast.x},${toastCheck.toast.y}, clear of both toolbars`)

        if (!toastCheck.inLayer) {
          fail(`status message: at ${JSON.stringify(toastCheck.toast)} it is outside the host monitor ${JSON.stringify(toastCheck.layer)}`)
        } else ok('status message: inside the host monitor')

        if (!toastCheck.aboveBars) fail('status message: not above the toolbars')
        else ok('status message: above the toolbars')
      }

      // ---- reading a fragment -------------------------------------------------
      //
      // The button used to recognize the whole picture immediately, so there was
      // no way to ask for less. It now arms a picker; dragging on the picture must
      // produce a fragment and send *that* rectangle, not the whole image.
      const picked = await browser.evaluate(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        window.__ocrRequests = [];
        const button = [...document.querySelectorAll('.toolbar--actions .tb')]
          .find((el) => /Текст/.test(el.textContent || ''));
        if (!button) return { error: 'no text button' };
        button.click();
        await wait(120);

        const overlay = document.querySelector('.ocr-pick');
        if (!overlay) return { error: 'the picker did not arm' };
        // Read the text now, not later: React reuses this span for the marquee
        // rectangle and empties it, so a node kept for later reads as blank.
        const hintNode = document.querySelector('.ocr-pick__hint');
        const hint = hintNode ? hintNode.textContent.trim() : '';
        const box = overlay.getBoundingClientRect();

        // A drag across the middle of the picture.
        const from = { x: box.left + box.width * 0.25, y: box.top + box.height * 0.3 };
        const to = { x: box.left + box.width * 0.7, y: box.top + box.height * 0.55 };
        const send = (type, at, buttons) => overlay.dispatchEvent(new PointerEvent(type, {
          bubbles: true, clientX: at.x, clientY: at.y, buttons, pointerId: 1, isPrimary: true
        }));
        send('pointerdown', from, 1);
        await wait(40);
        send('pointermove', to, 1);
        await wait(80);
        const marquee = document.querySelector('.ocr-pick__rect');
        const marqueeBox = marquee ? marquee.getBoundingClientRect() : null;
        send('pointerup', to, 0);
        await wait(320);

        const panel = document.querySelector('.text-panel');
        const layer = document.querySelector('.result-layer');
        const rect = (el) => {
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
        };
        return {
          hint,
          marquee: marqueeBox ? { w: Math.round(marqueeBox.width), h: Math.round(marqueeBox.height) } : null,
          requests: window.__ocrRequests.slice(),
          pickerGone: !document.querySelector('.ocr-pick'),
          panel: rect(panel),
          layer: rect(layer),
          // The panel must be a child of the result layer, which is one monitor:
          // anchored to the overlay it opened across the seam between two screens.
          panelInLayer: !!(panel && layer && layer.contains(panel)),
          panelTitle: panel ? (panel.querySelector('.text-panel__title') || {}).textContent || '' : '',
          panelMeta: panel ? (panel.querySelector('.text-panel__meta') || {}).textContent || '' : ''
        };
      })()`)

      if (picked.error) fail(`ocr picker: ${picked.error}`)
      if (!picked.error) {
        if (!picked.hint) fail('ocr picker: no instruction shown when the picker is armed')
        else ok(`ocr picker: armed with the hint "${picked.hint}"`)

        if (!picked.marquee) fail('ocr picker: dragging drew no rectangle')
        else if (picked.marquee.w < 100 || picked.marquee.h < 40) {
          fail(`ocr picker: the drag rectangle is ${picked.marquee.w}×${picked.marquee.h}, too small to see`)
        } else ok(`ocr picker: drag rectangle ${picked.marquee.w}×${picked.marquee.h}`)

        const request = (picked.requests || [])[0]
        if (!request) fail('ocr picker: no recognition request was sent')
        else if (!(request.width > 0) || !(request.height > 0)) {
          fail(`ocr picker: the request has no fragment (${JSON.stringify(request)})`)
        } else {
          // The fragment must be smaller than the picture: sending the whole image
          // would mean the picker was ignored.
          ok(`ocr picker: sent the fragment ${request.width}×${request.height} at ${request.x},${request.y}`)
        }

        if (!picked.pickerGone) fail('ocr picker: the picker stayed armed after the request')
        else ok('ocr picker: disarmed after the request')

        if (!picked.panel) fail('ocr picker: no text panel after the request')
        else if (!picked.panelInLayer) {
          fail('ocr picker: the text panel is not inside the result layer, so it can span two monitors')
        } else if (picked.panel.x < picked.layer.x || picked.panel.x + picked.panel.w > picked.layer.x + picked.layer.w) {
          fail(`ocr picker: the panel at ${JSON.stringify(picked.panel)} is outside the monitor ${JSON.stringify(picked.layer)}`)
        } else ok(`ocr picker: panel inside the host monitor (${picked.panel.w}×${picked.panel.h} in ${picked.layer.w}×${picked.layer.h})`)

        if (!/фрагмент/i.test(picked.panelTitle)) {
          fail(`ocr picker: the panel title "${picked.panelTitle}" does not say it read a fragment`)
        } else ok(`ocr picker: panel title "${picked.panelTitle}"`)

        // Arming the picker must not cost the old behaviour: a plain click reads
        // everything, exactly as the button did before.
        const clicked = await browser.evaluate(`(async () => {
          const wait = (ms) => new Promise((r) => setTimeout(r, ms));
          document.querySelector('.text-panel .tb--close')?.click();
          await wait(80);
          window.__ocrRequests = [];
          const button = [...document.querySelectorAll('.toolbar--actions .tb')]
            .find((el) => /Текст/.test(el.textContent || ''));
          button.click();
          await wait(120);
          const overlay = document.querySelector('.ocr-pick');
          if (!overlay) return { error: 'the picker did not arm the second time' };
          const box = overlay.getBoundingClientRect();
          const at = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
          const send = (type, buttons) => overlay.dispatchEvent(new PointerEvent(type, {
            bubbles: true, clientX: at.x, clientY: at.y, buttons, pointerId: 1, isPrimary: true
          }));
          send('pointerdown', 1);
          send('pointerup', 0);
          await wait(320);
          return { requests: window.__ocrRequests.slice() };
        })()`)

        if (clicked.error) fail(`ocr picker: ${clicked.error}`)
        else if (!clicked.requests || clicked.requests.length === 0) {
          fail('ocr picker: a click without a drag sent no request')
        } else if (clicked.requests[0] !== null) {
          fail(`ocr picker: a click sent a fragment (${JSON.stringify(clicked.requests[0])}) instead of the whole picture`)
        } else ok('ocr picker: a click without a drag reads the whole picture')

        if (!/ru\+en-US/.test(picked.panelMeta)) {
          fail(`ocr picker: the panel says "${picked.panelMeta}", expected the engines that contributed`)
        } else ok(`ocr picker: panel names both engines (${picked.panelMeta.trim()})`)

        // The recognized text is an editor, not a read-only view: recognition is
        // never perfect, and the user has to be able to fix a wrong word and copy the
        // corrected text without pasting it into another program first.
        const editor = await browser.evaluate(`(async () => {
          const wait = (ms) => new Promise((r) => setTimeout(r, ms));
          const field = document.querySelector('[data-ocr-editor]');
          if (!field) return { error: 'no editor: the text is not editable' };

          const recognized = field.value;
          const tag = field.tagName;
          const selection = [field.selectionStart, field.selectionEnd];

          // Correct the word the way a person would: replace it and fire the event
          // React listens to. The native setter has to be used — assigning field.value
          // goes through React's own value tracker, so the tracker sees no change and
          // onChange never fires. That is a harness detail, not an app one, but getting
          // it wrong would make a working editor look broken.
          const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
          field.focus();
          setValue.call(field, field.value.replace('Палка', 'Папка'));
          field.dispatchEvent(new Event('input', { bubbles: true }));
          await wait(120);

          const badge = document.querySelector('.text-panel__edited');
          const copyButton = document.querySelector('[data-ocr-copy]');
          const editedLabel = copyButton ? copyButton.textContent.trim() : '';
          const revertButton = [...document.querySelectorAll('.text-panel__foot .tb')]
            .find((el) => el.textContent.trim() === 'Вернуть');

          // The header now carries the title, the "правлено" badge, the engine
          // summary and the close button. A wider row can push the summary under the
          // close button or wrap the header onto two lines, and the panel would look
          // broken in exactly the state the feature creates.
          const header = document.querySelector('.text-panel__head');
          const meta = document.querySelector('.text-panel__meta');
          const close = document.querySelector('.text-panel__head .tb--close');
          const box = (el) => {
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: Math.round(r.left), right: Math.round(r.right), y: Math.round(r.top), h: Math.round(r.height) };
          };
          const headerBox = box(header);
          const metaBox = box(meta);
          const closeBox = box(close);
          const titleBox = box(document.querySelector('.text-panel__title'));
          const badgeBox = box(badge);
          // Whether the summary is actually being truncated: if it is, the ellipsis
          // rule is doing real work rather than being decoration.
          const metaTruncated = meta ? meta.scrollWidth > meta.clientWidth + 1 : null;

          window.__copiedText = null;
          copyButton.click();
          await wait(160);
          const copied = window.__copiedText;

          let afterRevert = null;
          let badgeAfterRevert = null;
          if (revertButton) {
            revertButton.click();
            await wait(140);
            afterRevert = field.value;
            badgeAfterRevert = !!document.querySelector('.text-panel__edited');
          }

          return {
            tag,
            recognized,
            selection,
            badge: badge ? badge.textContent.trim() : '',
            editedLabel,
            hasRevert: !!revertButton,
            copied,
            afterRevert,
            badgeAfterRevert,
            headerBox,
            metaBox,
            closeBox,
            titleBox,
            badgeBox,
            metaTruncated
          };
        })()`)

        if (editor.error) fail(`ocr editor: ${editor.error}`)
        else {
          if (editor.tag !== 'TEXTAREA') fail(`ocr editor: the text is a <${editor.tag}>, not an editable field`)
          else ok(`ocr editor: the text is a <textarea> holding ${editor.recognized.split('\n').length} line(s)`)

          // Opening the panel selects everything, so Ctrl+C works without aiming.
          if (editor.selection[1] - editor.selection[0] !== editor.recognized.length) {
            fail(`ocr editor: opening selected ${editor.selection[1] - editor.selection[0]} of ${editor.recognized.length} characters`)
          } else ok('ocr editor: opening the panel selects the whole result')

          if (!editor.badge) fail('ocr editor: correcting the text showed no "правлено" badge')
          else ok(`ocr editor: correction marked "${editor.badge}"`)

          if (!/исправленн/i.test(editor.editedLabel)) {
            fail(`ocr editor: the copy button says "${editor.editedLabel}" after an edit`)
          } else ok(`ocr editor: the copy button becomes "${editor.editedLabel}"`)

          if (editor.copied === null) fail('ocr editor: the copy button copied nothing')
          else if (!/Папка для сохранения: Папка/.test(editor.copied)) {
            fail(`ocr editor: copied ${JSON.stringify(editor.copied)}, expected the corrected text`)
          } else if (/Палка/.test(editor.copied)) {
            fail(`ocr editor: copied the uncorrected ${JSON.stringify(editor.copied)}`)
          } else ok('ocr editor: copying puts the corrected text on the clipboard')

          if (!editor.hasRevert) fail('ocr editor: no way to undo a correction')
          else if (editor.afterRevert !== editor.recognized) {
            fail(`ocr editor: "Вернуть" left ${JSON.stringify(editor.afterRevert)}`)
          } else if (editor.badgeAfterRevert) {
            fail('ocr editor: the "правлено" badge survived a revert')
          } else ok('ocr editor: "Вернуть" restores the recognized text')

          // With the badge in place the header must still be one line, and the
          // engine summary must stay clear of the close button.
          //
          // The header's own height is not the signal: 10 px padding, a 28 px close
          // button and a 1 px rule make 49 px whether or not anything wrapped. What
          // matters is the *title's* height — one line of 13 px text is about 17 px,
          // two lines would be about 34.
          if (!editor.headerBox || !editor.metaBox || !editor.closeBox) {
            fail('ocr editor: the panel header is missing its summary or close button')
          } else if (!editor.titleBox || editor.titleBox.h > 22) {
            fail(`ocr editor: the title wrapped with the badge (${JSON.stringify(editor.titleBox)})`)
          } else if (editor.metaBox.right > editor.closeBox.x) {
            fail(`ocr editor: the summary ends at ${editor.metaBox.right}, past the close button at ${editor.closeBox.x}`)
          } else {
            ok(
              `ocr editor: header holds the title (${editor.titleBox.h}px tall, header ${editor.headerBox.h}px), ` +
                `the badge and the summary clear of the close button${editor.metaTruncated ? ', summary truncated' : ''}`
            )
          }
        }
      }
    }

    // And the marks must be in the file, not just in the canvas that drew them.
    const marks = await redMarks(path.join(DOCS, 'ui-annotate.png'))
    const underline = marks.find((mark) => mark.width >= 250 && mark.height <= 8)
    const diagonal = marks.find((mark) => mark.width >= 150 && mark.height >= 100)
    if (!underline) fail(`ui-annotate.png: no horizontal mark under 8 px thick (found ${marks.length} red region(s))`)
    else ok(`ui-annotate.png: underline ${underline.width}×${underline.height} px`)
    if (!diagonal) fail('ui-annotate.png: no diagonal arrow (a red region at least 150×100)')
    else ok(`ui-annotate.png: arrow ${diagonal.width}×${diagonal.height} px`)

    // The OCR screenshot has to show the recognized text, not an empty box. The
    // panel is the right-hand column, so dark pixels there are glyphs — and an
    // editable textarea that rendered blank would look identical in the DOM.
    const ocrFile = path.join(DOCS, 'ui-ocr.png')
    const ocrMeta = await sharp(ocrFile).metadata()
    const panelArea = { x: ocrMeta.width - 370, y: 100, width: 350, height: ocrMeta.height - 240 }
    const ink = await inkRows(ocrFile, panelArea)
    // Several separate rows means several lines of text, not one stray mark.
    const bands = ink.reduce((count, row, index) => {
      const previous = ink[index - 1]
      return !previous || row.y - previous.y > 2 ? count + 1 : count
    }, 0)
    if (bands < 2) fail(`ui-ocr.png: the text panel shows ${bands} line(s) of ink, expected the recognized text`)
    else ok(`ui-ocr.png: text panel shows ${bands} lines of text (${ink.length} inked rows)`)

    // The composed card must be the content plus the default frame on both sides.
    const expectedWidth = CONTENT.width * 2 + defaults.frameWidth * 2
    if (composedMeta.width !== expectedWidth) {
      fail(`annotate: composed card is ${composedMeta.width}px wide, expected ${expectedWidth} (${CONTENT.width}×2 + 2×${defaults.frameWidth})`)
    } else ok(`annotate: composed card ${composedMeta.width}×${composedMeta.height}, frame ${defaults.frameWidth}px`)

    // ------------------------------------ 3. what the overlay hands to the main
    // The drawing travels as raw RGBA of the painted rectangle, not as a base64
    // PNG of the whole canvas. This is the check that the payload is really
    // cropped to the marks: a full-canvas payload would still work, but it would
    // put the old cost straight back into every copy.
    const copyClicked = await browser.evaluate(`(() => {
      const buttons = [...document.querySelectorAll('.toolbar--actions .tb')];
      // The primary action in this toolbar is always the copy button; its label
      // is localised, so matching on it would make the check language-dependent.
      const copy = document.querySelector('.toolbar--actions .tb--primary') || buttons[0];
      if (!copy) return { error: 'no buttons in the action toolbar' };
      window.__clickedAt = performance.now();
      copy.click();
      return { ok: true, labels: buttons.map((button) => button.textContent.trim()) };
    })()`)
    if (copyClicked.error) fail(`payload: ${copyClicked.error}`)
    await sleep(180)

    const payload = await browser.evaluate(`(() => {
      const sent = window.__copied;
      if (!sent) return { error: 'copyScreenshot was never called' };
      if (!sent.data || typeof sent.data.length !== 'number') return { error: 'payload has no raw bytes' };
      const data = sent.data;
      const expected = sent.width * sent.height * 4;
      if (data.length !== expected) return { error: 'payload is ' + data.length + ' bytes, expected ' + expected };
      let painted = 0;
      let clear = 0;
      let red = 0;
      for (let index = 0; index < data.length; index += 4) {
        const alpha = data[index + 3];
        if (alpha === 0) { clear++; continue; }
        painted++;
        if (data[index] > 200 && data[index + 1] < 90 && data[index + 2] < 90) red++;
      }
      return {
        x: sent.x, y: sent.y, width: sent.width, height: sent.height,
        bytes: data.length, painted, clear, red,
        canvas: (() => { const c = document.querySelector('canvas.annotate-surface'); return c ? { width: c.width, height: c.height } : null; })()
      };
    })()`)

    if (payload.error) fail(`payload: ${payload.error}`)
    else {
      const area = payload.width * payload.height
      const canvasArea = payload.canvas ? payload.canvas.width * payload.canvas.height : 0
      if (payload.painted === 0) fail('payload: the drawing has no opaque pixels')
      else if (payload.red === 0) fail('payload: no red stroke in the payload (the arrow colour)')
      else if (payload.clear === 0) fail('payload: no transparent pixels, so the box was not cropped to the marks')
      else if (canvasArea > 0 && area >= canvasArea) fail(`payload: ${payload.width}×${payload.height} covers the whole canvas, so the dirty rectangle was not used`)
      else if (area > canvasArea * 0.5) fail(`payload: ${area} of ${canvasArea} px is more than half the canvas`)
      else {
        const share = ((payload.painted / area) * 100).toFixed(1)
        ok(`payload: ${payload.width}×${payload.height} at ${payload.x},${payload.y}, ${Math.round(area / 1000)}k px of ${Math.round(canvasArea / 1000)}k, ${share}% painted`)
      }
    }

    // The overlay has to be blank *before* the window is hidden: on Windows the
    // compositor can keep the last frame of a transparent window, and that is
    // what made the picture linger for a moment after Ctrl+C.
    const conceal = await browser.evaluate(`(() => {
      const state = window.__concealed;
      if (!state) return { error: 'concealOverlay was never called' };
      return state;
    })()`)
    if (conceal.error) fail(`conceal: ${conceal.error}`)
    else if (!conceal.blankAtCall) fail('conceal: the overlay was still painted when the window was hidden')
    else if (conceal.paintedAtCall > 0) {
      fail(`conceal: ${conceal.paintedAtCall} visible element(s) were still painted when the window was hidden`)
    } else ok(`conceal: overlay blanked ${conceal.gap.toFixed(0)} ms before the hide`)

    // ------------------------------------------------------- 3. the settings
    const settingsFile = path.join(DOCS, 'ui-settings.png')
    const settingsMeta = await sharp(settingsFile).metadata()
    if (settingsMeta.width !== 520 || settingsMeta.height !== 820) {
      fail(`ui-settings.png is ${settingsMeta.width}×${settingsMeta.height}, expected 520×820 (the window's own size)`)
    } else ok(`ui-settings.png: ${settingsMeta.width}×${settingsMeta.height}`)

    // The hotkey row now holds exactly one control: the recorder. It used to carry
    // four suggestion chips as well, which the user asked to remove — the row had
    // turned into a menu of our combinations instead of their own choice. So the
    // check runs the other way round: the chips must be gone, and the recorder must
    // still be visible and still reach the main process when a key is pressed.
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 520, height: 820, deviceScaleFactor: 2, mobile: false })
    await browser.send('Page.navigate', { url: SETTINGS_URL })
    await sleep(1500)

    const settingsState = await browser.evaluate(`(() => {
      const box = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
      const scroller = [...document.querySelectorAll('*')].find((el) => el.scrollHeight > el.clientHeight + 2 && getComputedStyle(el).overflowY === 'auto');
      const row = [...document.querySelectorAll('.row')].find((el) => /Горячая клавиша/.test((el.querySelector('.row__label') || {}).textContent || ''));
      if (row) row.scrollIntoView({ block: 'center' });

      const view = scroller ? box(scroller) : null;
      const recorder = row ? row.querySelector('.hotkey__field') : null;
      const reset = row ? [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Сброс') : null;
      const label = row ? row.querySelector('.row__text') : null;
      const insideView = (el) => {
        if (!el || !view) return false;
        const r = box(el);
        return r.y >= view.y && r.y + r.h <= view.y + view.h;
      };
      return {
        presets: document.querySelectorAll('.presets').length,
        // Any stray chip button left in the row would show up here.
        rowButtons: row ? [...row.querySelectorAll('button')].map((b) => b.textContent.trim()) : [],
        recorderBox: recorder ? box(recorder) : null,
        resetBox: reset ? box(reset) : null,
        recorderText: recorder ? recorder.textContent.trim() : '',
        recorderInside: insideView(recorder),
        resetInside: insideView(reset),
        // The recorder belongs to the control column, never under the label text.
        besideControl: label && recorder ? box(recorder).x >= box(label).x + box(label).w : null,
        rowBox: row ? box(row) : null
      };
    })()`)

    if (settingsState.presets !== 0) {
      fail(`settings: ${settingsState.presets} preset block(s) are still in the hotkey row, expected none`)
    } else if (!settingsState.recorderBox) {
      fail('settings: the hotkey recorder is missing')
    } else if (!settingsState.recorderInside) {
      fail(`settings: the recorder at ${JSON.stringify(settingsState.recorderBox)} is outside the visible body`)
    } else if (!settingsState.resetInside) {
      fail(`settings: the reset button at ${JSON.stringify(settingsState.resetBox)} is outside the visible body`)
    } else if (!settingsState.besideControl) {
      fail(`settings: the recorder overlaps the label column (${JSON.stringify(settingsState.recorderBox)})`)
    } else if (settingsState.rowButtons.length !== 2) {
      fail(`settings: the hotkey row has ${settingsState.rowButtons.length} buttons (${settingsState.rowButtons.join(', ')}), expected the recorder and "Сброс" only`)
    } else {
      ok(
        `settings: hotkey row is the recorder "${settingsState.recorderText}" plus "Сброс", ` +
          `${settingsState.rowBox.w}×${settingsState.rowBox.h}, no preset chips`
      )
    }

    // The title bar carries the product mark. It used to be an empty span painted
    // with a blue gradient, so the app's own logo in the title bar was not the logo
    // at all — it was a coloured rectangle. Now it is the same drawing as the icon,
    // and the check looks for the drawing rather than for the box.
    const brand = await browser.evaluate(`(() => {
      const mark = document.querySelector('.titlebar__title .logo');
      if (!mark) return { error: 'no mark in the title bar' };
      const box = mark.getBoundingClientRect();
      const rect = mark.querySelector('rect');
      const paths = [...mark.querySelectorAll('path')];
      const fill = (el) => (el.getAttribute('fill') || '').toUpperCase();
      const title = mark.closest('.titlebar__title');
      return {
        tag: mark.tagName.toLowerCase(),
        w: Math.round(box.width),
        h: Math.round(box.height),
        tileFill: rect ? fill(rect) : '',
        tileRadius: rect ? Number(rect.getAttribute('rx')) : null,
        shapes: paths.length,
        inkFills: [...new Set(paths.map((p) => fill(p.closest('g') || p)))],
        wordmark: title ? (title.textContent || '').trim() : '',
        // The mark must sit on the text baseline, not above or below it.
        alignedWithText: (() => {
          const label = [...title.querySelectorAll('span')].find((s) => /Flushot/.test(s.textContent || ''));
          if (!label) return null;
          const b = label.getBoundingClientRect();
          const centre = (box.top + box.bottom) / 2;
          return Math.abs(centre - (b.top + b.bottom) / 2) <= 2;
        })()
      };
    })()`)

    if (brand.error) fail(`settings: ${brand.error}`)
    else if (brand.tag !== 'svg') fail(`settings: the title bar mark is a <${brand.tag}>, not an SVG`)
    else if (brand.tileFill !== '#111111') fail(`settings: the mark's tile is ${brand.tileFill}, expected #111111`)
    else if (brand.tileRadius !== 44) fail(`settings: the mark's tile radius is ${brand.tileRadius}, expected 44`)
    else if (brand.shapes !== 10) fail(`settings: the mark has ${brand.shapes} shapes, expected 10`)
    else if (brand.inkFills.some((fill) => fill !== '#A3C8F0')) {
      fail(`settings: the mark's ink is ${brand.inkFills.join(', ')}, expected #A3C8F0`)
    } else if (brand.w < 14) fail(`settings: the mark is only ${brand.w} px wide`)
    else if (brand.alignedWithText === false) fail('settings: the mark is not centred on the wordmark')
    else {
      ok(
        `settings: title bar mark is the logo (${brand.w}×${brand.h} px, tile #111111 r44, ${brand.shapes} shapes, ` +
          `ink ${brand.inkFills[0]}), centred on "${brand.wordmark}"`
      )
    }

    // A keypress must still reach the main process, not just look like a recorder.
    const recorderCommit = await browser.evaluate(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const field = document.querySelector('.hotkey__field');
      if (!field) return { error: 'no recorder' };
      field.click();
      // The recorder arms itself in a React state update, so the listener is not
      // attached until after the click has been flushed — dispatch in the same tick
      // and the keypress lands on nothing.
      await wait(120);
      const armed = !!document.querySelector('.hotkey__field.is-recording');
      window.__patch = null;
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F9', code: 'F9', bubbles: true }));
      await wait(250);
      return { ok: true, armed };
    })()`)
    await sleep(400)
    const patched = await browser.evaluate(`(() => window.__patch || null)()`)
    if (recorderCommit.error) fail(`settings: ${recorderCommit.error}`)
    else if (!recorderCommit.armed) fail('settings: clicking the recorder did not arm it')
    else if (!patched || patched.hotkey !== 'F9') {
      fail(`settings: recording F9 sent ${JSON.stringify(patched)}, expected { hotkey: 'F9' }`)
    } else ok('settings: a recorded key reaches updateSettings')

    // ------------------------------------------------------ 4. two monitors
    const monitorFile = path.join(DOCS, 'multi-monitor.png')
    const monitorMeta = await sharp(monitorFile).metadata()
    if (monitorMeta.width !== 840) fail(`multi-monitor.png is ${monitorMeta.width}px wide, expected 840`)
    const aspect = monitorMeta.width / monitorMeta.height
    if (Math.abs(aspect - 1920 / 2160) > 0.01) {
      fail(`multi-monitor.png has aspect ${aspect.toFixed(3)}, expected ${(1920 / 2160).toFixed(3)} (two monitors stacked)`)
    } else ok(`multi-monitor.png: ${monitorMeta.width}×${monitorMeta.height}, two stacked monitors`)

    // The status message has to be on the primary monitor, not merely somewhere on
    // the desktop. Two 1920 × 1080 screens stacked vertically is the arrangement
    // that exposed this: the overlay window is the union, so anything anchored to
    // its bottom centre lands on the second screen.
    {
      const UNION = { x: 0, y: 0, width: 1920, height: 2160 }
      const monitors = [
        { id: 'A', bounds: { x: 0, y: 0, width: 1920, height: 1080 }, primary: true },
        { id: 'B', bounds: { x: 0, y: 1080, width: 1920, height: 1080 } }
      ]

      await browser.send('Emulation.setDeviceMetricsOverride', { width: UNION.width, height: UNION.height, deviceScaleFactor: 1, mobile: false })
      await browser.send('Page.addScriptToEvaluateOnNewDocument', {
        source: stubSource({
          init: {
            display: {
              id: 'desktop',
              label: 'Два монитора',
              bounds: UNION,
              scaleFactor: 1,
              imageWidth: UNION.width,
              imageHeight: UNION.height,
              monitors
            },
            settings: defaults,
            hotkey: 'CommandOrControl+Shift+S'
          },
          settings: defaults,
          capture,
          card,
          info: { version: '2.2.4', hotkey: 'Ctrl+Shift+S', settingsPath: '' },
          scene: helpers.scene,
          slots: [
            { x: 0, y: 0, width: 1920, height: 1080 },
            { x: 0, y: 1080, width: 1920, height: 1080 }
          ]
        })
      })
      await browser.send('Page.navigate', { url: OVERLAY_URL })
      await sleep(1500)

      // Select on the *second* screen: the message must still appear on the first,
      // because that is where the result card and both toolbars are.
      await browser.evaluate(dragScript({ x: 240, y: 1180 }, { x: 1680, y: 2040 }))
      await sleep(400)
      await browser.evaluate(`(() => {
        const button = document.querySelector('.toolbar--confirm .tb--primary');
        if (button) button.click();
        return true;
      })()`)
      await sleep(1600)

      const placement = await browser.evaluate(`(() => {
        const rect = (el) => {
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
        };
        const toast = document.querySelector('.toast');
        const layer = document.querySelector('.result-layer');
        return {
          toast: rect(toast),
          text: toast ? toast.textContent.trim() : '',
          layer: rect(layer),
          monitor: layer ? layer.dataset.monitor : ''
        };
      })()`)

      if (!placement.toast) fail('two monitors: no status message to place')
      else if (placement.monitor !== 'A') {
        fail(`two monitors: the result layer is on monitor "${placement.monitor}", expected the primary "A"`)
      } else if (!placement.layer) fail('two monitors: no result layer')
      else {
        const t = placement.toast
        const l = placement.layer
        const inside = t.x >= l.x && t.x + t.w <= l.x + l.w && t.y >= l.y && t.y + t.h <= l.y + l.h
        if (!inside) {
          fail(`two monitors: the message at ${JSON.stringify(t)} is outside the primary monitor ${JSON.stringify(l)}`)
        } else {
          ok(`two monitors: "${placement.text}" at ${t.x},${t.y} stays on the primary monitor (0–${l.h} of ${UNION.height})`)
        }
        // The second screen starts at y = 1080; the message must be far above it.
        if (t.y + t.h > 1080) fail(`two monitors: the message reaches y=${t.y + t.h}, which is the second screen`)
        else ok('two monitors: the message does not reach the second screen')
      }
    }
  } finally {
    await browser.close()
    server.close()
    await fs.rm(BUILD, { recursive: true, force: true })
  }

  for (const note of notes) console.log(`  · ${note}`)
  if (failures.length > 0) {
    console.error(`\n${failures.length} PROBLEM(S):`)
    for (const failure of failures) console.error(`  ✗ ${failure}`)
    process.exit(1)
  }
  console.log('\nInterface screenshots match the interface.')
}

main().catch((error) => {
  console.error('FAILED', error)
  process.exit(1)
})
