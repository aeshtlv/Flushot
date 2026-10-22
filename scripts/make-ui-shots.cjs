/**
 * Renders the interface screenshots for the site and the README.
 *
 * What this is: the *real* overlay and settings windows — the same React
 * components, the same stylesheet, the same compositor — driven in a headless
 * browser over a synthetic desktop. Nothing here photographs the machine it runs
 * on. Previously these pictures came from the UI self-test, which captures the
 * live screen: fine as a test artefact, wrong as marketing, because it publishes
 * whatever happened to be open at the time.
 *
 * How it stays honest:
 *
 *  - The overlay is `out/renderer/overlay/index.html`, the actual bundle.
 *  - `window.flushot` is stubbed before the page loads, so the window behaves as
 *    if Electron had handed it a display. The bitmap it receives is the same
 *    `demoScene.ts` SVG the hero uses, rasterised in the page.
 *  - Selections and annotations are produced by dispatching real pointer events,
 *    not by writing markup: what you see is what the components draw.
 *  - The result card is composed by `src/main/imaging/compose.ts` — the shipping
 *    code path, with the shipping defaults.
 *
 * Requires a build first (`npm run build`), because it loads `out/`.
 *
 * Usage: node scripts/make-ui-shots.cjs
 */

const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')
const http = require('node:http')
const { spawn, execFileSync } = require('node:child_process')
const sharp = require('sharp')

const ROOT = path.join(__dirname, '..')
const OUT = path.join(ROOT, 'docs')
const BUILD = path.join(ROOT, '.tmp', 'imaging-build')
const HTTP_PORT = 8131
const CDP_PORT = 9471

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// --------------------------------------------------------------------- compile

/** The compositor and the settings preview, compiled to plain Node. */
function compileImaging() {
  const files = [
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
    'src/shared/hotkey.ts'
  ]

  execFileSync(
    process.execPath,
    [
      path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'),
      ...files,
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
}

/** The demo scene is TypeScript with no imports, so it is transpiled directly. */
async function loadScene() {
  const source = await fs.readFile(path.join(ROOT, 'src', 'renderer', 'overlay', 'demoScene.ts'), 'utf8')
  const ts = require('typescript')
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText
  const file = path.join(BUILD, 'demoScene.cjs')
  await fs.writeFile(file, js, 'utf8')
  return require(file).demoSceneSvg()
}

// ----------------------------------------------------------------- static host

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json'
}

/**
 * Serves the project over HTTP.
 *
 * The renderer is a module bundle, and Chromium refuses to load modules from
 * `file://` (opaque origin), so a server is the only way to run the real build.
 */
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

// ---------------------------------------------------------------------- browser

async function launch() {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'flushot-ui-'))
  const edge = spawn(
    path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    [
      '--headless=new',
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--hide-scrollbars',
      '--force-color-profile=srgb',
      '--disable-lcd-text',
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
  const errors = []
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.method === 'Runtime.exceptionThrown') {
      errors.push(message.params.exceptionDetails.text || 'exception')
    }
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      const entry = message.params.entry
      const where = entry.url || ''
      // A missing favicon is not a defect in the screenshot.
      if (!/favicon/.test(where) && !/favicon/.test(entry.text)) {
        errors.push(`${entry.text} ${where}`.trim())
      }
    }
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
  await send('Log.enable')

  return {
    send,
    evaluate,
    errors,
    close: async () => {
      ws.close()
      edge.kill()
      await fs.rm(profile, { recursive: true, force: true }).catch(() => {})
    }
  }
}

// ---------------------------------------------------------------- the API stub

/**
 * The preload bridge, replaced by a fixed answer.
 *
 * This is the only piece of fakery in the pipeline: the window asks the main
 * process for a display and a frozen frame, and gets the synthetic desktop
 * instead. Everything downstream — layout, dimming, the selection, the toolbars,
 * the annotation canvas — is the shipping renderer reacting to those answers.
 */
function stubSource(config) {
  return `(() => {
  const CFG = ${JSON.stringify(config)};

  // The scene is an SVG string; rasterising it in the page avoids shipping tens
  // of megabytes of RGBA through the debugging protocol.
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
      const display = CFG.init.display;
      return rasterise(CFG.scene, display.imageWidth, display.imageHeight, CFG.slots);
    },
    captureSelection: async () => CFG.capture,
    saveScreenshot: async () => ({ ok: true, message: 'Сохранено', path: CFG.capture.path }),
    copyScreenshot: async () => ({ ok: true, message: 'Скопировано в буфер' }),
    concealOverlay: () => undefined,
    recognizeText: async (annotations, region) => ({
      ok: true,
      lang: 'ru',
      languages: region ? ['ru', 'en-US'] : ['ru'],
      lines: [
        { text: 'Выручка выросла на 18 % относительно прошлого квартала.', words: [] },
        { text: 'Рост дали новые клиенты в среднем сегменте: 134 договора', words: [] },
        { text: 'вместо плановых 120.', words: [] }
      ],
      text: [
        'Выручка выросла на 18 % относительно прошлого квартала.',
        'Рост дали новые клиенты в среднем сегменте: 134 договора',
        'вместо плановых 120.'
      ].join(String.fromCharCode(10))
    }),
    warmTextRecognition: () => undefined,
    copyText: async () => ({ ok: true }),
    cancelCapture: async () => undefined,
    openSettings: async () => undefined,
    onOverlayReset: () => () => undefined,
    onCopyShortcut: () => () => undefined,
    reportOverlayReady: () => undefined,
    reportOverlayPainted: () => undefined,
    getSettings: async () => settings,
    probeHotkey: async () => ({ free: true }),
    updateSettings: async (patch) => { settings = { ...settings, ...patch }; return settings; },
    resetSettings: async () => settings,
    pickDirectory: async () => ({ canceled: true }),
    getPreview: async () => CFG.card,
    openSaveFolder: async () => undefined,
    getAppInfo: async () => CFG.info,
    closeWindow: async () => undefined
  };
})();`
}

// ----------------------------------------------------------------------- shots

const OVERLAY_URL = `http://127.0.0.1:${HTTP_PORT}/out/renderer/overlay/index.html`
const SETTINGS_URL = `http://127.0.0.1:${HTTP_PORT}/out/renderer/settings/index.html`

/**
 * Drags a selection, the way a person would.
 *
 * The events go to the root for the press and to the window for the move and the
 * release, which is exactly what the component listens for: the pointer can
 * leave the overlay while the button is still down.
 */
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

async function main() {
  await fs.mkdir(OUT, { recursive: true })
  await fs.rm(BUILD, { recursive: true, force: true })
  compileImaging()

  const compose = require(path.join(BUILD, 'main', 'imaging', 'compose.js'))
  const previewModule = require(path.join(BUILD, 'main', 'settings', 'preview.js'))
  const settingsModule = require(path.join(BUILD, 'shared', 'settings.js'))

  const scene = await loadScene()
  const defaults = settingsModule.defaultSettings('C:\\Users\\Пользователь\\Pictures\\Flushot')
  // Rasterised at twice the CSS size: the display is emulated at device pixel
  // ratio 2, so the desktop is captured at 2560×1440 and the region below is
  // cut from the same pixels the overlay would have received.
  const scenePng = await sharp(Buffer.from(scene)).resize({ width: 2560, kernel: 'lanczos3' }).png().toBuffer()

  // A 1280×720 display at 200 %, which is what a 4K laptop reports. The frozen
  // frame is therefore 2560×1440 and the page renders at device pixel ratio 2,
  // so the desktop bitmap lands on the canvas at exactly one image pixel per
  // device pixel — no upscaling anywhere.
  const DISPLAY = {
    id: 'DISPLAY1',
    label: 'DISPLAY1',
    bounds: { x: 0, y: 0, width: 1280, height: 720 },
    scaleFactor: 2,
    imageWidth: 2560,
    imageHeight: 1440
  }

  // What the overlay shot selects: the content column of the demo window, the
  // way a person would frame a report — sidebar excluded, window edges excluded.
  const SELECTED = { x: 330, y: 88, width: 855, height: 552 }

  /**
   * What the annotate shot works on: the top half of that column.
   *
   * Deliberately tighter than the selection. The result card is shown at
   * `fit` scale, and at 565 CSS pixels tall it fits the 720-pixel window at 38 %,
   * which would shrink a 6-pixel arrow to two pixels. Cropping to 270 keeps the
   * card at ~68 %, so the marks are legible at the size the site shows them.
   */
  const CONTENT = { x: 344, y: 100, width: 836, height: 400 }
  const contentPng = await sharp(scenePng)
    .extract({
      left: Math.round(CONTENT.x * 2),
      top: Math.round(CONTENT.y * 2),
      width: Math.round(CONTENT.width * 2),
      height: Math.round(CONTENT.height * 2)
    })
    .png()
    .toBuffer()

  // The card the app would hand back after "Создать": the shipping compositor,
  // shipping defaults, no overrides.
  const composed = await compose.composeScreenshot(contentPng, compose.composeOptionsFromSettings(defaults))
  const composedMeta = await sharp(composed).metadata()
  const card = await previewModule.renderPreview(defaults, 900)

  const capture = {
    ok: true,
    message: '',
    preview: `data:image/png;base64,${composed.toString('base64')}`,
    width: composedMeta.width,
    height: composedMeta.height,
    path: 'C:\\Users\\Пользователь\\Pictures\\Flushot\\screenshot_2026-10-17_14-30-25.png'
  }

  const init = {
    display: DISPLAY,
    settings: defaults,
    hotkey: 'CommandOrControl+Shift+S'
  }

  const server = await serve()
  const browser = await launch()

  try {
    // ---------------------------------------------------------- 1. selection
    {
      await browser.send('Emulation.setDeviceMetricsOverride', {
        width: 1280,
        height: 720,
        deviceScaleFactor: 2,
        mobile: false
      })
      await browser.send('Page.addScriptToEvaluateOnNewDocument', {
        source: stubSource({
          init,
          settings: defaults,
          capture,
          card,
          info: { version: '2.2.3', hotkey: 'Ctrl+Shift+S', settingsPath: '' },
          scene,
          slots: [{ x: 0, y: 0, width: 2560, height: 1440 }]
        })
      })
      await browser.send('Page.navigate', { url: OVERLAY_URL })
      await sleep(1400)

      await browser.evaluate(dragScript({ x: SELECTED.x, y: SELECTED.y }, { x: SELECTED.x + SELECTED.width, y: SELECTED.y + SELECTED.height }))
      await sleep(500)

      const shot = await browser.send('Page.captureScreenshot', { format: 'png' })
      await write(shot.data, 'ui-overlay.png', 640)
    }

    // ------------------------------------------------------------ 2. annotate
    {
      await browser.send('Emulation.setDeviceMetricsOverride', {
        width: 1280,
        height: 720,
        deviceScaleFactor: 2,
        mobile: false
      })
      await browser.send('Page.navigate', { url: OVERLAY_URL })
      await sleep(1400)

      // Select the content column, then confirm — the renderer asks the stubbed
      // bridge for a capture and gets the real compositor's output back.
      await browser.evaluate(dragScript({ x: CONTENT.x, y: CONTENT.y }, { x: CONTENT.x + CONTENT.width, y: CONTENT.y + CONTENT.height }))
      await sleep(400)
      await browser.evaluate(`(() => {
        const button = [...document.querySelectorAll('.toolbar--confirm .tb--primary')][0];
        if (!button) return 'no button';
        button.click();
        return 'clicked';
      })()`)
      await sleep(1200)

      // Arrow, then a snapped line under a table row. Both are drawn by pointer
      // events on the real canvas.
      await browser.evaluate(`(async () => {
        const pause = (ms) => new Promise((r) => setTimeout(r, ms));
        const tools = document.querySelectorAll('.toolbar--annotate .tb--tool');
        const swatches = document.querySelectorAll('.toolbar--annotate .swatch');
      const strokes = document.querySelectorAll('.toolbar--annotate .tb--stroke');
        const surface = document.querySelector('.annotate-surface');
        if (!surface) return 'no surface';
        const box = surface.getBoundingClientRect();
        const at = (fx, fy) => ({ clientX: box.left + box.width * fx, clientY: box.top + box.height * fy });
        const send = (type, point, extra = {}) => surface.dispatchEvent(new PointerEvent(type, {
          bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', button: 0, ...point, ...extra
        }));

        // Positions are fractions of the picture, measured against the scene's
        // own layout (see demoScene.ts) so neither mark lands on a glyph:
        // the arrow climbs from the blank space between two table rows, through
        // the gutter between the Q2 and Q3 bars, to the tallest bar; the line
        // underlines the sentence about the falling churn, which is the claim
        // the two marks are making.
        tools[0].click();          // arrow
        await pause(60);
        swatches[0].click();       // red
        await pause(60);
        if (strokes.length > 2) { strokes[2].click(); await pause(60); }
        send('pointerdown', at(0.50, 0.96), { buttons: 1 });
        send('pointermove', at(0.905, 0.44), { buttons: 1 });
        send('pointerup', at(0.905, 0.44), { buttons: 0 });
        await pause(200);

        tools[1].click();          // line
        await pause(60);
        send('pointerdown', at(0.005, 0.3975), { buttons: 1, shiftKey: true });
        send('pointermove', at(0.395, 0.3975), { buttons: 1, shiftKey: true });
        send('pointerup', at(0.395, 0.3975), { buttons: 0, shiftKey: true });
        await pause(200);

        tools[0].click();
        await pause(150);
        return document.querySelector('.annotate-box') ? document.querySelector('.annotate-box').dataset.annotations : 'none';
      })()`)
      await sleep(400)

      const shot = await browser.send('Page.captureScreenshot', { format: 'png' })
      await write(shot.data, 'ui-annotate.png', 640)
    }

    // --------------------------------------------------------- 3. reading text
    {
      // Same page as the annotation shot: the picture is already on screen with
      // two marks on it, which is exactly the state the picker is used in.
      const picked = await browser.evaluate(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const button = [...document.querySelectorAll('.toolbar--actions .tb')]
          .find((el) => /Текст/.test(el.textContent || ''));
        if (!button) return 'no text button';
        button.click();
        await wait(150);
        const overlay = document.querySelector('.ocr-pick');
        if (!overlay) return 'no picker';
        const box = overlay.getBoundingClientRect();
        const at = (fx, fy) => ({ clientX: box.left + box.width * fx, clientY: box.top + box.height * fy });
        const send = (type, point, buttons) => overlay.dispatchEvent(new PointerEvent(type, {
          bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', button: 0,
          clientX: point.clientX, clientY: point.clientY, buttons
        }));
        // The paragraph under the table: the claim the two marks point at.
        send('pointerdown', at(0.06, 0.62), 1);
        await wait(60);
        send('pointermove', at(0.72, 0.74), 1);
        await wait(140);
        send('pointerup', at(0.72, 0.74), 0);
        await wait(500);
        return document.querySelector('.text-panel') ? 'panel' : 'no panel';
      })()`)
      if (picked !== 'panel') console.log('  ! picker shot:', picked)
      await sleep(400)

      const shot = await browser.send('Page.captureScreenshot', { format: 'png' })
      await write(shot.data, 'ui-ocr.png', 640)
    }

    // ------------------------------------------------------------ 4. settings
    {
      await browser.send('Emulation.setDeviceMetricsOverride', {
        width: 520,
        height: 820,
        deviceScaleFactor: 2,
        mobile: false
      })
      await browser.send('Page.navigate', { url: SETTINGS_URL })
      await sleep(1600)

      const shot = await browser.send('Page.captureScreenshot', { format: 'png' })
      await write(shot.data, 'ui-settings.png', 260)
    }

    // --------------------------------------------------------- 5. two monitors
    {
      // Two 1920×1080 monitors, one above the other, exactly as the site copy
      // describes. The overlay window covers their union.
      const UNION = { x: 0, y: 0, width: 1920, height: 2160 }
      const monitors = [
        { id: 'A', bounds: { x: 0, y: 0, width: 1920, height: 1080 }, primary: true },
        { id: 'B', bounds: { x: 0, y: 1080, width: 1920, height: 1080 } }
      ]

      await browser.send('Emulation.setDeviceMetricsOverride', {
        width: UNION.width,
        height: UNION.height,
        deviceScaleFactor: 1,
        mobile: false
      })
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
          info: { version: '2.2.3', hotkey: 'Ctrl+Shift+S', settingsPath: '' },
          scene,
          // The same desktop drawn twice: the point of the picture is the
          // selection crossing the seam, not the wallpaper.
          slots: [
            { x: 0, y: 0, width: 1920, height: 1080 },
            { x: 0, y: 1080, width: 1920, height: 1080 }
          ]
        })
      })
      await browser.send('Page.navigate', { url: OVERLAY_URL })
      await sleep(2000)

      await browser.evaluate(dragScript({ x: 470, y: 640 }, { x: 1460, y: 1500 }))
      await sleep(600)

      const shot = await browser.send('Page.captureScreenshot', { format: 'png' })
      await write(shot.data, 'multi-monitor.png', 420)
    }

    if (browser.errors.length > 0) {
      console.error('\nconsole errors:')
      for (const error of browser.errors.slice(0, 8)) console.error('  ' + error)
    }
  } finally {
    await browser.close()
    server.close()
    await fs.rm(BUILD, { recursive: true, force: true })
  }
}

/**
 * Saves a capture, downscaled to the width the page shows it at.
 *
 * The render happens at device pixel ratio 2 or 1 depending on the shot, and the
 * site shows these at 640 / 260 / 420 CSS pixels; writing them at 2× that is
 * what a high-density display asks for, and anything larger is wasted bytes.
 */
async function write(base64, name, cssWidth) {
  const buffer = Buffer.from(base64, 'base64')
  const target = Math.round(cssWidth * 2)
  const meta = await sharp(buffer).metadata()

  const pipeline = meta.width > target ? sharp(buffer).resize({ width: target, kernel: 'lanczos3' }) : sharp(buffer)
  const output = await pipeline.png({ compressionLevel: 9 }).toBuffer()
  const final = await sharp(output).metadata()

  await fs.writeFile(path.join(OUT, name), output)
  const stat = await fs.stat(path.join(OUT, name))
  console.log(
    `${name.padEnd(20)} ${String(meta.width).padStart(4)}×${String(meta.height).padEnd(5)} → ` +
      `${String(final.width).padStart(4)}×${String(final.height).padEnd(5)} ${(stat.size / 1024).toFixed(0)} KB`
  )
}

main().catch((error) => {
  console.error('FAILED', error)
  process.exit(1)
})
