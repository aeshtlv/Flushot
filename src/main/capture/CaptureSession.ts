import { BrowserWindow, screen, type Display } from 'electron'
import type {
  ActionResult,
  AnnotationLayerPayload,
  CaptureSelection,
  DisplayDescriptor,
  OcrOutcome,
  OcrRegion,
  OverlayInit,
  OverlayShot,
  Rect
} from '../../shared/types'
import { isUsableSelection } from '../../shared/geometry'
import {
  describeVirtual,
  planNativeCrop,
  selectionToDesktopRect,
  virtualBounds,
  virtualImageSize,
  virtualScale,
  type MonitorCapture,
  type ScreenBounds
} from '../../shared/virtualScreen'
import { registerCopyShortcut, unregisterCopyShortcut } from './copyShortcut'
import type { SettingsStore } from '../settings/SettingsStore'
import { preloadPath, rendererUrl } from '../windows/paths'
import { composeOptionsFromSettings, composeRawCard } from '../imaging/compose'
import type { Raster } from '../imaging/raster'
import type { FrameLayout } from '../imaging/layout'
import { copyResult, saveResult, saveToFolder, type ResultContext } from '../export/resultActions'
import { encodeRaster } from '../export/imageExport'
import { captureDisplays, toRgbaBitmap, type CaptureTimings, type NativeSnapshot } from './screenCapture'
import { cropFromMonitors, type MonitorSource } from './nativeCrop'
import { buildVirtualFrame, type RawBitmap } from './virtualFrame'
import { pasteAnnotationLayer } from '../imaging/annotations'
import { recognizeCardPicture } from '../ocr/recognize'
import { warmOcr } from '../ocr/worker'

export interface CaptureSessionDeps {
  settings: SettingsStore
  onError: (message: string) => void
  onStateChange: () => void
}

/**
 * Owns one capture round: freezes every monitor into one virtual desktop, shows
 * a single overlay spanning all of them, converts the chosen selection into a
 * framed image of any size and exposes the result actions (save / copy).
 *
 * One window instead of one per monitor is what makes a selection able to cross
 * the seam between screens: a rectangle is only meaningful inside a single
 * coordinate space, and a window is clamped to one monitor.
 */
export class CaptureSession {
  /**
   * Frozen screens kept as NativeImage, one per monitor. They are only used to
   * build the composite and to produce PNG on demand, so the hotkey path never
   * pays for encoding.
   */
  private natives = new Map<string, NativeSnapshot>()
  /** The virtual desktop as one RGBA frame, rebuilt once per round. */
  private virtualRaw: RawBitmap | null = null
  /** Geometry of the virtual desktop handed to the overlay. */
  private virtualDescriptor: DisplayDescriptor | null = null
  /** How the composite was built on the last round (diagnostics). */
  lastVirtual: { width: number; height: number; scale: number; screens: number; resampled: string[] } | null = null
  private overlays: BrowserWindow[] = []
  private displayByWebContents = new Map<number, string>()
  /** The finished card as pixels, plus where the picture sits inside it. */
  private result: { raster: Raster; layout: FrameLayout } | null = null
  /**
   * The card already encoded as PNG, started as soon as the card appears.
   *
   * Copying or saving an unannotated card is then just a buffer hand-off: the
   * encode happens while the user is looking at the result instead of after they
   * click. Annotating throws it away and encodes the finished picture instead.
   */
  private pendingPng: Promise<Buffer | null> | null = null
  private starting = false
  /** True while a selection round is on screen (windows may stay alive hidden). */
  private active = false
  /** Overlay renderers that finished booting and called getInit. */
  private booted = new Set<number>()
  /** Stage timings of the last start(), in milliseconds. Used by diagnostics. */
  lastTimings: Record<string, number> = {}
  /** Message of the last failed start(), for diagnostics. */
  lastError = ''
  /** Number of completed start() calls, for diagnostics. */
  startCount = 0
  private startTime = 0
  private readyCount = 0
  private expectedReady = 0
  private onAllReady: (() => void) | null = null
  /** Resolves once the frozen screens are stored, letting overlays fetch them. */
  private captureReady: Promise<void> = Promise.resolve()
  private captureDone = false
  /** Display that owns keyboard focus for this round. */
  private focusDisplayId: string | null = null
  /** True when this round was started by the full-screen hotkey. */
  private fullscreen = false

  constructor(private readonly deps: CaptureSessionDeps) {}

  get isActive(): boolean {
    return this.active
  }

  /** True when a window pool is ready, so a capture needs no window creation. */
  get isWarm(): boolean {
    return this.overlays.some((win) => !win.isDestroyed() && this.booted.has(win.webContents.id))
  }

  get hasResult(): boolean {
    return this.result !== null
  }

  async start(options: { fullscreen?: boolean } = {}): Promise<void> {
    if (this.active || this.starting) return
    this.starting = true
    this.active = true
    this.fullscreen = Boolean(options.fullscreen)
    this.startCount += 1
    this.lastError = ''
    const timings: Record<string, number> = {}
    const t0 = performance.now()
    this.startTime = t0
    this.readyCount = 0
    const mark = (name: string): void => {
      timings[name] = Math.round(performance.now() - t0)
    }

    try {
      this.result = null
      this.clearSnapshots()

      const displays = screen.getAllDisplays()
      if (displays.length === 0) throw new Error('Не найдено ни одного экрана')

      let resolveCapture: () => void = () => undefined
      this.captureReady = new Promise<void>((resolve) => {
        resolveCapture = resolve
      })

      this.focusDisplayId = 'virtual'
      // The window already exists, so its renderer is warm and the hotkey does
      // not pay for booting React again.
      this.syncOverlays(displays)
      mark('windows')

      if (this.overlays.length === 0) throw new Error('Не удалось открыть оверлей выделения')
      this.expectedReady = this.overlays.length

      const captureTimings: CaptureTimings = {}
      // Settings are tiny but independent of the capture, so both run together.
      const [, natives] = await Promise.all([this.deps.settings.load(), captureDisplays(captureTimings)])
      mark('capture')
      this.natives = new Map(natives.map((snapshot) => [snapshot.display.id, snapshot]))
      this.virtualRaw = await this.buildVirtualDesktop(natives)
      mark('stitch')
      this.captureDone = true
      resolveCapture()

      mark('ready')
      this.lastTimings = { ...timings, getSources: captureTimings.getSources ?? 0 }

      // A warm window pulls nothing: its frame is pushed, which skips a round
      // trip and lets it paint immediately.
      const virtual = this.virtualRaw
      if (virtual && this.virtualDescriptor) {
        for (const win of this.overlays) {
          if (this.booted.has(win.webContents.id)) {
            win.webContents.send('overlay:frame', { display: this.virtualDescriptor, shot: virtual, fullscreen: this.fullscreen })
          }
        }
      }

      // Windows activates the window as it is shown; re-assert focus once it is
      // up so Esc, Enter and Ctrl+C work without an extra click.
      setTimeout(() => {
        const target = this.overlays[0]
        if (target && !target.isDestroyed() && target.isVisible()) target.focus()
      }, 150)

      // Ctrl+C must work right after the region is drawn, so it is captured
      // globally for the lifetime of the overlay instead of relying on focus.
      registerCopyShortcut(() => this.triggerCopy())

      this.deps.onStateChange()
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error)
      this.active = false
      this.destroyOverlays()
      this.clearSnapshots()
      this.deps.onError(error instanceof Error ? error.message : 'Не удалось запустить захват экрана')
      this.deps.onStateChange()
    } finally {
      this.starting = false
    }
  }

  /**
   * Create hidden overlays ahead of time so the first hotkey is as fast as the
   * following ones: the renderer boots while the app sits in the tray.
   */
  prewarm(): void {
    if (this.overlays.length > 0) return
    try {
      const displays = screen.getAllDisplays()
      if (displays.length === 0) return
      this.syncOverlays(displays)
    } catch {
      // Pre-warming is an optimisation; a failure must not affect startup.
    }
  }

  /**
   * Reuse one window that covers every monitor, creating it only when missing.
   *
   * Its bounds are the union of all displays, which is also the coordinate space
   * the selection is expressed in. When monitors are added or removed the window
   * is simply resized; a stale window for a monitor that no longer exists is
   * destroyed.
   */
  private syncOverlays(displays: Display[]): void {
    const screens = toScreens(displays)
    const union = virtualBounds(screens)
    const scale = virtualScale(screens)
    this.virtualDescriptor = describeVirtual(screens, virtualImageSize(screens, scale))

    while (this.overlays.length > 1) {
      const extra = this.overlays.pop()
      if (extra && !extra.isDestroyed()) extra.destroy()
    }

    const existing = this.overlays[0]
    if (existing && !existing.isDestroyed()) {
      const bounds = existing.getBounds()
      if (bounds.x !== union.x || bounds.y !== union.y || bounds.width !== union.width || bounds.height !== union.height) {
        existing.setBounds(union)
      }
      return
    }

    this.createOverlay(this.virtualDescriptor)
  }

  /**
   * Stitch the frozen monitors into one frame and remember how it was built.
   *
   * With a single monitor this returns the pixels untouched; with several it
   * produces the wide image the overlay paints, so a selection can start on one
   * screen and end on another.
   */
  private async buildVirtualDesktop(natives: NativeSnapshot[]): Promise<RawBitmap> {
    const screens = natives.map((snapshot) => ({
      id: snapshot.display.id,
      bounds: snapshot.display.bounds,
      scaleFactor: snapshot.display.scaleFactor,
      raw: toRgbaBitmap(snapshot),
      rotation: snapshot.rotation
    }))

    const frame = await buildVirtualFrame(screens)
    this.lastVirtual = {
      width: frame.width,
      height: frame.height,
      scale: frame.scale,
      screens: screens.length,
      resampled: frame.resampled
    }

    // The real pixel size wins over the estimate: the capture layer may round a
    // fraction of a pixel differently, and the selection mapping has to agree
    // with the pixels that actually exist.
    //
    // Each monitor also reports its own capture size and rotation. On a mixed-DPI
    // desk the composite is not a reliable source for either — a 100 % screen is
    // upscaled inside it — and the selection size the overlay shows has to be the
    // size that will really be written to disk.
    if (this.virtualDescriptor) {
      this.virtualDescriptor = {
        ...this.virtualDescriptor,
        scaleFactor: frame.scale,
        imageWidth: frame.width,
        imageHeight: frame.height,
        monitors: this.virtualDescriptor.monitors?.map((monitor) => {
          const snapshot = natives.find((candidate) => candidate.display.id === monitor.id)
          if (!snapshot) return monitor
          return {
            ...monitor,
            imageWidth: snapshot.width,
            imageHeight: snapshot.height,
            rotation: snapshot.rotation
          }
        })
      }
    }

    return { data: frame.data, width: frame.width, height: frame.height }
  }

  private createOverlay(display: DisplayDescriptor): void {
    const win = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      useContentSize: true,
      frame: false,
      transparent: false,
      backgroundColor: '#0B0B0F',
      show: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      enableLargerThanScreen: true,
      roundedCorners: false,
      webPreferences: {
        preload: preloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
        spellcheck: false
      }
    })

    win.setAlwaysOnTop(true, 'screen-saver')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    win.setSkipTaskbar(true)
    win.setMenuBarVisibility(false)
    win.setResizable(false)

    const webContentsId = win.webContents.id
    this.displayByWebContents.set(webContentsId, display.id)
    this.overlays.push(win)

    win.on('closed', () => {
      this.displayByWebContents.delete(webContentsId)
      this.booted.delete(webContentsId)
      this.overlays = this.overlays.filter((candidate) => candidate !== win)
      if (this.overlays.length === 0) {
        unregisterCopyShortcut()
        this.clearSnapshots()
        this.overlays = []
        // Rebuild the warm pool so the next hotkey is still instant.
        if (this.active) this.deps.onStateChange()
      }
    })

    const { kind, value } = rendererUrl('overlay')
    const load = kind === 'url' ? win.loadURL(value) : win.loadFile(value)
    void load.catch((error: unknown) => {
      this.deps.onError(`Не удалось загрузить интерфейс выделения: ${String(error)}`)
      win.destroy()
    })

    win.once('ready-to-show', () => {
      // Deliberately not shown yet: the window stays hidden until the overlay
      // reports its first paint, so the user never sees an empty dark frame.
      // A safety timer covers a renderer that fails to report at all — but only
      // during an active round, otherwise a pre-warmed window would pop up on
      // its own a couple of seconds after launch.
      setTimeout(() => {
        if (this.active && !win.isDestroyed() && !win.isVisible()) this.showOverlay(win)
      }, 2500)
    })
  }

  /** Show an overlay and give keyboard focus to the display under the pointer. */
  private showOverlay(win: BrowserWindow): void {
    // Pre-warmed windows must stay hidden until the user actually asks for a
    // capture, so this is the single gate for showing an overlay.
    if (!this.active || win.isDestroyed() || win.isVisible()) return
    // `showInactive` never gives the overlay keyboard focus, which made Esc,
    // Enter and Ctrl+C dead until the user clicked inside the selection.
    win.show()
    const displayId = this.displayByWebContents.get(win.webContents.id)
    if (displayId && displayId === this.focusDisplayId) win.focus()
    win.setAlwaysOnTop(true, 'screen-saver')
  }

  /**
   * Small metadata for one overlay window: available immediately, so the window
   * can be shown before the frozen frame is transferred.
   */
  async getInit(webContentsId: number): Promise<OverlayInit> {
    const displayId = this.displayByWebContents.get(webContentsId)
    if (!displayId) throw new Error('Окно выделения не найдено')

    // Pre-warmed windows ask for metadata long before the first hotkey.
    const settings = this.deps.settings.peek() ?? (await this.deps.settings.load())
    this.booted.add(webContentsId)

    // Geometry is known from the display list before any pixels arrive, which
    // lets the renderer size its canvas up front.
    const display = this.virtualDescriptor
    if (!display) throw new Error('Экран не найден')

    return { display, settings, hotkey: settings.hotkey, fullscreen: this.fullscreen }
  }

  /** The frozen virtual desktop; waits for the capture to finish. */
  async getShot(webContentsId: number): Promise<OverlayShot> {
    const displayId = this.displayByWebContents.get(webContentsId)
    if (!displayId) throw new Error('Окно выделения не найдено')

    if (!this.captureDone) {
      await Promise.race([this.captureReady, new Promise<void>((resolve) => setTimeout(resolve, 5000))])
    }

    if (!this.virtualRaw) throw new Error('Снимок экрана больше недоступен')
    return this.virtualRaw
  }

  /** Stage timings of the last copy action, in milliseconds. */
  lastCopyTimings: Record<string, number> = {}
  /** Time spent composing the card on the last confirm, in milliseconds. */
  lastComposeMs = 0
  /** Size of the file the last confirm produced, in bytes. */
  lastCardBytes = 0
  /** How the last capture was assembled, for diagnostics. */
  lastCrop: { width: number; height: number; density: number; parts: number; resampled: string[] } | null = null

  private clearSnapshots(): void {
    this.natives.clear()
    this.virtualRaw = null
  }

  /** Every monitor as the crop planner needs to see it. */
  private monitorCaptures(): MonitorCapture[] {
    return [...this.natives.values()].map((snapshot) => ({
      id: snapshot.display.id,
      bounds: snapshot.display.bounds,
      scaleFactor: snapshot.display.scaleFactor,
      imageWidth: snapshot.width,
      imageHeight: snapshot.height,
      rotation: snapshot.rotation
    }))
  }

  /** Every monitor's frozen pixels, in the capture layer's own channel order. */
  private monitorSources(): MonitorSource[] {
    return [...this.natives.values()].map((snapshot) => {
      const bitmap = snapshot.image.toBitmap()
      return {
        id: snapshot.display.id,
        bitmap: { data: new Uint8Array(bitmap.buffer, bitmap.byteOffset, bitmap.byteLength), width: snapshot.width, height: snapshot.height },
        bounds: snapshot.display.bounds,
        rotation: snapshot.rotation
      }
    })
  }

  /**
   * The selection in desktop coordinates (device-independent pixels), using the
   * same mapping the overlay uses to display its size badge.
   */
  private toDesktopRect(selection: CaptureSelection, descriptor: DisplayDescriptor): Rect {
    return selectionToDesktopRect(selection.rect, selection.viewport, descriptor.bounds)
  }

  /**
   * Build the selected picture from each monitor's own pixels.
   *
   * Cropping out of the stitched preview used to mean a 100 % monitor was first
   * upscaled to the density of the sharpest screen on the desk, so the saved file
   * came out soft and larger than the screen it came from. Taking every part from
   * its own monitor keeps the captured screen pixel-exact at any DPI, and a mixed
   * orientation is turned upright before it is used.
   */
  private async cropSelection(selection: CaptureSelection, descriptor: DisplayDescriptor): Promise<{ raster: RawBitmap; plan: ReturnType<typeof planNativeCrop> }> {
    const desktopRect = this.toDesktopRect(selection, descriptor)
    const plan = planNativeCrop(desktopRect, this.monitorCaptures())
    const raster = await cropFromMonitors(this.monitorSources(), plan)
    this.lastCrop = {
      width: plan.width,
      height: plan.height,
      density: plan.density,
      parts: plan.parts.length,
      resampled: plan.parts.filter((part) => part.resampled).map((part) => part.id)
    }
    return { raster, plan }
  }

  /** Crop + compose the selected region. */
  async captureSelection(selection: CaptureSelection, senderId: number): Promise<ActionResult> {
    const displayId = this.displayByWebContents.get(senderId)
    if (!displayId || displayId !== selection.displayId) {
      return { ok: false, message: 'Окно выделения устарело. Нажмите Ctrl+Shift+S снова.' }
    }
    const settings = this.deps.settings.peek()
    const descriptor = this.virtualDescriptor
    if (!this.natives.size || !settings || !descriptor) return { ok: false, message: 'Снимок экрана больше недоступен' }

    if (!isUsableSelection(selection.rect, 8)) {
      return { ok: false, message: 'Слишком маленькая область — выделите не меньше 8 × 8 пикселей' }
    }

    try {
      const t0 = performance.now()
      const copyTimings: Record<string, number> = {}
      const markCopy = (name: string): void => {
        copyTimings[name] = Math.round(performance.now() - t0)
      }

      // Ctrl+C while the region is being drawn: the overlay is hidden first and
      // only then is the card composed and copied, so the user never watches a
      // frozen picture while sharp works.
      if (selection.intent === 'copy') {
        this.hideOverlays()
        markCopy('hide')
        const { raster } = await this.cropSelection(selection, descriptor)
        markCopy('crop')
        const card = await composeRawCard(raster, { x: 0, y: 0, width: raster.width, height: raster.height }, composeOptionsFromSettings(settings), selection.previewWidth)
        markCopy('compose')
        const copied = await copyResult({ raster: card.raster, layout: card.layout, settings, window: null })
        markCopy('clipboard')
        this.lastCopyTimings = copyTimings
        this.result = null
        this.pendingPng = null
        this.cancel()
        return copied.ok
          ? { ok: true, message: `Скопировано в буфер обмена · ${card.raster.width} × ${card.raster.height}`, width: card.raster.width, height: card.raster.height }
          : { ok: false, message: copied.message }
      }

      // The overlay stays visible, because the result is shown in it.
      const composeStart = performance.now()
      const { raster } = await this.cropSelection(selection, descriptor)
      const card = await composeRawCard(
        raster,
        { x: 0, y: 0, width: raster.width, height: raster.height },
        composeOptionsFromSettings(settings),
        selection.previewWidth
      )
      this.lastComposeMs = Math.round(performance.now() - composeStart)

      this.result = { raster: card.raster, layout: card.layout }

      // Start the PNG encode now, while the user is looking at the result, so a
      // later copy or save is a buffer hand-off. In folder mode the file itself
      // is written immediately, so the same encode is reused for it — but only
      // when the file really is a PNG; encoding both a PNG and a JPEG at once
      // would make both slower for no benefit.
      const willSaveFile = settings.saveMode === 'folder'
      if (!willSaveFile || settings.format === 'png') {
        this.pendingPng = encodeRaster(card.raster, { format: 'png', jpegQuality: settings.jpegQuality }).catch(() => null)
      }

      const size = { width: card.raster.width, height: card.raster.height }

      if (willSaveFile) {
        const png = (await this.pendingPng) ?? undefined
        const saved = await saveToFolder({ raster: card.raster, layout: card.layout, settings, window: null, png })
        if (saved.ok) {
          return { ok: true, message: saved.message, path: saved.path, preview: card.preview, ...size }
        }
        return { ok: true, message: `Снимок готов, но сохранить не удалось: ${saved.message}`, preview: card.preview, ...size }
      }

      return { ok: true, message: `Готово · ${size.width} × ${size.height}`, preview: card.preview, ...size }
    } catch (error) {
      this.result = null
      this.pendingPng = null
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Не удалось обработать выделенную область'
      }
    }
  }

  /**
   * Forward the global Ctrl+C to the overlay that owns the selection. The
   * focused overlay is preferred; otherwise the one under the pointer, which is
   * where the user just finished dragging.
   */
  private triggerCopy(): void {
    if (!this.isActive) return

    const focused = this.overlays.find((win) => !win.isDestroyed() && win.isFocused())
    let target = focused

    if (!target) {
      const cursor = screen.getCursorScreenPoint()
      target = this.overlays.find((win) => {
        if (win.isDestroyed()) return false
        const bounds = win.getBounds()
        return (
          cursor.x >= bounds.x && cursor.x < bounds.x + bounds.width && cursor.y >= bounds.y && cursor.y < bounds.y + bounds.height
        )
      })
    }

    target = target ?? this.overlays[0]
    if (target && !target.isDestroyed()) target.webContents.send('overlay:copy-shortcut')
  }

  /**
   * Called by an overlay once the frozen screenshot is on screen. The first
   * report is the moment the user actually sees the selection UI, which is the
   * number that matters for perceived speed.
   */
  markOverlayReady(webContentsId?: number): void {
    if (this.startTime === 0) return

    // The window appears exactly when its frozen frame is painted, so there is
    // no flash of an empty overlay and the visible wait is the real latency.
    if (typeof webContentsId === 'number') {
      const win = this.overlays.find((candidate) => candidate.webContents.id === webContentsId)
      if (win) this.showOverlay(win)
    }

    this.readyCount += 1
    const elapsed = Math.round(performance.now() - this.startTime)
    if (!this.lastTimings.overlayVisible) {
      this.lastTimings.overlayVisible = elapsed
    }
    if (this.readyCount >= this.expectedReady) {
      this.lastTimings.allOverlaysVisible = elapsed
      this.onAllReady?.()
      this.onAllReady = null
    }
  }

  /** Moment the frozen frame reached the canvas (diagnostics). */
  markOverlayPainted(): void {
    if (this.startTime === 0 || this.lastTimings.imagePainted) return
    this.lastTimings.imagePainted = Math.round(performance.now() - this.startTime)
  }

  /** Resolves once every overlay reported its first paint (diagnostics only). */
  whenAllReady(): Promise<void> {
    if (this.readyCount >= this.expectedReady && this.expectedReady > 0) return Promise.resolve()
    return new Promise((resolve) => {
      this.onAllReady = resolve
      setTimeout(() => {
        this.onAllReady = null
        resolve()
      }, 3000)
    })
  }

  /**
   * Take the overlays off the screen right now, without forgetting the result.
   *
   * This is the whole point of the copy path: hiding a window is one call, while
   * pasting the drawing, encoding a 4K PNG and handing it to the clipboard add up
   * to a few hundred milliseconds. Doing the work first meant the picture stayed
   * on screen for the entire encode, which reads as "it hangs".
   *
   * `keepForDialog` is for "ask every time" saves: a modal dialog parented to a
   * hidden window may never appear, so there the overlay waits for the dialog.
   */
  conceal(keepForDialog = false): void {
    if (keepForDialog && this.deps.settings.peek()?.saveMode === 'ask') return
    for (const win of this.overlays) {
      if (!win.isDestroyed() && win.isVisible()) win.hide()
    }
  }

  /** Bring the overlays back when an action failed and the user has to see why. */
  private reveal(): void {
    for (const win of this.overlays) {
      if (!win.isDestroyed() && !win.isVisible()) win.showInactive()
    }
  }

  /**
   * Save the current result, optionally with the user's drawing painted onto it.
   *
   * The layer arrives as raw pixels at the picture's own size, so it is pasted
   * 1:1 and the finished picture is encoded exactly once.
   *
   * `window` is the overlay that asked: in "ask every time" mode the save dialog
   * is parented to it, so it cannot end up behind a full-screen overlay.
   */
  async save(annotations?: AnnotationLayerPayload, window: BrowserWindow | null = null): Promise<ActionResult> {
    this.conceal(true)
    const context = await this.resultContext(annotations)
    if (!context) return { ok: false, message: this.result ? 'Настройки недоступны' : 'Сначала создайте снимок' }
    // `saveResult` honours the configured mode. Saving straight to the folder
    // used to ignore "спрашивать каждый раз" entirely: the choice existed in the
    // settings window and did nothing.
    return this.settle(await saveResult({ ...context, window }, annotations, () => this.conceal()))
  }

  async copy(annotations?: AnnotationLayerPayload): Promise<ActionResult> {
    this.conceal()
    const context = await this.resultContext(annotations)
    if (!context) return { ok: false, message: this.result ? 'Настройки недоступны' : 'Сначала создайте снимок' }
    return this.settle(await copyResult(context, annotations))
  }

  /**
   * Recognize the text on the picture as the user sees it.
   *
   * The drawing is pasted in first, so a blurred or covered area is really gone
   * from the image the engine reads — otherwise "скрыть область" would hide a
   * password on screen and hand it straight back as text.
   *
   * `region` narrows the work to the fragment the user selected on the result.
   */
  async recognizeText(annotations?: AnnotationLayerPayload, region?: OcrRegion): Promise<OcrOutcome> {
    if (!this.result) return { ok: false, lines: [], error: 'Сначала создайте снимок' }
    const card = annotations ? pasteAnnotationLayer(this.result.raster, this.result.layout, annotations) : this.result.raster
    return recognizeCardPicture(card, this.result.layout, region)
  }

  /** Start the OCR engine while the user is still looking at the result. */
  warmText(): void {
    warmOcr()
  }

  /**
   * End the round after an action, or put the overlay back if it failed.
   *
   * On success the session is torn down the same way `cancel()` does it — the
   * windows stay warm for the next hotkey, the frozen screens are released — but
   * only after the clipboard or the file really has the picture.
   */
  private settle(outcome: ActionResult): ActionResult {
    if (outcome.ok) this.cancel()
    else this.reveal()
    return outcome
  }

  /** The result as pixels, plus the already-encoded PNG when nothing was drawn. */
  private async resultContext(annotations?: AnnotationLayerPayload): Promise<ResultContext | null> {
    if (!this.result) return null
    const settings = this.deps.settings.peek()
    if (!settings) return null
    // The background encode only helps when nothing was drawn: any annotation
    // means the card has to be rebuilt anyway.
    const png = annotations ? undefined : ((await this.pendingPng?.catch(() => null)) ?? undefined)
    return { raster: this.result.raster, layout: this.result.layout, settings, window: null, png }
  }

  /**
   * Hide the overlay without clearing the frozen screens, so post-processing can
   * still read them. Called the instant Ctrl+C is pressed, which is why the
   * window disappears before sharp has done any work.
   */
  private hideOverlays(): void {
    this.active = false
    unregisterCopyShortcut()
    for (const win of [...this.overlays]) {
      if (win.isDestroyed()) continue
      win.hide()
      win.webContents.send('overlay:reset')
    }
    this.deps.onStateChange()
  }

  /** Ends the round but keeps the windows warm for the next hotkey. */
  cancel(): void {
    this.hideOverlays()
    this.clearSnapshots()
    this.result = null
    this.pendingPng = null
    this.captureDone = false
  }

  destroyOverlays(): void {
    unregisterCopyShortcut()
    this.active = false
    this.booted.clear()
    for (const win of [...this.overlays]) {
      if (!win.isDestroyed()) win.destroy()
    }
    this.overlays = []
    this.displayByWebContents.clear()
  }
}

/** Electron displays reduced to the plain geometry the layout helpers need. */
function toScreens(displays: Display[]): ScreenBounds[] {
  const primaryId = String(screen.getPrimaryDisplay().id)
  return displays.map((display) => ({
    id: String(display.id),
    bounds: display.bounds,
    scaleFactor: display.scaleFactor,
    primary: String(display.id) === primaryId
  }))
}