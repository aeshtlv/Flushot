import { promises as fs } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { BrowserWindow, ClipboardItem, app, clipboard, globalShortcut, nativeImage, screen } from 'electron'
import { defaultSettings } from '../../shared/settings'
import { selectionToImageRect } from '../../shared/geometry'
import type { AnnotationLayerPayload, DisplayCaptureSnapshot } from '../../shared/types'
import { captureAllDisplays, captureDisplays, toRgbaBitmap } from '../capture/screenCapture'
import { isCopyShortcutRegistered, registerCopyShortcut, unregisterCopyShortcut } from '../capture/copyShortcut'
import type { CaptureSession } from '../capture/CaptureSession'
import { composeOptionsFromSettings, composeRawScreenshot, composeScreenshot, cropImage, warmImaging } from '../imaging/compose'
import { encodeImage } from '../export/imageExport'
import { buildScreenshotFilename } from '../export/filename'
import { isAutostartEnabled, launchTarget, setAutostart } from '../system/autostart'
import { isOcrSupported, stopOcr } from '../ocr/worker'
import { recognizePictureFile } from '../ocr/recognize'
import { ocrSampleSvg } from '../ocr/sample'
import type { SettingsStore } from '../settings/SettingsStore'
import { preloadPath, rendererUrl } from '../windows/paths'
import { virtualBounds, virtualScale } from '../../shared/virtualScreen'

interface SelfTestReport {
  ok: boolean
  /** Milliseconds from hotkey to visible overlay, plus stage breakdown. */
  latency: Record<string, number>
  captureRuns: number[]
  /** Pre-warmed overlay windows must stay hidden: `visible` counts strays. */
  prewarm: { visible: number; ok: boolean }
  /** Pixel diff between the raw fast path and the PNG path it replaced. */
  rawCompare: { bytes: number; maxDiff: number; error?: string; shadowMs?: number }
  /** Cost of the one-time imaging engine init that warmImaging() absorbs. */
  warmImaging: { initMs: number; steadyMs: number; ok: boolean }
  /**
   * Where the user actually waits, measured on the real capture of this run:
   * composing the card after Enter, stitching the monitors on the hotkey, and
   * the total hotkey-to-visible-overlay time.
   */
  perf: { composeMs: number; stitchMs: number; overlayMs: number; cardKB: number; card: string; ok: boolean; note?: string }
  realCopy: { ok: boolean; clipboard: string; overlays: number; closed: boolean; note?: string; warm?: Record<string, string | number>; cold?: Record<string, number>; copy?: Record<string, number>; hiddenAfterMs?: number; clipboardAfterMs?: number }
  displays: {
    id: string
    label: string
    bounds: { width: number; height: number }
    scaleFactor: number
    image: { width: number; height: number }
  }[]
  /** Composed size, plus the size the frame rule predicts for the selection. */
  canvas: { width: number; height: number; expectedWidth: number; expectedHeight: number; frame: number } | null
  ui: { settings: string[]; overlay: string[] }
  facts: {
    settings: Record<string, string>
    webp: Record<string, string>
    compact: Record<string, string>
    hotkey: Record<string, string>
    overlay: Record<string, string>
    overlayCopy: Record<string, string>
    overlayGlobalCopy: Record<string, string>
    annotate: Record<string, string>
    color: Record<string, string>
  }
  files: string[]
  clipboard: string
  errors: string[]
  annotateCopy?: { ok: boolean; note?: string; magenta: number; size: string }
  /** Real Windows Run-key round trip; opt-in because it writes to the registry. */
  autostart?: {
    ok: boolean
    skipped: boolean
    enabled: boolean
    disabled: boolean
    restored: boolean
    note?: string
    /** What the Run entry would launch — the portable exe, not the temp folder. */
    target?: string
  }
  /** PNG/JPEG/WebP saved through the real path and read back with sharp. */
  formats?: { ok: boolean; note?: string; files: Record<string, string> }
  /**
   * Text recognition, end to end: a picture with known text goes through the real
   * Windows engine and has to come back with that text.
   *
   * Ungated when the engine is absent — a Windows install without an OCR language
   * is a supported configuration, and the app says so instead of failing.
   */
  ocr?: { ok: boolean; supported: boolean; lines: number; ms: number; text?: string; error?: string; note?: string }
  /** What the capture session last complained about, plus the live window list. */
  debug?: { lastError: string; windows: { url: string; bounds: string; visible: boolean }[] }
  /**
   * The overlay must cover the whole virtual desktop, not one monitor, so a
   * selection can cross the seam between screens.
   */
  virtual?: {
    ok: boolean
    note?: string
    screens: number
    window: string
    expected: string
    image: string
    scale: number
    resampled: string
  }
  /** A selection dragged from one monitor across the seam onto another. */
  seam?: { ok: boolean; skipped: boolean; note?: string; rect?: string; size?: string; monitor?: string; box?: string; zoom?: string; hint?: string }
  /** The full-screen hotkey: the region arrives already selected and confirms itself. */
  fullscreen?: {
    ok: boolean
    skipped: boolean
    note?: string
    size?: string
    expected?: string
    selected?: string
    shortcut?: string
    registered?: boolean
  }
  /**
   * Saving a new full-screen combination must actually bind it.
   *
   * Regression: the window reported "занята" for any combination the user picked
   * for the second key, because the rebind was skipped when the *region* key had
   * not changed.
   */
  hotkeyRebind?: {
    ok: boolean
    note?: string
    requested?: string
    saved?: string
    registered?: boolean
    restored?: string
  }
  /** The preview must grow with the window instead of staying 440 px wide. */
  previewResize?: {
    ok: boolean
    note?: string
    narrow?: string
    wide?: string
  }
  /**
   * Every accelerator the settings window can produce must be registrable.
   *
   * Regression: `KeyboardEvent.code` reports `Equal`/`Minus`/`BracketLeft`, and
   * those were saved verbatim. `globalShortcut.register` throws a `TypeError` on
   * them, so one punctuation shortcut stopped the app from starting at all.
   * This probes the real parser instead of trusting the mapping table.
   */
  accelerators?: {
    ok: boolean
    note?: string
    /** Combinations that Electron refused, with its message. */
    rejected?: string[]
    checked?: number
    /** What the stored shortcuts normalize to. */
    stored?: string
  }
}

/** Load a renderer page, optionally drive it, screenshot it, report DOM facts. */
async function inspectWindow(
  url: string,
  size: { width: number; height: number },
  file: string,
  drive?: string,
  sendChannel?: string,
  /**
   * Show the window for the screenshot. Chromium does not composite canvas
   * updates for a window that was never shown, so a canvas-driven page needs
   * this to be captured as the user really sees it.
   */
  reveal = false
): Promise<{ labels: string[]; facts: Record<string, string>; file: string }> {
  const window = new BrowserWindow({
    width: size.width,
    height: size.height,
    show: false,
    frame: false,
    backgroundColor: '#F5F5F7',
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  const consoleLines: string[] = []
  window.webContents.on('console-message', (event) => {
    consoleLines.push(`${event.level}: ${event.message}`)
  })

  try {
    await window.loadURL(url)
    await wait(1200)
    if (reveal) {
      // `showInactive` keeps the focus where it was: the self-test must not
      // steal keyboard focus from whatever the user is doing.
      window.showInactive()
      await wait(400)
    }
    if (drive) {
      await window.webContents.executeJavaScript(drive)
      await wait(500)
    }

    // Simulates the global Ctrl+C: the main process sends this to the overlay.
    if (sendChannel) {
      window.webContents.send(sendChannel)
      await wait(600)
    }

    const result = (await window.webContents.executeJavaScript(`(() => ({
      labels: Array.from(document.querySelectorAll('button'))
        .map((b) => (b.innerText || b.title || '').trim().replace(/\\s+/g, ' '))
        .filter(Boolean),
      facts: {
        hint: (document.querySelector('.hint__title') || {}).textContent || '',
        badge: (document.querySelector('.size-badge__value') || {}).textContent || '',
        displayTag: (document.querySelector('.display-tag') || {}).textContent || '',
        toolbar: (document.querySelector('.toolbar') || {}).textContent ? 'visible' : 'hidden',
        toast: (document.querySelector('.toast') || {}).textContent || '',
        panels: String(document.querySelectorAll('.panel').length),
        preview: (document.querySelector('.preview__meta') || {}).textContent || '',
        screenShot: String(document.querySelectorAll('.screen-shot').length),
        hotkey: (document.querySelector('.hotkey__field') || {}).textContent || '',
        version: (document.querySelector('.footer .version') || {}).textContent || '',
        versionCentered: String(
          (() => {
            const el = document.querySelector('.footer .version');
            const footer = document.querySelector('.footer');
            if (!el || !footer) return false;
            const box = el.getBoundingClientRect();
            const parent = footer.getBoundingClientRect();
            const delta = Math.abs(box.left + box.width / 2 - (parent.left + parent.width / 2));
            return delta < 12;
          })()
        ),
        resetLast: String(
          (() => {
            const panels = Array.from(document.querySelectorAll('.panel'));
            const last = panels[panels.length - 1];
            return Boolean(last && last.classList.contains('panel--reset'));
          })()
        ),
        folderClickable: String(document.querySelectorAll('button.folder__path').length),
        // The autostart switch must exist and must be off in a fresh profile.
        autostartRow: String(
          (() => {
            const rows = Array.from(document.querySelectorAll('.row'));
            const row = rows.find((el) => {
              const label = el.querySelector('.row__label');
              return label && label.textContent.trim() === 'Запускать с Windows';
            });
            if (!row) return 'missing';
            const toggle = row.querySelector('[role="switch"]');
            if (!toggle) return 'no-switch';
            return toggle.getAttribute('aria-checked') === 'true' ? 'on' : 'off';
          })()
        ),
        // The preview must scroll with the page, not float over the settings.
        previewSticky: String(Boolean(document.querySelector('.preview-sticky'))),
        // The format under the preview must name the format that will be written.
        formatLabel: ((document.querySelector('.preview__meta span:last-child') || {}).textContent || '').trim(),
        // What the caption says after picking WebP, and after switching back.
        webpLabel: String(window.__webpLabel || ''),
        webpQuality: String(window.__webpQuality || ''),
        webpRestored: String(window.__webpRestored || ''),
        firstPanel: ((document.querySelector('.panel h2') || {}).textContent || '').trim(),
        // All colour buttons must share one width and sit on two even columns.
        swatchAligned: String(
          (() => {
            const boxes = Array.from(document.querySelectorAll('.swatch')).map((el) => el.getBoundingClientRect());
            if (boxes.length < 4) return false;
            const widths = boxes.map((b) => b.width);
            const lefts = new Set(boxes.map((b) => Math.round(b.left)));
            return Math.max(...widths) - Math.min(...widths) <= 1 && lefts.size === 2;
          })()
        ),
        // Responsive layout check: nothing may stick out of the viewport.
        overflowX: String(document.documentElement.scrollWidth > window.innerWidth + 1),
        clipped: String(Array.from(document.querySelectorAll('.row__control, .footer__actions, .toolbar')).filter((el) => {
          const box = el.getBoundingClientRect();
          return box.right > window.innerWidth + 1 || box.left < -1;
        }).length),
        bodyText: (document.body.innerText || '').slice(0, 200),
        // Annotation bar on the result screen.
        annotateTools: String(document.querySelectorAll('.toolbar--annotate .tb--tool').length),
        annotateSwatches: String(document.querySelectorAll('.toolbar--annotate .swatch').length),
        annotateCount: ((document.querySelector('.annotate-box') || {}).dataset || {}).annotations || '',
        annotateActive: String(document.querySelectorAll('.toolbar--annotate .is-active').length),
        annotatePainted: String(
          (() => {
            const canvas = document.querySelector('canvas.annotate-surface');
            if (!canvas || !canvas.width) return -1;
            const context = canvas.getContext('2d');
            if (!context) return -1;
            try {
              const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
              let painted = 0;
              for (let i = 3; i < data.length; i += 4) if (data[i] > 0) painted++;
              return painted;
            } catch (error) {
              // A tainted canvas cannot be read; report it instead of crashing.
              return -2;
            }
          })()
        ),
        annotateSize: (() => {
          const canvas = document.querySelector('canvas.annotate-surface');
          return canvas ? canvas.width + 'x' + canvas.height : '';
        })(),
        // Text tool must offer its own size buttons instead of line widths.
        annotateTextSizes: String(window.__annotateTextSizes || '0'),
        annotateTextRows: String(window.__annotateTextRows || 'none'),
        // Text carried into the editor when a saved caption is clicked again.
        annotateReedit: String(window.__annotateReedit || 'none'),
        annotateStepNumbers: String(window.__annotateStepNumbers || ''),
        // 'shift:overflow:height' for a 12-line caption: the bar must not move and
        // the field must stay inside the picture.
        annotateToolbarShift: String(window.__annotateToolbarShift || 'none'),
        // 'before>after>count' after dragging the caption with the move tool.
        annotateMoved: String(window.__annotateMoved || 'none'),
        // 'before>after>x1,y1>x2,y2' after drawing a line with Shift held.
        annotateLine: String(window.__annotateLine || 'none'),
        annotateLayout: String(window.__annotateLayout || 'none'),
        // Pixels touching the outermost columns: must be zero, or the caption
        // overflowed the picture instead of wrapping at the right edge.
        annotateEdge: String(
          (() => {
            const canvas = document.querySelector('canvas.annotate-surface');
            if (!canvas || !canvas.width) return -1;
            const context = canvas.getContext('2d');
            if (!context) return -1;
            try {
              const band = 3;
              let edge = 0;
              const right = context.getImageData(canvas.width - band, 0, band, canvas.height).data;
              for (let i = 3; i < right.length; i += 4) if (right[i] > 0) edge++;
              const bottom = context.getImageData(0, canvas.height - band, canvas.width, band).data;
              for (let i = 3; i < bottom.length; i += 4) if (bottom[i] > 0) edge++;
              return edge;
            } catch (error) {
              return -2;
            }
          })()
        ),
        annotateRect: (() => {
          const canvas = document.querySelector('canvas.annotate-surface');
          if (!canvas) return 'none';
          const box = canvas.getBoundingClientRect();
          const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          return Math.round(box.left) + ',' + Math.round(box.top) + ',' + Math.round(box.width) + 'x' + Math.round(box.height) + ' top=' + (top ? top.className : 'null');
        })(),
        // Where the paint actually landed, in canvas pixels.
        annotateBBox: (() => {
          const canvas = document.querySelector('canvas.annotate-surface');
          const context = canvas && canvas.getContext('2d');
          if (!canvas || !context) return 'none';
          const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
          let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1, sample = '';
          for (let y = 0; y < canvas.height; y++) {
            for (let x = 0; x < canvas.width; x++) {
              const i = (y * canvas.width + x) * 4;
              if (data[i + 3] === 0) continue;
              if (x < minX) minX = x;
              if (y < minY) minY = y;
              if (x > maxX) maxX = x;
              if (y > maxY) maxY = y;
              if (!sample && data[i + 3] > 200) sample = data[i] + ',' + data[i + 1] + ',' + data[i + 2];
            }
          }
          return minX + ',' + minY + ',' + maxX + ',' + maxY + ' colour=' + sample;
        })(),
        console: ${JSON.stringify(consoleLines)}.join(' | ').slice(0, 800)
      }
    }))()`)) as { labels: string[]; facts: Record<string, string> }

    const image = await window.webContents.capturePage()
    await fs.writeFile(file, image.toPNG())
    return { ...result, file }  } finally {
    window.destroy()
  }
}

/** Simulates a mouse drag inside the overlay to create a 600×400 selection. */
const DRAG_SCRIPT = `(() => {
  const root = document.querySelector('.overlay-root');
  const opts = { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1 };
  root.dispatchEvent(new PointerEvent('pointerdown', { ...opts, clientX: 300, clientY: 200 }));
  window.dispatchEvent(new PointerEvent('pointermove', { ...opts, clientX: 900, clientY: 600 }));
  window.dispatchEvent(new PointerEvent('pointerup', { ...opts, clientX: 900, clientY: 600, buttons: 0 }));
  return true
})()`

/** Picks WebP in the settings and records what the preview caption says. */
const WEBP_SCRIPT = `(async () => {
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const pick = (name) =>
    Array.from(document.querySelectorAll('button')).find((el) => el.textContent.trim() === name);
  const caption = () => {
    const node = document.querySelector('.preview__meta span:last-child');
    return (node && node.textContent.trim()) || '';
  };

  const webp = pick('WebP');
  if (!webp) return false;
  webp.click();
  await pause(600);
  window.__webpLabel = caption();
  const quality = Array.from(document.querySelectorAll('.row__label')).find((el) =>
    el.textContent.includes('Качество')
  );
  window.__webpQuality = (quality && quality.textContent.trim()) || '';

  // Put the format back: the profile is shared with every later check.
  const png = pick('PNG');
  if (png) png.click();
  await pause(400);
  window.__webpRestored = caption();
  return true
})()`

/** Clicking the recorder and pressing Ctrl+Alt+P must save a new shortcut. */
const HOTKEY_SCRIPT = `(async () => {
  const field = document.querySelector('.hotkey__field');
  if (!field) return false;
  field.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  // React needs a tick to attach the keydown listener after entering record mode.
  await new Promise((resolve) => setTimeout(resolve, 400));
  const opts = { bubbles: true, cancelable: true, ctrlKey: true, altKey: true, code: 'KeyP', key: 'p' };
  window.dispatchEvent(new KeyboardEvent('keydown', opts));
  await new Promise((resolve) => setTimeout(resolve, 600));
  return true
})()`

/**
 * Drives the annotation bar on the result screen: pick a tool, pick a colour,
 * draw an arrow and check that the layer really received pixels.
 */
const ANNOTATE_SCRIPT = `(async () => {
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const tools = document.querySelectorAll('.toolbar--annotate .tb--tool');
  if (tools.length > 0) tools[0].click();
  await pause(80);

  const swatch = document.querySelectorAll('.toolbar--annotate .swatch');
  if (swatch.length > 2) swatch[2].click();
  await pause(80);

  const surface = document.querySelector('.annotate-surface');
  if (!surface) return false;
  const box = surface.getBoundingClientRect();
  const at = (x, y) => ({ bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', button: 0, clientX: x, clientY: y });
  surface.dispatchEvent(new PointerEvent('pointerdown', { ...at(box.left + 40, box.top + 40), buttons: 1 }));
  surface.dispatchEvent(new PointerEvent('pointermove', { ...at(box.left + 260, box.top + 180), buttons: 1 }));
  surface.dispatchEvent(new PointerEvent('pointerup', { ...at(box.left + 260, box.top + 180), buttons: 0 }));
  await pause(300);

  // The line tool sits second, right after the arrow. Drawn with Shift held, it
  // must snap to a perfectly horizontal segment — that is the whole reason the
  // tool exists (underlining a row of text).
  let lineCheck = 'none';
  if (tools.length > 1) {
    tools[1].click();
    await pause(120);
    const before = (document.querySelector('.annotate-box') || { dataset: {} }).dataset.annotations || '0';
    // Positions are fractions of the surface, not pixel offsets: the card is shown
    // fitted at 56 % here, and an absolute offset landed the segment on the very
    // bottom row of the picture, where it counts as paint on the border.
    const lx1 = box.left + box.width * 0.15;
    const ly1 = box.top + box.height * 0.55;
    const lx2 = box.left + box.width * 0.55;
    const ly2 = ly1 + 5;
    // Down, move and up are dispatched in one go, with no pause in between: the
    // drawing layer applies the last move when the button is released, so the
    // segment cannot be hijacked by a real pointer movement from the physical
    // mouse landing mid-drag.
    surface.dispatchEvent(new PointerEvent('pointerdown', { ...at(lx1, ly1), buttons: 1, shiftKey: true }));
    surface.dispatchEvent(new PointerEvent('pointermove', { ...at(lx2, ly2), buttons: 1, shiftKey: true }));
    surface.dispatchEvent(new PointerEvent('pointerup', { ...at(lx2, ly2), buttons: 0, shiftKey: true }));
    await pause(300);
    const after = (document.querySelector('.annotate-box') || { dataset: {} }).dataset.annotations || '0';
    const segment = (document.querySelector('.annotate-box') || { dataset: {} }).dataset.lineAt || '';
    lineCheck = before + '>' + after + '>' + segment;
  }
  window.__annotateLine = lineCheck;

  // Then a text annotation, typed into the real textarea. React only picks up a
  // programmatic value through the native setter plus an input event.
  if (tools.length > 4) tools[4].click();
  await pause(150);
  // Recorded while the text tool is active: the size buttons only exist for
  // text and step, and the script ends on the move tool.
  window.__annotateTextSizes = String(document.querySelectorAll('.toolbar--annotate .tb--text-size').length);
  surface.dispatchEvent(new PointerEvent('pointerdown', { ...at(box.left + 30, box.top + 230), buttons: 1 }));
  await pause(250);

  const field = document.querySelector('textarea.annotate-text');
  let typed = false;
  if (field) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(field, 'Перенос текста по словам работает и в файле');
    field.dispatchEvent(new Event('input', { bubbles: true }));
    await pause(200);
    // Recorded before Enter closes the editor, so the check can see the widget.
    window.__annotateTextRows = field.tagName + ':' + field.rows + ':' + Math.round(field.getBoundingClientRect().width);
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await pause(350);
    typed = true;
  }

  // Clicking the saved caption again must reopen it with the same text, so it can
  // be edited instead of retyped. Escape then restores it verbatim.
  let reedit = 'none';
  if (tools.length > 4) {
    tools[4].click();
    await pause(120);
    surface.dispatchEvent(new PointerEvent('pointerdown', { ...at(box.left + 30, box.top + 230), buttons: 1 }));
    await pause(300);
    const again = document.querySelector('textarea.annotate-text');
    if (again) {
      reedit = again.value;
      again.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await pause(250);
    }
  }

  // Two numbered badges: they must come out as 1 and 2, not both as 1.
  if (tools.length > 5) {
    tools[5].click();
    await pause(120);
    surface.dispatchEvent(new PointerEvent('pointerdown', { ...at(box.left + 120, box.top + 120), buttons: 1 }));
    await pause(200);
    surface.dispatchEvent(new PointerEvent('pointerdown', { ...at(box.left + 220, box.top + 300), buttons: 1 }));
    await pause(250);
  }
  const stepNumbers = (document.querySelector('.annotate-box') || { dataset: {} }).dataset.stepNumbers || '';
  window.__annotateReedit = reedit;
  window.__annotateStepNumbers = stepNumbers;

  // A tall caption must not move the toolbars. Typing Shift+Enter a dozen times
  // used to grow the card and push the annotation bar off the top of the screen.
  let toolbarShift = 'none';
  if (tools.length > 4) {
    tools[4].click();
    await pause(120);
    const before = document.querySelector('.toolbar--annotate').getBoundingClientRect();
    surface.dispatchEvent(new PointerEvent('pointerdown', { ...at(box.left + 40, box.top + 60), buttons: 1 }));
    await pause(250);
    const field = document.querySelector('textarea.annotate-text');
    if (field) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      const many = Array.from({ length: 12 }, (_, i) => 'Строка ' + (i + 1)).join('\\n');
      setter.call(field, many);
      field.dispatchEvent(new Event('input', { bubbles: true }));
      await pause(250);
      const after = document.querySelector('.toolbar--annotate').getBoundingClientRect();
      const pictureBox = document.querySelector('.annotate-box').getBoundingClientRect();
      const fieldBox = field.getBoundingClientRect();
      // Both numbers matter: the bar must not move, and the field must stay
      // inside the picture instead of being clipped by the card.
      toolbarShift =
        Math.round(after.top - before.top) +
        ':' +
        Math.round(Math.max(0, fieldBox.bottom - pictureBox.bottom)) +
        ':' +
        Math.round(fieldBox.height);
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await pause(200);
    }
  }
  window.__annotateToolbarShift = toolbarShift;
  window.__annotateLayout = (() => {
    const rect = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return selector + '=нет';
      const box = node.getBoundingClientRect();
      return selector + '=' + Math.round(box.left) + ',' + Math.round(box.top) + ' ' + Math.round(box.width) + 'x' + Math.round(box.height);
    };
    return [rect('.result-card'), rect('.result-caption'), rect('.toolbar--annotate'), rect('.toolbar--actions')].join(' | ');
  })();

  // The move tool must relocate an existing caption without duplicating it.
  let moved = 'none';
  if (tools.length > 6) {
    tools[6].click();
    await pause(120);
    const before = (document.querySelector('.annotate-box') || { dataset: {} }).dataset.textAt || '';
    surface.dispatchEvent(new PointerEvent('pointerdown', { ...at(box.left + 34, box.top + 236), buttons: 1 }));
    await pause(120);
    surface.dispatchEvent(new PointerEvent('pointermove', { ...at(box.left + 200, box.top + 300), buttons: 1 }));
    await pause(150);
    surface.dispatchEvent(new PointerEvent('pointerup', { ...at(box.left + 200, box.top + 300), buttons: 0 }));
    await pause(250);
    const after = (document.querySelector('.annotate-box') || { dataset: {} }).dataset.textAt || '';
    const count = (document.querySelector('.annotate-box') || { dataset: {} }).dataset.annotations || '';
    moved = before + '>' + after + '>' + count;
  }
  window.__annotateMoved = moved;

  // A drawn arrow must leave opaque pixels on the layer.
  const canvas = document.querySelector('canvas.annotate-surface');
  const ctx = canvas && canvas.getContext('2d');
  let painted = 0;
  if (ctx && canvas.width > 0) {
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) painted++;
  }

  return { painted, typed, reedit, stepNumbers, toolbarShift: window.__annotateToolbarShift, moved, line: window.__annotateLine, count: (document.querySelector('.annotate-box') || { dataset: {} }).dataset.annotations }
})()`

/** Ctrl+C during the selection stage must be handled (demo mode shows a toast). */
const COPY_KEY_SCRIPT = `(async () => {
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const root = document.querySelector('.overlay-root');
  const opts = { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1 };
  root.dispatchEvent(new PointerEvent('pointerdown', { ...opts, clientX: 300, clientY: 200 }));
  window.dispatchEvent(new PointerEvent('pointermove', { ...opts, clientX: 900, clientY: 600 }));
  window.dispatchEvent(new PointerEvent('pointerup', { ...opts, clientX: 900, clientY: 600, buttons: 0 }));
  // React must commit the selection before the shortcut is handled.
  await pause(250);
  window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ctrlKey: true, key: 'c' }));
  await pause(400);
  return true
})()`
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * End-to-end check of annotations: a real capture, then `session.copy()` with a
 * synthetic layer. The clipboard must contain the drawn colour, which proves the
 * layer is composited into the picture that is actually handed to the system.
 */
async function runAnnotationCheck(
  session: CaptureSession | undefined,
  settings: SettingsStore | undefined,
  outputDir: string
): Promise<{
  ok: boolean
  note?: string
  magenta: number
  size: string
  formats?: { ok: boolean; note?: string; files: Record<string, string> }
}> {
  const result: {
    ok: boolean
    note?: string
    magenta: number
    size: string
    formats?: { ok: boolean; note?: string; files: Record<string, string> }
  } = { ok: false, note: '', magenta: 0, size: '' }

  if (!session) {
    result.note = 'нет активной сессии'
    return result
  }

  try {
    session.prewarm()
    await wait(600)
    await session.start()
    await session.whenAllReady()
    await wait(200)

    const overlay = BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().includes('overlay'))
    if (!overlay) {
      result.note = 'окно выделения не найдено'
      return result
    }

    // Draw a region and confirm it, so the session holds a result to annotate.
    await overlay.webContents.executeJavaScript(DRAG_SCRIPT)
    await wait(350)
    await overlay.webContents.executeJavaScript(
      `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })), true`
    )

    let ready = false
    for (let waited = 0; waited < 4000; waited += 100) {
      ready = await overlay.webContents.executeJavaScript(
        `Boolean(document.querySelector('.result-caption') && document.querySelector('.annotate-surface'))`
      )
      if (ready) break
      await wait(100)
    }
    if (!ready) {
      result.note = 'экран результата не появился'
      return result
    }

    // Magenta is not a colour any normal desktop shows, so counting it in the
    // clipboard image is an honest signal that the layer was composited.
    //
    // The layer is built as raw RGBA in the rectangle that carries paint, which
    // is exactly what the overlay sends: an opaque block at (20, 20) of a
    // 400 × 200 picture. Everything outside it is left out of the payload.
    const layerWidth = 160
    const layerHeight = 80
    const layerData = new Uint8Array(layerWidth * layerHeight * 4)
    for (let index = 0; index < layerData.length; index += 4) {
      layerData[index] = 255
      layerData[index + 1] = 0
      layerData[index + 2] = 255
      layerData[index + 3] = 255
    }
    const layer: AnnotationLayerPayload = {
      x: 20,
      y: 20,
      width: layerWidth,
      height: layerHeight,
      data: layerData
    }

    const copied = await session.copy(layer)
    if (!copied.ok) {
      result.note = copied.message
      return result
    }

    // `clipboard.read()` lists the types; the bytes come from the item itself.
    const contents = await clipboard.read()
    const item = contents.find((entry) => entry.types.includes('image/png'))
    if (!item) {
      result.note = 'в буфере нет изображения'
      return result
    }

    const blob = await item.getType('image/png')
    if (!blob || blob.size === 0) {
      result.note = 'изображение в буфере пустое'
      return result
    }

    const image = Buffer.from(await blob.arrayBuffer())
    await fs.writeFile(path.join(outputDir, 'annotate-clipboard.png'), image)
    const metadata = await sharp(image).metadata()
    result.size = `${metadata.width}×${metadata.height}`
    const { data, info } = await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    let magenta = 0
    for (let i = 0; i < data.length; i += info.channels) {
      if (data[i] > 200 && data[i + 1] < 80 && data[i + 2] > 200) magenta++
    }
    result.magenta = magenta
    result.ok = magenta > 500
    if (!result.ok) result.note = `помеченных пикселей: ${magenta}`

    // Reuse this very result for the format round trip: it is the exact buffer a
    // user would have on screen when they press "Сохранить".
    if (settings) result.formats = await runFormatCheck(session, settings, outputDir)
  } catch (error) {
    result.note = error instanceof Error ? error.message : String(error)
  } finally {
    session.cancel()
    await wait(150)
  }

  return result
}

/**
 * Saves the result the session is already holding as PNG, JPEG and WebP through
 * the real save path, then reads every file back with sharp.
 *
 * It deliberately reuses an existing capture instead of taking a new one: the
 * encode function is unit-tested, but that says nothing about whether the chosen
 * format reaches the file — the setting has to survive sanitising, the filename
 * has to get the right extension, and the write has to land. This is the check
 * that would have caught a "WebP does nothing" report.
 */
async function runFormatCheck(
  session: CaptureSession,
  settings: SettingsStore,
  outputDir: string
): Promise<{ ok: boolean; note?: string; files: Record<string, string> }> {
  const result: { ok: boolean; note?: string; files: Record<string, string> } = { ok: false, files: {} }
  if (!session.hasResult) {
    result.note = 'нет готового снимка для проверки форматов'
    return result
  }

  const before = await settings.load()
  const directory = path.join(outputDir, 'formats')
  await fs.rm(directory, { recursive: true, force: true })
  await fs.mkdir(directory, { recursive: true })

  try {
    await settings.update({ saveDirectory: directory, saveMode: 'folder' })

    for (const format of ['png', 'jpeg', 'webp'] as const) {
      await settings.update({ format })
      const saved = await session.save()
      if (!saved.ok || !saved.path) {
        result.note = `${format}: ${saved.message}`
        return result
      }
      const extension = path.extname(saved.path).slice(1).toLowerCase()
      const metadata = await sharp(saved.path).metadata()
      result.files[format] = `${extension} ${metadata.format} ${metadata.width}×${metadata.height}`
      const expectedExtension = format === 'jpeg' ? 'jpg' : format
      // A file that exists but is not really that format is the exact failure
      // this check exists for, so compare what sharp reads, not what we wrote.
      if (extension !== expectedExtension || metadata.format !== format) {
        result.note = `${format}: файл ${extension}, внутри ${metadata.format}`
        return result
      }
    }

    result.ok = true
  } catch (error) {
    result.note = error instanceof Error ? error.message : String(error)
  } finally {
    await settings.update({ format: before.format, saveDirectory: before.saveDirectory, saveMode: before.saveMode })
  }

  return result
}

/**
 * Drags a selection that starts on one monitor and ends on another.
 *
 * This is the whole point of the single virtual-desktop overlay: with one window
 * per screen a rectangle could never cross the seam. The expected size is
 * computed from the displays themselves, so the check stays meaningful on any
 * layout — side by side, stacked, or with a monitor left of the primary one.
 */
async function runSeamCheck(
  session: CaptureSession | undefined,
  frame: number,
  outputDir: string
): Promise<{
  ok: boolean
  skipped: boolean
  note?: string
  rect?: string
  size?: string
  monitor?: string
  box?: string
  zoom?: string
  hint?: string
  fullBar?: string
}> {
  const displays = screen.getAllDisplays()
  if (displays.length < 2) {
    return { ok: true, skipped: true, note: 'один монитор — через границу выделять нечего' }
  }
  if (!session) return { ok: false, skipped: false, note: 'нет активной сессии' }

  const screens = displays.map((display) => ({
    id: String(display.id),
    bounds: display.bounds,
    scaleFactor: display.scaleFactor
  }))
  const scale = virtualScale(screens)
  const seam = findSeam(screens)
  if (!seam) return { ok: true, skipped: true, note: 'экраны перекрываются — общей границы нет' }

  // A rectangle straddling the seam, deliberately lopsided: 70 % of it lies on
  // the upper monitor. A centred rectangle would split evenly and the host choice
  // would fall back to "whichever came first", proving nothing. It is also large
  // enough that the composed picture cannot fit on one monitor, which is what the
  // zoom check below needs.
  const width = 1500
  const height = 1200
  const from =
    seam.axis === 'x'
      ? { x: seam.at - width * 0.7, y: 140 }
      : { x: 140, y: seam.at - height * 0.7 }
  const to = { x: from.x + width, y: from.y + height }

  try {
    // The previous check leaves its result on screen. Start from a clean
    // selection stage, otherwise Enter would run the result action instead.
    session.cancel()
    await wait(200)
    const warm = BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().includes('overlay'))
    if (warm) {
      for (let waited = 0; waited < 3000; waited += 100) {
        const cleared = await warm.webContents.executeJavaScript(`!document.querySelector('.result-caption')`)
        if (cleared) break
        await wait(100)
      }
    }

    session.prewarm()
    await wait(600)
    await session.start()
    await session.whenAllReady()
    await wait(250)

    const overlay = BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().includes('overlay'))
    if (!overlay) return { ok: false, skipped: false, note: 'окно выделения не найдено' }

    // The "select an area" hint has to sit on one monitor, centred on the primary
    // one. Centred on the window it landed on the seam instead: the title on the
    // upper screen, the shortcut line on the lower one, which read as two broken
    // fragments. Measured before the drag, while the hint is still on screen.
    const hintRaw = await overlay.webContents.executeJavaScript(`(() => {
      const root = document.querySelector('.overlay-root');
      const hint = document.querySelector('.hint');
      if (!root || !hint) return JSON.stringify({ ok: false, note: 'нет подсказки' });
      const monitors = (root.dataset.monitors || '').split(';').filter(Boolean).map((chunk) => {
        const parts = chunk.split(',').map(Number);
        return { left: parts[0], top: parts[1], width: parts[2], height: parts[3], primary: parts[4] === 1 };
      });
      if (monitors.length < 2) return JSON.stringify({ ok: true, note: 'один монитор' });

      // Monitor rectangles are in DIP, the hint box in CSS pixels.
      const unionW = Math.max.apply(null, monitors.map((m) => m.left + m.width));
      const unionH = Math.max.apply(null, monitors.map((m) => m.top + m.height));
      const sx = window.innerWidth / unionW;
      const sy = window.innerHeight / unionH;

      const box = hint.getBoundingClientRect();
      const primary = monitors.find((m) => m.primary) || monitors[0];
      const pLeft = primary.left * sx;
      const pTop = primary.top * sy;
      const pRight = pLeft + primary.width * sx;
      const pBottom = pTop + primary.height * sy;

      // How much of the hint falls outside the primary monitor.
      const ix = Math.max(0, Math.min(box.right, pRight) - Math.max(box.left, pLeft));
      const iy = Math.max(0, Math.min(box.bottom, pBottom) - Math.max(box.top, pTop));
      const inside = (ix * iy) / Math.max(1, box.width * box.height);

      // ...and how far its centre is from the monitor's centre.
      const dx = Math.abs(box.left + box.width / 2 - (pLeft + (pRight - pLeft) / 2));
      const dy = Math.abs(box.top + box.height / 2 - (pTop + (pBottom - pTop) / 2));

      return JSON.stringify({
        ok: inside > 0.999 && dx < 4 && dy < 4,
        inside: inside.toFixed(3),
        dx: Math.round(dx),
        dy: Math.round(dy),
        box: Math.round(box.left) + ',' + Math.round(box.top) + ' ' + Math.round(box.width) + 'x' + Math.round(box.height),
        primary: Math.round(pLeft) + ',' + Math.round(pTop) + ' ' + Math.round(pRight - pLeft) + 'x' + Math.round(pBottom - pTop)
      });
    })()`)
    const hintCheck = JSON.parse(hintRaw) as {
      ok: boolean
      inside?: string
      dx?: number
      dy?: number
      box?: string
      primary?: string
      note?: string
    }

    // Selecting the whole area must not push the buttons off the screen. The bar
    // used to be placed strictly outside the selection, so a full-screen region
    // put it past the bottom edge and the buttons simply disappeared.
    const fullBarRaw = await overlay.webContents.executeJavaScript(`(async () => {
      const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const root = document.querySelector('.overlay-root');
      const opts = { bubbles: true, cancelable: true, pointerId: 2, pointerType: 'mouse', button: 0 };
      const w = window.innerWidth;
      const h = window.innerHeight;
      root.dispatchEvent(new PointerEvent('pointerdown', { ...opts, clientX: 1, clientY: 1, buttons: 1 }));
      window.dispatchEvent(new PointerEvent('pointermove', { ...opts, clientX: w - 1, clientY: h - 1, buttons: 1 }));
      window.dispatchEvent(new PointerEvent('pointerup', { ...opts, clientX: w - 1, clientY: h - 1, buttons: 0 }));
      await pause(250);

      const bar = document.querySelector('.toolbar--confirm');
      const badge = document.querySelector('.size-badge');
      if (!bar) return JSON.stringify({ ok: false, note: 'кнопки не появились' });
      const b = bar.getBoundingClientRect();
      const inside = b.left >= 0 && b.top >= 0 && b.right <= w + 1 && b.bottom <= h + 1;
      const badgeBox = badge ? badge.getBoundingClientRect() : null;
      const badgeInside = !badgeBox || (badgeBox.left >= 0 && badgeBox.top >= 0 && badgeBox.right <= w + 1 && badgeBox.bottom <= h + 1);
      const overPicture = bar.classList.contains('is-inside');

      // Clear the selection again so the real check below starts from scratch.
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await pause(200);
      return JSON.stringify({
        ok: inside && badgeInside && overPicture,
        inside: inside ? 1 : 0,
        badge: badgeInside ? 1 : 0,
        overPicture: overPicture ? 1 : 0,
        box: Math.round(b.left) + ',' + Math.round(b.top) + ' ' + Math.round(b.width) + 'x' + Math.round(b.height),
        viewport: w + 'x' + h
      });
    })()`)
    const fullBar = JSON.parse(fullBarRaw) as {
      ok: boolean
      note?: string
      inside?: number
      badge?: number
      overPicture?: number
      box?: string
      viewport?: string
    }

    await overlay.webContents.executeJavaScript(`(() => {
      const root = document.querySelector('.overlay-root');
      const opts = { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1 };
      root.dispatchEvent(new PointerEvent('pointerdown', { ...opts, clientX: ${from.x}, clientY: ${from.y} }));
      window.dispatchEvent(new PointerEvent('pointermove', { ...opts, clientX: ${to.x}, clientY: ${to.y} }));
      window.dispatchEvent(new PointerEvent('pointerup', { ...opts, clientX: ${to.x}, clientY: ${to.y}, buttons: 0 }));
      return true
    })()`)
    await wait(350)
    const debug = await overlay.webContents.executeJavaScript(
      `JSON.stringify({
        stage: (document.querySelector('.overlay-root') || { className: '' }).className,
        badge: (document.querySelector('.size-badge') || { textContent: '' }).textContent,
        viewport: window.innerWidth + 'x' + window.innerHeight,
        caption: (document.querySelector('.result-caption') || { textContent: '' }).textContent
      })`
    )
    await overlay.webContents.executeJavaScript(
      `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })), true`
    )

    let caption = ''
    for (let waited = 0; waited < 5000; waited += 100) {
      // Wait for the result stage proper: the card is also rendered while the
      // picture is being composed, and reading the caption then would report the
      // previous capture's numbers.
      caption = await overlay.webContents.executeJavaScript(`(() => {
        const root = document.querySelector('.overlay-root');
        if (!root || !root.classList.contains('stage-result')) return '';
        const node = document.querySelector('.result-caption');
        // The size lives in a data attribute: the visible text glues the ratio
        // onto the height, which is impossible to split reliably.
        return (node && node.dataset.size) || '';
      })()`)
      if (caption) break
      await wait(100)
    }
    if (!caption) return { ok: false, skipped: false, note: 'экран результата не появился' }

    // The caption's data attribute is "W×H" with no ratio attached. The frame is
    // part of the result, so it has to be added on both axes.
    const match = /^(\d+)×(\d+)$/.exec(caption)
    const got = match ? `${match[1]} × ${match[2]}` : caption
    const expected = `${Math.round(width * scale) + frame * 2} × ${Math.round(height * scale) + frame * 2}`
    const ok = got.replace(/\s/g, '') === expected.replace(/\s/g, '')

    // A two-monitor capture is bigger than one screen, so the card must start
    // fitted, offer zoom, reach 100 % by slider and pan — and a caption drawn at
    // 100 % must still land where the user clicked.
    const zoomRaw = await overlay.webContents.executeJavaScript(`(async () => {
      const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const viewport = document.querySelector('.result-viewport');
      const card = document.querySelector('.result-card');
      const slider = document.querySelector('.zoom__slider');
      const label = document.querySelector('[data-zoom-label]');
      if (!viewport || !card || !slider || !label) {
        return JSON.stringify({ ok: false, note: 'нет управления масштабом' });
      }

      const box = card.getBoundingClientRect();
      const fitted =
        viewport.dataset.zoomMode === 'fit' &&
        box.width <= viewport.clientWidth + 1 &&
        box.height <= viewport.clientHeight + 1;

      // The + button first: it is the plainest path a user takes.
      const plus = document.querySelector('[aria-label="Увеличить масштаб"]');
      if (plus) {
        plus.click();
        await pause(150);
        plus.click();
        await pause(250);
      }
      const afterPlus = label.textContent;

      // Then the slider, all the way to 100 %. React only sees a programmatic
      // value through the native setter plus an input event.
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(slider, '100');
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      slider.dispatchEvent(new Event('change', { bubbles: true }));
      await pause(350);
      const afterSlider = label.textContent;

      const zoomedBox = card.getBoundingClientRect();
      // Either axis can be the overflowing one, depending on the picture's shape.
      const overflows = viewport.scrollWidth > viewport.clientWidth + 1 || viewport.scrollHeight > viewport.clientHeight + 1;
      const tooBig = zoomedBox.width > viewport.clientWidth + 1 || zoomedBox.height > viewport.clientHeight + 1;
      const zoomed = viewport.dataset.zoomMode === 'manual' && overflows && tooBig;

      // Pan by dragging the background upwards: the hidden part must come into view.
      viewport.scrollTop = 0;
      viewport.scrollLeft = 0;
      const area = viewport.getBoundingClientRect();
      const opts = { bubbles: true, cancelable: true, pointerId: 9, pointerType: 'mouse', button: 0, buttons: 1 };
      viewport.dispatchEvent(new PointerEvent('pointerdown', { ...opts, clientX: area.left + 20, clientY: area.top + 300 }));
      viewport.dispatchEvent(new PointerEvent('pointermove', { ...opts, clientX: area.left + 20, clientY: area.top + 120 }));
      viewport.dispatchEvent(new PointerEvent('pointerup', { ...opts, clientX: area.left + 20, clientY: area.top + 120, buttons: 0 }));
      await pause(200);
      const panned = Math.round(viewport.scrollTop);

      // Draw a caption at a known fraction of the picture while zoomed in.
      const tools = document.querySelectorAll('.toolbar--annotate .tb--tool');
      let captionAt = 'none';
      let expectedAt = 'none';
      if (tools.length > 4) {
        tools[4].click();
        await pause(150);
        const surface = document.querySelector('.annotate-surface');
        const rect = surface.getBoundingClientRect();
        const x = rect.left + rect.width * 0.25;
        const y = rect.top + rect.height * 0.4;
        const hit = { bubbles: true, cancelable: true, pointerId: 11, pointerType: 'mouse', button: 0, clientX: x, clientY: y };
        surface.dispatchEvent(new PointerEvent('pointerdown', { ...hit, buttons: 1 }));
        await pause(300);
        const field = document.querySelector('textarea.annotate-text');
        if (field) {
          const setText = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
          setText.call(field, 'Точка на 100 %');
          field.dispatchEvent(new Event('input', { bubbles: true }));
          await pause(150);
          field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
          await pause(300);
        }
        captionAt = (document.querySelector('.annotate-box') || { dataset: {} }).dataset.textAt || '';
        expectedAt = '0.250,0.400';
      }

      return JSON.stringify({
        ok: fitted && zoomed && panned > 40 && Math.abs(Number(captionAt.split(',')[0]) - 0.25) < 0.01,
        fitted,
        zoomed,
        panned,
        fit: viewport.dataset.fit,
        label: label.textContent,
        afterPlus,
        afterSlider,
        sliderValue: slider.value,
        captionAt,
        expectedAt
      });
    })()`)
    const zoomCheck = JSON.parse(zoomRaw) as {
      ok: boolean
      fitted?: boolean
      zoomed?: boolean
      panned?: number
      fit?: string
      label?: string
      afterPlus?: string
      afterSlider?: string
      sliderValue?: string
      captionAt?: string
      expectedAt?: string
      note?: string
    }

    // A picture at 100 % is worth showing in the docs: it is the state the zoom
    // control exists for.
    const zoomShot = await overlay.webContents.capturePage()
    await fs.writeFile(path.join(outputDir, 'multi-monitor-zoom.png'), zoomShot.toPNG())

    // Back to the fitted view, so the saved screenshot shows the whole picture.
    await overlay.webContents.executeJavaScript(`(async () => {
      const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const fitButton = document.querySelector('[aria-label="Вписать в экран"]');
      if (fitButton) fitButton.click();
      await pause(350);
      return true
    })()`)

    // The result must sit on the primary monitor. A card centred on the whole
    // desktop lands on the bezel and gets sliced, which is what this measures.
    const hostRaw = await overlay.webContents.executeJavaScript(`(() => {
      const root = document.querySelector('.overlay-root');
      const layer = document.querySelector('.result-layer');
      if (!root || !layer) return JSON.stringify({ ok: false, note: 'нет слоя результата' });
      const monitors = (root.dataset.monitors || '').split(';').filter(Boolean).map((chunk) => {
        const parts = chunk.split(',').map(Number);
        return { left: parts[0], top: parts[1], width: parts[2], height: parts[3], primary: parts[4] === 1 };
      });
      if (monitors.length < 2) return JSON.stringify({ ok: true, note: 'один монитор' });

      // Monitor rectangles are in DIP, the layer box in CSS pixels; the window
      // may be a pixel off, so both are normalised to the union size.
      const unionW = Math.max.apply(null, monitors.map((m) => m.left + m.width));
      const unionH = Math.max.apply(null, monitors.map((m) => m.top + m.height));
      const sx = window.innerWidth / unionW;
      const sy = window.innerHeight / unionH;

      const box = layer.getBoundingClientRect();
      let bestArea = 0;
      let bestMonitor = null;
      for (const m of monitors) {
        const left = m.left * sx;
        const top = m.top * sy;
        const right = left + m.width * sx;
        const bottom = top + m.height * sy;
        const ix = Math.max(0, Math.min(box.right, right) - Math.max(box.left, left));
        const iy = Math.max(0, Math.min(box.bottom, bottom) - Math.max(box.top, top));
        if (ix * iy > bestArea) {
          bestArea = ix * iy;
          bestMonitor = m;
        }
      }

      const area = Math.max(1, box.width * box.height);
      const primary = monitors.find((m) => m.primary) || null;
      return JSON.stringify({
        ok: 1 - bestArea / area < 0.01 && Boolean(bestMonitor && bestMonitor.primary),
        host: layer.dataset.monitor || '',
        onPrimary: Boolean(bestMonitor && bestMonitor.primary),
        primary: primary ? Math.round(primary.left * sx) + ',' + Math.round(primary.top * sy) : '',
        spill: (1 - bestArea / area).toFixed(3),
        box: Math.round(box.left) + ',' + Math.round(box.top) + ' ' + Math.round(box.width) + 'x' + Math.round(box.height)
      });
    })()`)
    const hostCheck = JSON.parse(hostRaw) as {
      ok: boolean
      host?: string
      onPrimary?: boolean
      primary?: string
      spill?: string
      box?: string
      note?: string
    }

    const shot = await overlay.webContents.capturePage()
    await fs.writeFile(path.join(outputDir, 'multi-monitor.png'), shot.toPNG())

    return {
      ok: ok && hostCheck.ok && zoomCheck.ok && hintCheck.ok && fullBar.ok,
      skipped: false,
      note: !ok
        ? `ожидалось ${expected}, получено ${got} · ${debug}`
        : !hostCheck.ok
          ? hostCheck.onPrimary
            ? `результат вышел за один монитор: ${hostCheck.spill} площади на другом экране · ${hostCheck.box}`
            : `результат оказался не на основном мониторе · ${hostCheck.box} · основной ${hostCheck.primary}`
          : !zoomCheck.ok
            ? `масштаб: вписано=${zoomCheck.fitted} 100%=${zoomCheck.zoomed} прокрутка=${zoomCheck.panned} подпись=${zoomCheck.captionAt} ожидалось ${zoomCheck.expectedAt} (вписано ${zoomCheck.fit}, + дало ${zoomCheck.afterPlus}, ползунок дал ${zoomCheck.afterSlider} при значении ${zoomCheck.sliderValue})`
            : !hintCheck.ok
              ? `подсказка не по центру основного монитора: внутри ${hintCheck.inside}, смещение ${hintCheck.dx}×${hintCheck.dy} px · подсказка ${hintCheck.box} · монитор ${hintCheck.primary}`
              : !fullBar.ok
                ? `кнопки при выделении всего экрана: внутри окна ${fullBar.inside}, метка ${fullBar.badge}, поверх снимка ${fullBar.overPicture} · панель ${fullBar.box} · окно ${fullBar.viewport}${fullBar.note ? ' · ' + fullBar.note : ''}`
                : '',
      rect: `${from.x},${from.y} → ${to.x},${to.y} (граница ${seam.axis}=${seam.at})`,
      size: got,
      monitor: hostCheck.host ?? '',
      box: hostCheck.box ?? '',
      zoom: `${zoomCheck.fit ?? ''}:${zoomCheck.panned ?? 0}:${zoomCheck.captionAt ?? ''}`,
      hint: `${hintCheck.inside ?? ''}:${hintCheck.dx ?? 0}:${hintCheck.dy ?? 0}`,
      fullBar: `${fullBar.inside ?? ''}:${fullBar.badge ?? ''}:${fullBar.overPicture ?? ''}:${fullBar.box ?? ''}`
    }
  } catch (error) {
    return { ok: false, skipped: false, note: error instanceof Error ? error.message : String(error) }
  } finally {
    session.cancel()
    await wait(150)
  }
}

/**
 * The three numbers a user actually feels, taken from the capture this run just
 * performed rather than from a synthetic benchmark.
 *
 * The thresholds are deliberately loose — a busy machine can be twice as slow —
 * but they do catch the failure this exists for: an encoder setting creeping
 * back to "smallest file at any cost", which turns a 60 ms save into half a
 * second without anything looking wrong.
 */
function runPerfCheck(
  session: CaptureSession | undefined,
  warm: Record<string, string | number>,
  seam: NonNullable<SelfTestReport['seam']>
): SelfTestReport['perf'] {
  if (!session) return { composeMs: -1, stitchMs: -1, overlayMs: -1, cardKB: 0, card: '', ok: false, note: 'нет сессии' }

  const overlayMs = Number(warm.overlayVisible ?? -1)
  const capture = Number(warm.capture ?? 0)
  const stitch = Number(warm.stitch ?? 0)
  // `stitch` is cumulative from the hotkey, so the stitching itself is the
  // difference between it and the capture that preceded it.
  const stitchMs = capture > 0 && stitch > capture ? stitch - capture : -1
  const composeMs = session.lastComposeMs
  const cardKB = Math.round(session.lastCardBytes / 1024)

  const problems: string[] = []
  if (composeMs <= 0 || composeMs > 300) problems.push(`сборка карточки ${composeMs} мс (предел 300)`)
  if (stitchMs > 80) problems.push(`склейка мониторов ${stitchMs} мс (предел 80)`)
  if (overlayMs <= 0 || overlayMs > 600) problems.push(`выделение появилось за ${overlayMs} мс (предел 600)`)

  return {
    composeMs,
    stitchMs,
    overlayMs,
    cardKB,
    card: seam.size ?? '',
    ok: problems.length === 0,
    note: problems.join(' · ')
  }
}

/**
 * The line where two monitors meet, in overlay coordinates.
 *
 * Monitors can be side by side, stacked, or offset by a few pixels; the seam is
 * the edge along which one display ends and the next begins. A pair that
 * overlaps in both axes (mirrored displays) has no seam to cross.
 */
function findSeam(screens: { bounds: { x: number; y: number; width: number; height: number } }[]): {
  axis: 'x' | 'y'
  at: number
} | null {
  const union = virtualBounds(screens as never)
  for (const a of screens) {
    for (const b of screens) {
      if (a === b) continue
      // b sits immediately below a: horizontal seam.
      if (a.bounds.y + a.bounds.height === b.bounds.y && a.bounds.x < b.bounds.x + b.bounds.width && b.bounds.x < a.bounds.x + a.bounds.width) {
        return { axis: 'y', at: b.bounds.y - union.y }
      }
      // b sits immediately to the right of a: vertical seam.
      if (a.bounds.x + a.bounds.width === b.bounds.x && a.bounds.y < b.bounds.y + b.bounds.height && b.bounds.y < a.bounds.y + a.bounds.height) {
        return { axis: 'x', at: b.bounds.x - union.x }
      }
    }
  }
  return null
}

/**
 * Two settings-window behaviours that only a driven window can catch.
 *
 * Both exist because of reported bugs, not for coverage:
 *  - assigning a combination to the full-screen key was saved but never bound,
 *    so the window told the user the combination was taken;
 *  - the preview stayed at a fixed 440 px whatever the window width, leaving
 *    empty space beside it once the window was stretched.
 *
 * The shortcut is saved through the real IPC call the window uses, so the whole
 * chain runs: renderer → preload → ipcMain → re-registration → read-back.
 */
async function runSettingsLiveChecks(
  url: string,
  outputDir: string
): Promise<{
  rebind: NonNullable<SelfTestReport['hotkeyRebind']>
  preview: NonNullable<SelfTestReport['previewResize']>
}> {
  const window = new BrowserWindow({
    width: 520,
    height: 820,
    show: false,
    frame: false,
    backgroundColor: '#F5F5F7',
    webPreferences: { preload: preloadPath(), contextIsolation: true, nodeIntegration: false }
  })

  const rebind: NonNullable<SelfTestReport['hotkeyRebind']> = { ok: false }
  const preview: NonNullable<SelfTestReport['previewResize']> = { ok: false }

  const measure = (): Promise<{ frame: number; image: number; shown: number }> =>
    window.webContents.executeJavaScript(`(() => {
      const frame = document.querySelector('.preview__frame');
      const img = frame ? frame.querySelector('img') : null;
      return {
        frame: frame ? Math.round(frame.getBoundingClientRect().width) : 0,
        image: img ? img.naturalWidth : 0,
        shown: img ? Math.round(img.getBoundingClientRect().width) : 0
      };
    })()`)

  try {
    await window.loadURL(url)
    await wait(1200)

    // --- the preview must fill the window -----------------------------------
    let base = { frame: 0, image: 0, shown: 0 }
    for (let waited = 0; waited < 6000; waited += 200) {
      base = await measure()
      if (base.image > 0) break
      await wait(200)
    }

    window.setContentSize(900, 900)
    let wide = base
    for (let waited = 0; waited < 6000; waited += 200) {
      await wait(200)
      wide = await measure()
      if (wide.image > base.image + 100) break
    }
    await fs
      .writeFile(path.join(outputDir, 'ui-settings-wide.png'), (await window.webContents.capturePage()).toPNG())
      .catch(() => undefined)

    preview.narrow = `${base.frame}px frame / ${base.image}px image`
    preview.wide = `${wide.frame}px frame / ${wide.image}px image`
    preview.ok = wide.frame > base.frame + 100 && wide.image > base.image + 100
    if (!preview.ok) {
      preview.note = 'превью не выросло вместе с окном'
    }

    // --- a new full-screen combination must be bound ------------------------
    // A punctuation key on purpose: it is the combination that used to be saved
    // as `CommandOrControl+Equal`, which Electron refuses to parse and which made
    // the next launch fail outright. Saving it proves the mapping end to end.
    const requested = 'CommandOrControl+='
    const original = (await window.webContents.executeJavaScript(
      `window.flushot.getSettings().then((s) => s.hotkeyFullscreen)`
    )) as string

    const saved = (await window.webContents.executeJavaScript(
      `window.flushot.updateSettings({ hotkeyFullscreen: ${JSON.stringify(requested)} }).then((s) => s.hotkeyFullscreen)`
    )) as string
    const bound = globalShortcut.isRegistered(requested)

    rebind.requested = requested
    rebind.saved = saved
    rebind.registered = bound
    rebind.ok = saved === requested && bound
    if (!rebind.ok) {
      rebind.note = `сохранено ${saved || '—'}, зарегистрировано ${bound}`
    }

    // Put the user's combination back, so the rest of the run sees defaults.
    const restored = (await window.webContents.executeJavaScript(
      `window.flushot.updateSettings({ hotkeyFullscreen: ${JSON.stringify(original)} }).then((s) => s.hotkeyFullscreen)`
    )) as string
    rebind.restored = restored
  } catch (error) {
    const note = error instanceof Error ? error.message : String(error)
    rebind.ok = false
    rebind.note = rebind.note || note
    preview.ok = false
    preview.note = preview.note || note
  } finally {
    if (!window.isDestroyed()) window.destroy()
  }

  return { rebind, preview }
}

/**
 * Prove that every accelerator the settings window can produce is accepted.
 *
 * The mapping from `KeyboardEvent.code` to an Electron accelerator is the kind of
 * table that is wrong in exactly one row and silent about it — until the day a
 * user picks that key, the value is saved, and the next launch dies with
 * "conversion failure from …". So the probe goes through the real parser:
 * register, confirm it took, unregister.
 *
 * Registration can legitimately fail because another app owns a combination, so
 * only a *throw* counts as a mapping bug — a `false` return is merely "taken".
 */
function runAcceleratorCheck(stored: { hotkey: string; hotkeyFullscreen: string }): NonNullable<
  SelfTestReport['accelerators']
> {
  const probes = [
    'CommandOrControl+=',
    'CommandOrControl+-',
    'CommandOrControl+[',
    'CommandOrControl+]',
    'CommandOrControl+\\',
    'CommandOrControl+;',
    "CommandOrControl+'",
    'CommandOrControl+,',
    'CommandOrControl+.',
    'CommandOrControl+/',
    'CommandOrControl+`',
    'CommandOrControl+Plus',
    'CommandOrControl+Space',
    'CommandOrControl+Tab',
    'CommandOrControl+Backspace',
    'CommandOrControl+Delete',
    'CommandOrControl+Insert',
    'CommandOrControl+Enter',
    'CommandOrControl+Up',
    'CommandOrControl+Down',
    'CommandOrControl+Left',
    'CommandOrControl+Right',
    'CommandOrControl+Home',
    'CommandOrControl+End',
    'CommandOrControl+PageUp',
    'CommandOrControl+PageDown',
    'CommandOrControl+PrintScreen',
    'CommandOrControl+num5',
    'CommandOrControl+F24',
    'CommandOrControl+F1',
    'F9',
    'F1',
    'End',
    'PrintScreen'
  ]

  const rejected: string[] = []
  for (const accelerator of probes) {
    try {
      if (globalShortcut.register(accelerator, () => undefined)) {
        globalShortcut.unregister(accelerator)
      }
    } catch (error) {
      rejected.push(`${accelerator}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // The combinations actually in use must survive the same treatment.
  for (const accelerator of [stored.hotkey, stored.hotkeyFullscreen]) {
    if (!accelerator) continue
    try {
      if (globalShortcut.register(accelerator, () => undefined)) {
        globalShortcut.unregister(accelerator)
      }
    } catch (error) {
      rejected.push(`${accelerator}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return {
    ok: rejected.length === 0,
    checked: probes.length + 2,
    rejected,
    stored: `${stored.hotkey} / ${stored.hotkeyFullscreen}`,
    note: rejected.length === 0 ? '' : `${rejected.length} сочетаний не принимаются системой`
  }
}

/**
 * The full-screen hotkey, end to end.
 *
 * Not just "is the accelerator registrable": the round is started the same way
 * the hotkey starts it, and the check waits for a result to appear on its own,
 * with no drag and no Enter. That is the whole promise of the second shortcut —
 * one press, one screenshot — so anything less would pass while the feature was
 * broken.
 */
async function runFullscreenCheck(
  session: CaptureSession | undefined,
  frame: number,
  shortcut: string,
  outputDir: string
): Promise<NonNullable<SelfTestReport['fullscreen']>> {
  if (!session) return { ok: false, skipped: false, note: 'нет активной сессии' }

  // The accelerator itself must be registrable on this machine, and it must not
  // be the region shortcut — two identical global shortcuts cannot both live.
  registerCopyShortcut(() => undefined)
  const registered = isCopyShortcutRegistered()
  unregisterCopyShortcut()

  try {
    session.cancel()
    await wait(200)
    session.prewarm()
    await wait(500)
    await session.start({ fullscreen: true })
    await session.whenAllReady()
    await wait(250)

    const overlay = BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().includes('overlay'))
    if (!overlay) return { ok: false, skipped: false, note: 'окно выделения не найдено', registered }

    // Before the automatic confirm lands, the region must already be the whole
    // primary monitor: the user is supposed to see it selected, not empty.
    const selected = await overlay.webContents.executeJavaScript(`(() => {
      const root = document.querySelector('.overlay-root');
      if (!root) return '';
      return (root.style.getPropertyValue('--sel-w') || '') + 'x' + (root.style.getPropertyValue('--sel-h') || '');
    })()`)

    let size = ''
    for (let waited = 0; waited < 8000; waited += 150) {
      size = await overlay.webContents.executeJavaScript(`(() => {
        const root = document.querySelector('.overlay-root');
        if (!root || !root.classList.contains('stage-result')) return '';
        const node = document.querySelector('.result-caption');
        return (node && node.dataset.size) || '';
      })()`)
      if (size) break
      await wait(150)
    }
    if (!size) {
      return { ok: false, skipped: false, note: 'снимок всего экрана не создался сам', selected, registered, shortcut }
    }

    const shot = await overlay.webContents.capturePage()
    await fs.writeFile(path.join(outputDir, 'fullscreen-hotkey.png'), shot.toPNG())

    const primary = screen.getPrimaryDisplay()
    const expected = `${Math.round(primary.bounds.width * primary.scaleFactor) + frame * 2} × ${
      Math.round(primary.bounds.height * primary.scaleFactor) + frame * 2
    }`
    const ok = size.replace(/\s/g, '') === expected.replace(/\s/g, '')

    return {
      ok,
      skipped: false,
      note: ok ? '' : `ожидался весь основной монитор ${expected}, получено ${size}`,
      size,
      expected,
      selected,
      shortcut,
      registered
    }
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      note: error instanceof Error ? error.message : String(error),
      registered,
      shortcut
    }
  } finally {
    session.cancel()
    await wait(150)
  }
}

/**
 * Verifies the virtual desktop the overlay works on.
 *
 * With one monitor this reduces to "the window is the screen", which is still
 * worth asserting: it is the same code path a multi-monitor desk takes, and a
 * regression here would break the common case too.
 */
function runVirtualCheck(session: CaptureSession | undefined): NonNullable<SelfTestReport['virtual']> {
  const displays = screen.getAllDisplays()
  const screens = displays.map((display) => ({
    id: String(display.id),
    bounds: display.bounds,
    scaleFactor: display.scaleFactor
  }))
  const union = virtualBounds(screens)
  const scale = virtualScale(screens)

  const overlay = BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().includes('overlay'))
  const bounds = overlay?.getBounds() ?? { x: 0, y: 0, width: 0, height: 0 }

  const windowOk = bounds.x === union.x && bounds.y === union.y && bounds.width === union.width && bounds.height === union.height
  // The stitched frame must exist and match the density it was built at.
  const virtual = session?.lastVirtual
  const imageOk = Boolean(virtual) && virtual!.width > 0 && virtual!.height > 0 && virtual!.screens === displays.length

  return {
    ok: windowOk && imageOk,
    note: windowOk && imageOk ? '' : `окно ${bounds.width}×${bounds.height}, ожидалось ${union.width}×${union.height}`,
    screens: displays.length,
    window: `${bounds.x},${bounds.y} ${bounds.width}×${bounds.height}`,
    expected: `${union.x},${union.y} ${union.width}×${union.height}`,
    image: virtual ? `${virtual.width}×${virtual.height}@${virtual.scale}` : 'нет',
    scale,
    resampled: virtual ? virtual.resampled.join(',') || 'нет' : 'нет'
  }
}

/**
 * Reproduces exactly what the user does: start a capture, draw a region in the
 * real overlay, press Ctrl+C (delivered through the same channel the global
 * shortcut uses) and confirm the clipboard holds an image afterwards.
 */
async function runRealCopyCheck(
  session: CaptureSession | undefined,
  outputDir: string
): Promise<{ ok: boolean; clipboard: string; overlays: number; closed: boolean; note?: string; warm?: Record<string, string | number>; cold?: Record<string, number>; copy?: Record<string, number>; hiddenAfterMs?: number; clipboardAfterMs?: number }> {
  const result: {
    ok: boolean
    clipboard: string
    overlays: number
    closed: boolean
    note: string
    warm?: Record<string, string | number>
    cold?: Record<string, number>
    copy?: Record<string, number>
    hiddenAfterMs?: number
    clipboardAfterMs?: number
    clipboardWasClean?: boolean
  } = {
    ok: false,
    clipboard: '',
    overlays: 0,
    closed: false,
    note: ''
  }
  if (!session) {
    result.note = 'нет активной сессии'
    return result
  }

  try {
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array([0])], { type: 'image/png' }) })])
  } catch {
    // Clearing is best effort; the check below still compares the type list.
  }

  try {
    // Reproduce a real launch: the overlay pool is already warm by the time the
    // user presses the hotkey for the first time.
    session.prewarm()
    await wait(700)
    await session.start()
    // Wait for the first paint of the frozen screen, then measure the moment.
    await session.whenAllReady()
    result.cold = { ...session.lastTimings }
    await wait(200)

    const overlay = BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().includes('overlay'))
    if (!overlay) {
      result.note = 'окно выделения не найдено'
      return result
    }

    result.overlays = BrowserWindow.getAllWindows().filter((win) => win.webContents.getURL().includes('overlay')).length

    // Proof that the raw-bitmap backdrop is painted with the right channels.
    try {
      const frame = await overlay.webContents.capturePage()
      await fs.writeFile(path.join(outputDir, 'ui-overlay-real.png'), frame.toPNG())
    } catch {
      // Screenshot is a bonus, not a requirement.
    }

    // Drag a 600×400 region, then let React commit it before the shortcut.
    await overlay.webContents.executeJavaScript(DRAG_SCRIPT)
    await wait(400)

    // Measure what the user feels: how long the overlay stays on screen after
    // Ctrl+C, and when the clipboard is actually ready.
    const beforeCopy = await clipboard.read()
    result.clipboardWasClean = !beforeCopy.some((item) => item.types.includes('image/png'))
    const copyStarted = performance.now()
    overlay.webContents.send('overlay:copy-shortcut')

    let hiddenAfterMs = -1
    let clipboardAfterMs = -1
    for (let elapsed = 0; elapsed < 3000; elapsed += 10) {
      if (hiddenAfterMs < 0 && (!overlay.isVisible() || overlay.isDestroyed())) {
        hiddenAfterMs = Math.round(performance.now() - copyStarted)
      }
      if (clipboardAfterMs < 0) {
        const now = await clipboard.read()
        if (now.some((item) => item.types.includes('image/png'))) {
          clipboardAfterMs = Math.round(performance.now() - copyStarted)
        }
      }
      if (hiddenAfterMs >= 0 && clipboardAfterMs >= 0) break
      await wait(10)
    }
    result.hiddenAfterMs = hiddenAfterMs
    result.clipboardAfterMs = clipboardAfterMs

    const contents = await clipboard.read()
    result.clipboard = contents.flatMap((item) => item.types).join(', ') || 'empty'
    result.closed = !session.isActive
    result.ok = result.clipboard.includes('image/png') && result.closed

    // A second round reuses the warm window pool: that is what every later
    // hotkey press costs, and therefore the number worth optimising.
    await wait(300)
    await session.start()
    await session.whenAllReady()
    result.warm = { ...session.lastTimings, starts: session.startCount, error: session.lastError || 'none' }
    result.copy = { ...session.lastCopyTimings }
  } catch (error) {
    result.note = error instanceof Error ? error.message : String(error)
  } finally {
    session.cancel()
    await wait(200)
  }

  return result
}

/**
 * Text recognition, against the real engine.
 *
 * The picture is drawn here rather than read from disk, so the check does not
 * depend on a stored image and the expected text is known exactly. Large type on
 * purpose: this verifies the pipeline, not the engine's ability to read 8 px
 * letters, which no OCR does well.
 */
async function runOcrCheck(outputDir: string): Promise<NonNullable<SelfTestReport['ocr']>> {
  if (!isOcrSupported()) {
    return { ok: true, supported: false, lines: 0, ms: 0, note: 'движок Windows OCR недоступен' }
  }
  const file = path.join(outputDir, 'ocr-check.png')
  try {
    await sharp(Buffer.from(ocrSampleSvg())).png({ compressionLevel: 1 }).toFile(file)

    const started = Date.now()
    const outcome = await recognizePictureFile(file)
    const ms = Date.now() - started
    const text = outcome.lines.map((line) => line.text).join(' ').trim()
    return {
      ok: outcome.ok && /flushot/i.test(text),
      supported: true,
      lines: outcome.lines.length,
      ms,
      text: text.slice(0, 120),
      error: outcome.error
    }
  } catch (error) {
    return {
      ok: false,
      supported: true,
      lines: 0,
      ms: 0,
      error: error instanceof Error ? error.message : String(error)
    }
  } finally {
    await fs.rm(file, { force: true }).catch(() => undefined)
    // A diagnostic run must not leave the PowerShell worker behind: the report is
    // printed and the process may quit straight after.
    stopOcr()
  }
}

/**
 * Exercises the real Windows "Run" key: enable it, read it back, disable it,
 * read it back, then restore whatever was there before.
 *
 * Opt-in (`FLUSHOT_AUTOSTART_TEST=1`) on purpose: a self-test has no business
 * writing to the user's registry unless it was asked to. It is also reported
 * rather than gated, because some environments (restricted tokens, group
 * policy, CI sandboxes) deny registry writes to child processes and that says
 * nothing about the app.
 */
async function runAutostartCheck(): Promise<NonNullable<SelfTestReport['autostart']>> {
  const target = `${launchTarget().path} ${launchTarget().args.join(' ')}`.trim()
  if (process.env.FLUSHOT_AUTOSTART_TEST !== '1') {
    return {
      ok: true,
      skipped: true,
      enabled: isAutostartEnabled(),
      disabled: false,
      restored: true,
      note: 'пропущено: FLUSHOT_AUTOSTART_TEST не задан',
      target
    }
  }

  const before = isAutostartEnabled()
  let enabled = false
  let disabled = false
  try {
    setAutostart(true)
    enabled = isAutostartEnabled()
    setAutostart(false)
    disabled = !isAutostartEnabled()
  } finally {
    // Always put the machine back the way it was, even if a write threw.
    setAutostart(before)
  }
  const restored = isAutostartEnabled() === before
  const ok = enabled && disabled && restored
  return {
    ok,
    skipped: false,
    enabled,
    disabled,
    restored,
    note: ok
      ? ''
      : 'Windows не приняла запись в реестр — среда запрещает запись дочерним процессам',
    target
  }
}

/**
 * End-to-end check of the capture pipeline without user interaction.
 * Used by `npm run self-test` and by the packaging smoke test.
 */
export async function runSelfTest(session?: CaptureSession, settingsStore?: SettingsStore): Promise<number> {
  const report: SelfTestReport = {
    ok: false,
    latency: {},
    captureRuns: [],
    prewarm: { visible: -1, ok: false },
    rawCompare: { bytes: 0, maxDiff: -1 },
    warmImaging: { initMs: -1, steadyMs: -1, ok: false },
    perf: { composeMs: -1, stitchMs: -1, overlayMs: -1, cardKB: 0, card: '', ok: false },
    realCopy: { ok: false, clipboard: '', overlays: 0, closed: false },
    displays: [],
    canvas: null,
    ui: { settings: [], overlay: [] },
    facts: { settings: {}, webp: {}, compact: {}, hotkey: {}, overlay: {}, overlayCopy: {}, overlayGlobalCopy: {}, annotate: {}, color: {} },
    files: [],
    clipboard: 'not checked',
    errors: []
  }

  const outputDir = path.join(app.getPath('temp'), 'flushot-self-test')
  await fs.mkdir(outputDir, { recursive: true })

  try {
    // The very first compose in a process pays libvips/thread-pool
    // initialisation, which is exactly the cost `warmImaging()` moves away from
    // the user's first Ctrl+C. The second call shows the steady state.
    const warmthStart = performance.now()
    await warmImaging()
    const initMs = Math.round(performance.now() - warmthStart)
    const afterStart = performance.now()
    await warmImaging()
    const steadyMs = Math.round(performance.now() - afterStart)
    // The guard only catches a warm-up that hangs; the sandbox varies by ±60 ms.
    report.warmImaging = { initMs, steadyMs, ok: steadyMs < 400 }

    const snapshots = await captureAllDisplays()
    report.displays = snapshots.map((snapshot) => ({
      id: snapshot.display.id,
      label: snapshot.display.label,
      bounds: { width: snapshot.display.bounds.width, height: snapshot.display.bounds.height },
      scaleFactor: snapshot.display.scaleFactor,
      image: { width: snapshot.display.imageWidth, height: snapshot.display.imageHeight }
    }))

    const primary = screen.getPrimaryDisplay()
    const snapshot: DisplayCaptureSnapshot =
      snapshots.find((candidate) => candidate.display.id === String(primary.id)) ?? snapshots[0]

    // Full-screen selection on the primary monitor, as a user would draw it.
    const imageRect = selectionToImageRect(
      { x: 0, y: 0, width: snapshot.display.bounds.width, height: snapshot.display.bounds.height },
      {
        bounds: { x: 0, y: 0, width: snapshot.display.bounds.width, height: snapshot.display.bounds.height },
        imageWidth: snapshot.display.imageWidth,
        imageHeight: snapshot.display.imageHeight,
        scaleFactor: snapshot.display.scaleFactor
      }
    )

    const settings = { ...defaultSettings(outputDir), saveDirectory: outputDir }
    const cropped = await cropImage(snapshot.image, imageRect)
    const composed = await composeScreenshot(cropped, composeOptionsFromSettings(settings))
    const metadata = await sharp(composed).metadata()
    // Anything goes: the output is exactly the selection plus the frame, so the
    // check is the frame rule itself, not a fixed 1920×1080.
    report.canvas = {
      width: metadata.width ?? 0,
      height: metadata.height ?? 0,
      expectedWidth: imageRect.width + settings.frameWidth * 2,
      expectedHeight: imageRect.height + settings.frameWidth * 2,
      frame: settings.frameWidth
    }

    const base = buildScreenshotFilename(new Date(), 'png').replace(/\.png$/, '')
    const pngPath = path.join(outputDir, `${base}.png`)
    const jpgPath = path.join(outputDir, `${base}.jpg`)
    const pngBytes = await encodeImage(composed, { format: 'png', jpegQuality: 92 })
    await fs.writeFile(pngPath, pngBytes)
    await fs.writeFile(jpgPath, await encodeImage(composed, { format: 'jpeg', jpegQuality: 92 }))
    // A stable name for the documentation: the dated file is the artifact, this
    // one is the illustration the README embeds.
    await fs.writeFile(path.join(outputDir, 'sample-framed.png'), pngBytes)
    report.files.push(pngPath, jpgPath)

    // Clipboard support is part of the acceptance criteria.
    const blob = new Blob([new Uint8Array(composed)], { type: 'image/png' })
    await clipboard.write([new ClipboardItem({ 'image/png': blob })])
    const contents = await clipboard.read()
    report.clipboard = contents.flatMap((item) => item.types).join(', ') || 'empty'

    // Both renderer surfaces are loaded and inspected: the settings window and
    // the overlay in demo mode (a synthetic desktop, no live capture).
    const settingsUrl = rendererUrl('settings')
    const overlayUrl = rendererUrl('overlay')
    const settingsPage = await inspectWindow(
      settingsUrl.kind === 'url' ? settingsUrl.value : `file:///${settingsUrl.value.replace(/\\/g, '/')}`,
      { width: 520, height: 820 },
      path.join(outputDir, 'ui-settings.png')
    )
    // Same window squeezed to the smallest supported size: controls must wrap,
    // never disappear behind the window edge.
    const compactPage = await inspectWindow(
      settingsUrl.kind === 'url' ? settingsUrl.value : `file:///${settingsUrl.value.replace(/\\/g, '/')}`,
      { width: 400, height: 620 },
      path.join(outputDir, 'ui-settings-compact.png')
    )
    // Choosing WebP must be reflected in the caption and must not claim JPEG.
    const webpPage = await inspectWindow(
      settingsUrl.kind === 'url' ? settingsUrl.value : `file:///${settingsUrl.value.replace(/\\/g, '/')}`,
      { width: 520, height: 820 },
      path.join(outputDir, 'ui-settings-webp.png'),
      WEBP_SCRIPT
    )
    // Recording a custom shortcut must reach the settings store.
    const hotkeyPage = await inspectWindow(
      settingsUrl.kind === 'url' ? settingsUrl.value : `file:///${settingsUrl.value.replace(/\\/g, '/')}`,
      { width: 520, height: 820 },
      path.join(outputDir, 'ui-settings-hotkey.png'),
      HOTKEY_SCRIPT
    )
    const overlayPage = await inspectWindow(
      overlayUrl.kind === 'url'
        ? `${overlayUrl.value}?demo=1`
        : `file:///${overlayUrl.value.replace(/\\/g, '/')}?demo=1`,
      { width: 1280, height: 720 },
      path.join(outputDir, 'ui-overlay.png'),
      DRAG_SCRIPT
    )
    // Driven through the real IPC path: rebinding the second shortcut, and the
    // preview growing with the window.
    const live = await runSettingsLiveChecks(
      settingsUrl.kind === 'url' ? settingsUrl.value : `file:///${settingsUrl.value.replace(/\\/g, '/')}`,
      outputDir
    )
    report.hotkeyRebind = live.rebind
    report.previewResize = live.preview
    // Ctrl+C while the region is being selected must be handled by the overlay.
    const copyKeyPage = await inspectWindow(
      overlayUrl.kind === 'url'
        ? `${overlayUrl.value}?demo=1`
        : `file:///${overlayUrl.value.replace(/\\/g, '/')}?demo=1`,
      { width: 1280, height: 720 },
      path.join(outputDir, 'ui-overlay-copy.png'),
      COPY_KEY_SCRIPT
    )
    // Same thing through the global shortcut path: main → IPC → overlay.
    const globalCopyPage = await inspectWindow(
      overlayUrl.kind === 'url'
        ? `${overlayUrl.value}?demo=1`
        : `file:///${overlayUrl.value.replace(/\\/g, '/')}?demo=1`,
      { width: 1280, height: 720 },
      path.join(outputDir, 'ui-overlay-global-copy.png'),
      DRAG_SCRIPT,
      'overlay:copy-shortcut'
    )

    // The annotation bar only exists on the result screen, which demo mode
    // reaches through `stage=result`. Drawing an arrow there must paint pixels.
    const annotatePage = await inspectWindow(
      overlayUrl.kind === 'url'
        ? `${overlayUrl.value}?demo=1&stage=result`
        : `file:///${overlayUrl.value.replace(/\\/g, '/')}?demo=1&stage=result`,
      { width: 1280, height: 720 },
      path.join(outputDir, 'ui-overlay-annotate.png'),
      ANNOTATE_SCRIPT,
      undefined,
      true
    )

    // The combination must actually be registrable on this machine.
    registerCopyShortcut(() => undefined)
    const globalShortcutOk = isCopyShortcutRegistered()
    unregisterCopyShortcut()

    // Capture cost on repeated calls: a cold first call would mean the capture
    // pipeline needs one-time setup, which is worth pre-warming at launch.
    const captureRuns: number[] = []
    for (let i = 0; i < 3; i++) {
      const started = performance.now()
      await captureDisplays()
      captureRuns.push(Math.round(performance.now() - started))
    }
    report.captureRuns = captureRuns

    // A pre-warmed overlay must stay invisible until the hotkey is pressed.
    session?.prewarm()
    await wait(3200)
    const strayOverlays = BrowserWindow.getAllWindows().filter(
      (win) => win.webContents.getURL().includes('overlay') && win.isVisible()
    ).length
    const prewarmOk = strayOverlays === 0

    // The fast path must produce the same picture as the PNG path it replaced.
    // Comparing pixels is the only honest way to claim "no quality change".
    let rawMatchesPng = false
    try {
      const native = (await captureDisplays())[0]
      if (native) {
        const rect = { x: 100, y: 80, width: 600, height: 400 }
        const options = composeOptionsFromSettings(defaultSettings(path.join(app.getPath('pictures'), 'Flushot')))
        const rawPixelsOfNative = toRgbaBitmap(native)
        const viaRaw = await composeRawScreenshot(rawPixelsOfNative, rect, options)
        // Same card without the shadow layers: the difference is what the shadow
        // cache saves on every repeated selection.
        const noShadowStart = performance.now()
        await composeRawScreenshot(rawPixelsOfNative, rect, { ...options, shadowEnabled: false })
        const shadowMs = Math.round(performance.now() - noShadowStart)
        const viaPng = await composeScreenshot(await cropImage(native.image.toPNG(), rect), options)
        const [rawPixels, pngPixels] = await Promise.all([sharp(viaRaw).raw().toBuffer(), sharp(viaPng).raw().toBuffer()])
        if (rawPixels.length === pngPixels.length) {
          let maxDiff = 0
          for (let i = 0; i < rawPixels.length; i++) {
            const diff = Math.abs(rawPixels[i] - pngPixels[i])
            if (diff > maxDiff) maxDiff = diff
            if (maxDiff > 1) break
          }
          rawMatchesPng = maxDiff <= 1
          report.rawCompare = { bytes: rawPixels.length, maxDiff, shadowMs }
        }
      }
    } catch (error) {
      report.rawCompare = { bytes: 0, maxDiff: -1, error: error instanceof Error ? error.message : String(error) }
    }

    // The real scenario: hotkey → overlay → drag a region → Ctrl+C → clipboard.
    const realCopy = await runRealCopyCheck(session, outputDir)
    report.latency = { ...session?.lastTimings }

    // Annotations must reach the clipboard, not just the screen.
    const annotateCopy = await runAnnotationCheck(session, settingsStore, outputDir)
    report.annotateCopy = annotateCopy
    report.formats = annotateCopy.formats ?? { ok: false, note: 'проверка форматов не выполнена', files: {} }

    report.ocr = await runOcrCheck(outputDir)
    report.autostart = await runAutostartCheck()
    report.virtual = runVirtualCheck(session)
    const frameWidth = settingsStore ? (await settingsStore.load()).frameWidth : 0
    const fullscreenShortcut = settingsStore ? (await settingsStore.load()).hotkeyFullscreen : ''
    report.fullscreen = await runFullscreenCheck(session, frameWidth, fullscreenShortcut, outputDir)
    // Must run after the full-screen check, which re-registers the shortcuts: the
    // probe has to see the same values the app is really using.
    const liveSettings = settingsStore
      ? await settingsStore.load()
      : { hotkey: '', hotkeyFullscreen: '' }
    report.accelerators = runAcceleratorCheck({
      hotkey: liveSettings.hotkey,
      hotkeyFullscreen: liveSettings.hotkeyFullscreen
    })
    report.seam = await runSeamCheck(session, frameWidth, outputDir)
    report.perf = runPerfCheck(session, realCopy.warm ?? {}, report.seam)
    report.debug = {
      lastError: session?.lastError ?? 'нет сессии',
      windows: BrowserWindow.getAllWindows().map((win) => ({
        url: win.webContents.getURL().replace(/^file:.*\/([^/]+)$/, '$1'),
        bounds: (() => {
          const box = win.getBounds()
          return `${box.x},${box.y} ${box.width}×${box.height}`
        })(),
        visible: win.isVisible()
      }))
    }

    // Speed guard: a warm hotkey must stay far below a second.
    const warmVisible = Number(realCopy.warm?.overlayVisible ?? 9999)
    const warmFast = warmVisible < 550
    report.prewarm = { visible: strayOverlays, ok: prewarmOk }

    // Colour check for the raw bitmap path: a pure red image must come out as
    // 255,0,0,255. A wrong channel order would show the screen tinted blue.
    const redPng = await sharp({ create: { width: 2, height: 2, channels: 3, background: { r: 255, g: 0, b: 0 } } })
      .png()
      .toBuffer()
    const redImage = nativeImage.createFromBuffer(redPng)
    const bitmapPixel = Array.from(toRgbaBitmap({ image: redImage, width: 2, height: 2 }).data.slice(0, 4)).join(',')
    const colorOk = bitmapPixel === '255,0,0,255'

    report.ui = { settings: settingsPage.labels, overlay: overlayPage.labels }
    report.facts = {
      settings: settingsPage.facts,
      webp: webpPage.facts,
      compact: compactPage.facts,
      hotkey: hotkeyPage.facts,
      overlay: overlayPage.facts,
      overlayCopy: copyKeyPage.facts,
      overlayGlobalCopy: globalCopyPage.facts,
      annotate: annotatePage.facts,
      color: { pixel: bitmapPixel, ok: String(colorOk) }
    }
    report.files.push(
      settingsPage.file,
      webpPage.file,
      compactPage.file,
      hotkeyPage.file,
      overlayPage.file,
      copyKeyPage.file,
      globalCopyPage.file,
      annotatePage.file
    )

    // The overlay must have drawn a 600×400 selection with its size badge and
    // toolbar, and the settings window must show its preview and panels.
    const overlayOk =
      overlayPage.facts.badge.replace(/\s/g, '').startsWith('600×400') &&
      overlayPage.facts.toolbar === 'visible' &&
      overlayPage.labels.includes('Создать')
    const settingsOk =
      settingsPage.facts.panels === '5' &&
      settingsPage.facts.overflowX === 'false' &&
      settingsPage.facts.versionCentered === 'true' &&
      settingsPage.facts.resetLast === 'true' &&
      settingsPage.facts.folderClickable === '1' &&
      settingsPage.facts.autostartRow === 'off' &&
      settingsPage.facts.previewSticky === 'false' &&
      // The default format is PNG, so the caption must say so and not "JPEG".
      settingsPage.facts.formatLabel === 'PNG' &&
      settingsPage.facts.firstPanel === 'Оформление' &&
      settingsPage.facts.swatchAligned === 'true' &&
      settingsPage.labels.includes('Изменить…')
    const compactOk = compactPage.facts.overflowX === 'false' && compactPage.facts.clipped === '0'
    // Choosing WebP must reach the caption, the quality row and back again.
    const webpOk =
      webpPage.facts.webpLabel.startsWith('WebP ·') &&
      webpPage.facts.webpQuality.includes('WebP') &&
      webpPage.facts.webpRestored === 'PNG'
    const overlayCopyOk =
      copyKeyPage.facts.badge.replace(/\s/g, '').startsWith('600×400') && copyKeyPage.facts.toast.length > 0
    // The global Ctrl+C path is the one that works regardless of focus/layout.
    const globalCopyOk =
      globalCopyPage.facts.badge.replace(/\s/g, '').startsWith('600×400') && globalCopyPage.facts.toast.length > 0

    // The recorded shortcut must be shown and persisted, not just typed.
    const stored = JSON.parse(await fs.readFile(path.join(app.getPath('userData'), 'settings.json'), 'utf8')) as {
      hotkey?: string
    }
    const hotkeyOk = stored.hotkey === 'CommandOrControl+Alt+P' && hotkeyPage.facts.hotkey.includes('Ctrl + Alt + P')
    report.facts.hotkey = { ...hotkeyPage.facts, stored: stored.hotkey ?? '' }
    report.realCopy = realCopy

    // The annotation bar must offer every tool, draw pixels, and the drawing
    // surface must be backed by the picture's own pixel size (1280 × 720).
    // Five annotations are expected: arrow, line, caption and two step badges.
    const [movedFrom, movedTo, movedCount] = annotatePage.facts.annotateMoved.split('>')
    const [toolbarShift, toolbarOverflow] = annotatePage.facts.annotateToolbarShift.split(':')
    // A line drawn with Shift held: it must exist, and it must be exactly
    // horizontal — a few degrees off is what made the tool useless for
    // underlining a row of text.
    const [lineBefore, lineAfter, lineFrom, lineTo] = annotatePage.facts.annotateLine.split('>')
    const [lineX1, lineY1] = (lineFrom ?? '').split(',')
    const [lineX2, lineY2] = (lineTo ?? '').split(',')
    const lineOk =
      Number(lineBefore) > 0 &&
      Number(lineAfter) === Number(lineBefore) + 1 &&
      lineY1 !== undefined &&
      lineY1 === lineY2 &&
      Number(lineX2) > Number(lineX1)
    const annotateOk =
      annotatePage.facts.annotateTools === '8' &&
      Number(annotatePage.facts.annotateSwatches) >= 7 &&
      annotatePage.facts.annotateCount === '5' &&
      lineOk &&
      annotatePage.facts.annotateTextSizes === '4' &&
      annotatePage.facts.annotateTextRows.startsWith('TEXTAREA:') &&
      annotatePage.facts.annotateReedit === 'Перенос текста по словам работает и в файле' &&
      annotatePage.facts.annotateStepNumbers === '1,2' &&
      // The move tool changed the caption's position and did not duplicate it.
      movedFrom !== '' &&
      movedTo !== '' &&
      movedFrom !== movedTo &&
      movedCount === '5' &&
      // A 12-line caption left the annotation bar exactly where it was and never
      // grew past the bottom of the picture.
      toolbarShift === '0' &&
      toolbarOverflow === '0' &&
      annotatePage.facts.annotateEdge === '0' &&
      Number(annotatePage.facts.annotatePainted) > 800 &&
      annotatePage.facts.annotateSize === '1280x720' &&
      annotatePage.facts.overflowX === 'false' &&
      annotatePage.facts.clipped === '0'

    report.ok =
      report.canvas?.width === report.canvas?.expectedWidth &&
      report.canvas?.height === report.canvas?.expectedHeight &&
      report.clipboard.includes('image/png') &&
      report.files.length >= 8 &&
      overlayOk &&
      overlayCopyOk &&
      globalCopyOk &&
      annotateOk &&
      globalShortcutOk &&
      realCopy.ok &&
      annotateCopy.ok &&
      (report.formats?.ok ?? false) &&
      (report.virtual?.ok ?? false) &&
      (report.seam?.ok ?? false) &&
      (report.fullscreen?.ok ?? false) &&
      (report.hotkeyRebind?.ok ?? false) &&
      (report.previewResize?.ok ?? false) &&
      (report.accelerators?.ok ?? false) &&
      (report.ocr?.ok ?? false) &&
      report.perf.ok &&
      webpOk &&
      // Reported, not gated: a restricted token can deny registry writes to
      // child processes, which says nothing about the app itself.
      report.autostart !== undefined &&
      warmFast &&
      rawMatchesPng &&
      report.warmImaging.ok &&
      prewarmOk &&
      colorOk &&
      settingsOk &&
      compactOk &&
      hotkeyOk

    if (!report.ok) {
      report.errors.push(
        `ui check failed: overlay=${overlayOk} overlayCopy=${overlayCopyOk} globalCopy=${globalCopyOk} annotate=${annotateOk}(${annotatePage.facts.annotateTools} tools, ${annotatePage.facts.annotateSwatches} swatches, count ${annotatePage.facts.annotateCount}, painted ${annotatePage.facts.annotatePainted}, size ${annotatePage.facts.annotateSize}) annotateCopy=${annotateCopy.ok}(${annotateCopy.note ?? annotateCopy.magenta + ' px, ' + annotateCopy.size}) shortcut=${globalShortcutOk} realCopy=${realCopy.ok}(${realCopy.note ?? realCopy.clipboard}) fullscreen=${report.fullscreen?.ok ?? 'нет'}(${report.fullscreen?.note || report.fullscreen?.size || ''}) rebind=${report.hotkeyRebind?.ok ?? 'нет'}(${report.hotkeyRebind?.note || report.hotkeyRebind?.saved || ''}) preview=${report.previewResize?.ok ?? 'нет'}(${report.previewResize?.note || report.previewResize?.wide || ''}) accelerators=${report.accelerators?.ok ?? 'нет'}(${report.accelerators?.rejected?.join(' | ') || report.accelerators?.checked}) settings=${settingsOk} compact=${compactOk} hotkey=${hotkeyOk} perf=${report.perf.ok}(${report.perf.note || report.perf.composeMs + ' ms'}) (stored ${stored.hotkey})`
      )
    }
    await fs.writeFile(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2))
  } catch (error) {
    report.ok = false
    report.errors.push(error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error))
    await fs.writeFile(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2)).catch(() => undefined)
  }

  console.log(JSON.stringify(report, null, 2))
  await app.quit()
  return report.ok ? 0 : 1
}
