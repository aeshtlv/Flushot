import { BrowserWindow, app, clipboard, dialog, globalShortcut, ipcMain, shell } from 'electron'
import { mkdir } from 'node:fs/promises'
import { defaultSettings } from '../../shared/settings'
import { isValidAccelerator, normalizeAccelerator, reservedByWindows } from '../../shared/hotkey'
import type {
  ActionResult,
  AnnotationLayerPayload,
  CaptureSelection,
  OcrOutcome,
  OcrRegion,
  ScreenshotSettings
} from '../../shared/types'
import type { CaptureSession } from '../capture/CaptureSession'
import type { SettingsStore } from '../settings/SettingsStore'
import { renderPreview } from '../settings/preview'
import { isAutostartEnabled, setAutostart } from '../system/autostart'
import { closeSettingsWindow, getSettingsWindow } from '../windows/settingsWindow'

export interface IpcContext {
  session: CaptureSession
  settings: SettingsStore
  /** Always the accelerator that is actually registered right now. */
  getHotkey: () => string
  /** Effective full-screen accelerator, or '' when nothing could be bound. */
  getFullscreenHotkey: () => string
  defaultDirectory: string
  /**
   * Called after either shortcut was saved, with no arguments on purpose.
   *
   * The two keys are bound together — the second one cannot be registered
   * without knowing which combination the first one took — so the handler has to
   * re-register both and then read back what really happened. Passing only the
   * region accelerator made a change to the full-screen key look like "nothing
   * changed", and the new combination was never bound at all.
   */
  onHotkeysChanged?: () => void
  openSettings: () => void
}

function senderWindow(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender)
}

function errorResult(error: unknown): ActionResult {
  return { ok: false, message: error instanceof Error ? error.message : 'Неизвестная ошибка' }
}

/**
 * Wrap a handler so a thrown error never escapes into an unhandled rejection;
 * overlays always receive an ActionResult instead of a crashed window.
 */
function guard<Args extends unknown[]>(
  handler: (...args: Args) => Promise<ActionResult> | ActionResult
): (...args: Args) => Promise<ActionResult> {
  return async (...args: Args) => {
    try {
      return await handler(...args)
    } catch (error) {
      console.error('Ошибка обработчика IPC', error)
      return errorResult(error)
    }
  }
}

export function registerIpc(context: IpcContext): void {
  const { session, settings, defaultDirectory } = context

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    hotkey: context.getHotkey(),
    settingsPath: settings.path
  }))

  ipcMain.handle('overlay:init', (event) => session.getInit(event.sender.id))
  // The frozen frame is fetched separately so the window can appear first.
  ipcMain.handle('overlay:shot', (event) => session.getShot(event.sender.id))

  ipcMain.on('overlay:ready', (event) => {
    // The window is revealed only once it reported a painted frame.
    session.markOverlayReady(event.sender.id)
  })

  ipcMain.on('overlay:painted', () => {
    session.markOverlayPainted()
  })

  ipcMain.handle(
    'capture:selection',
    guard((event: Electron.IpcMainInvokeEvent, selection: CaptureSelection) => session.captureSelection(selection, event.sender.id))
  )

  ipcMain.handle(
    'result:save',
    guard((event: Electron.IpcMainInvokeEvent, annotations?: AnnotationLayerPayload) =>
      session.save(annotations, senderWindow(event))
    )
  )
  ipcMain.handle(
    'result:copy',
    guard((_event, annotations?: AnnotationLayerPayload) => session.copy(annotations))
  )
  ipcMain.handle('capture:cancel', () => {
    session.cancel()
  })

  /**
   * Take the overlays off the screen before the renderer has even measured the
   * drawing. Fire-and-forget on purpose: `send`, not `invoke`, so the hide is on
   * its way while the renderer is still scanning the canvas.
   */
  ipcMain.on('overlay:conceal', (_event, keepForDialog?: boolean) => {
    session.conceal(keepForDialog === true)
  })

  /**
   * Text recognition. The overlay asks for it explicitly and keeps its result
   * panel open, so unlike copy and save this must not hide anything.
   */
  ipcMain.handle(
    'result:ocr',
    async (_event, annotations?: AnnotationLayerPayload, region?: OcrRegion): Promise<OcrOutcome> => {
      try {
        return await session.recognizeText(annotations, region)
      } catch (error) {
        console.error('Ошибка распознавания текста', error)
        return { ok: false, lines: [], error: error instanceof Error ? error.message : 'Распознать текст не удалось' }
      }
    }
  )
  ipcMain.on('result:warm-ocr', () => session.warmText())

  /** Put recognized text on the clipboard. Plain text, so it pastes anywhere. */
  ipcMain.handle('clipboard:write-text', (_event, text: string) => {
    if (typeof text === 'string' && text.length > 0) clipboard.writeText(text)
    return { ok: typeof text === 'string' && text.length > 0 }
  })

  ipcMain.handle('settings:open', () => {
    context.openSettings()
  })

  ipcMain.handle('settings:get', async () => {
    const current = await settings.load()
    // The Run key lives outside the app and can be changed by other tools, so
    // the window shows what Windows really reports and the file follows it.
    const actual = isAutostartEnabled()
    if (actual !== current.launchAtLogin) return settings.update({ launchAtLogin: actual })
    return current
  })

  ipcMain.handle('settings:update', async (_event, patch: Partial<ScreenshotSettings>) => {
    const before = await settings.load()
    let next = await settings.update(patch)

    if (typeof patch.launchAtLogin === 'boolean' && next.launchAtLogin !== before.launchAtLogin) {
      const actual = setAutostart(next.launchAtLogin)
      if (actual !== next.launchAtLogin) {
        // Windows refused the registry write (policy, locked profile): keep the
        // stored value equal to reality instead of showing a dead tick.
        next = await settings.update({ launchAtLogin: actual })
      }
    }

    if (before.hotkey !== next.hotkey || before.hotkeyFullscreen !== next.hotkeyFullscreen) {
      // Re-bind both keys, then report the combinations that are really active:
      // a saved value that could not be registered must not look as if it worked.
      context.onHotkeysChanged?.()
      const effective = context.getHotkey()
      const effectiveFull = context.getFullscreenHotkey()
      return {
        ...next,
        hotkey: effective === next.hotkey ? next.hotkey : effective,
        hotkeyFullscreen: effectiveFull === next.hotkeyFullscreen ? next.hotkeyFullscreen : effectiveFull
      }
    }

    return next
  })

  /**
   * Is this combination actually available?
   *
   * The settings window cannot answer that by itself: whether a global shortcut
   * can be taken depends on what the whole machine has registered, and the only
   * honest test is to try. Registration is undone immediately, so the probe never
   * keeps a key.
   */
  ipcMain.handle('hotkey:probe', (_event, accelerator: string) => {
    if (!isValidAccelerator(accelerator)) return { free: false, invalid: true }
    const normalized = normalizeAccelerator(accelerator)

    // Our own keys are "taken" by us, which is not a conflict.
    const mine = [context.getHotkey(), context.getFullscreenHotkey()].filter(Boolean).map(normalizeAccelerator)
    if (mine.includes(normalized)) return { free: true, ours: true }

    const reserved = reservedByWindows(normalized)
    if (reserved) return { free: false, owner: reserved.owner, hint: reserved.hint }

    let free = false
    try {
      free = globalShortcut.register(normalized, () => undefined)
    } catch {
      free = false
    }
    if (free) {
      try {
        globalShortcut.unregister(normalized)
      } catch {
        // Nothing to undo.
      }
    }
    return { free }
  })

  ipcMain.handle('settings:reset', async () => {
    const next = await settings.update(defaultSettings(defaultDirectory))
    context.onHotkeysChanged?.()
    const effective = context.getHotkey()
    const effectiveFull = context.getFullscreenHotkey()
    return {
      ...next,
      hotkey: effective === next.hotkey ? next.hotkey : effective,
      hotkeyFullscreen: effectiveFull === next.hotkeyFullscreen ? next.hotkeyFullscreen : effectiveFull
    }
  })

  ipcMain.handle('settings:pick-directory', async (event) => {
    const window = senderWindow(event)
    const options = {
      title: 'Папка для сохранения снимков',
      properties: ['openDirectory' as const, 'createDirectory' as const]
    }
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return { canceled: true }
    return { canceled: false, path: result.filePaths[0] }
  })

  // `width` is the CSS width the preview is shown at: the picture is rendered at
  // that width in device pixels, so a wide window gets a wide, sharp preview
  // instead of one stretched from a fixed 960 px render.
  ipcMain.handle('settings:preview', async (_event, width?: number) => renderPreview(await settings.load(), width))

  ipcMain.handle('window:close', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return
    if (window === getSettingsWindow()) closeSettingsWindow()
    else window.close()
  })

  ipcMain.handle('shell:open-folder', async () => {
    const current = await settings.load()
    // The folder may have been deleted or never created: open it either way.
    await mkdir(current.saveDirectory, { recursive: true }).catch(() => undefined)
    const error = await shell.openPath(current.saveDirectory)
    if (error) throw new Error(error)
  })
}
