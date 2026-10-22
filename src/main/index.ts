import { Notification, app, dialog, globalShortcut, shell } from 'electron'
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { HOTKEY } from '../shared/settings'
import { DEFAULT_FULLSCREEN_HOTKEY, FALLBACK_FULLSCREEN_HOTKEY, FALLBACK_HOTKEY, formatAccelerator } from '../shared/hotkey'
import { CaptureSession } from './capture/CaptureSession'
import { stopOcr } from './ocr/worker'
import { warmImaging } from './imaging/compose'
import { registerIpc } from './ipc/registerIpc'
import { SettingsStore } from './settings/SettingsStore'
import { syncAutostart } from './system/autostart'
import { createTray, destroyTray, rebuildMenu } from './ui/tray'
import { getSettingsWindow, openSettingsWindow } from './windows/settingsWindow'

app.setAppUserModelId('com.flushot.app')

/**
 * Windows can be configured with a TEMP folder that no longer exists or is not
 * writable (cleaned profiles, redirected temp, security software). Chromium and
 * Electron then fail with "Error writing temporary file". Detect that early and
 * point Electron at a folder Flushot fully controls.
 */
function ensureUsableTemp(): void {
  const canWrite = (directory: string): boolean => {
    try {
      mkdirSync(directory, { recursive: true })
      const probe = path.join(directory, `.flushot-${process.pid}.tmp`)
      writeFileSync(probe, 'ok')
      unlinkSync(probe)
      return true
    } catch {
      return false
    }
  }

  try {
    if (canWrite(app.getPath('temp'))) return
  } catch {
    // app.getPath('temp') throws when TEMP is missing entirely.
  }

  try {
    const fallback = path.join(app.getPath('userData'), 'temp')
    if (canWrite(fallback)) {
      app.setPath('temp', fallback)
      // Chromium and native modules may read the environment directly.
      process.env.TEMP = fallback
      process.env.TMP = fallback
      console.warn(`Системная папка Temp недоступна, используется ${fallback}`)
    }
  } catch (error) {
    console.error('Не удалось подготовить резервную папку Temp', error)
  }
}

ensureUsableTemp()

let settingsStore: SettingsStore
let session: CaptureSession
let activeHotkey = HOTKEY
/** Combination actually bound to the full-screen capture, '' when none worked. */
let activeFullscreenHotkey = ''

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => activateWindow())

  app
    .whenReady()
    .then(async () => {
      if (process.argv.includes('--self-test')) {
        const { runSelfTest } = await import('./diagnostics/selfTest')
        await initCore()
        app.exit(await runSelfTest(session, settingsStore))
        return
      }
      await bootstrap()
    })
    .catch((error: unknown) => {
      console.error('Не удалось запустить Flushot', error)
      dialog.showErrorBox('Flushot', `Не удалось запустить приложение.\n\n${String(error)}`)
      app.quit()
    })
}

function notify(message: string, title = 'Flushot'): void {
  try {
    if (Notification.isSupported()) {
      new Notification({ title, body: message, silent: true }).show()
      return
    }
  } catch (error) {
    console.warn('Не удалось показать уведомление', error)
  }
  console.warn(`${title}: ${message}`)
}

function trayActions(): Parameters<typeof rebuildMenu>[0] {
  return {
    capture: () => void startCapture(),
    captureFullscreen: () => void startCapture({ fullscreen: true }),
    openSettings: () => openSettingsWindow({ closeCapture: () => session.cancel() }),
    openFolder: () => {
      void settingsStore.load().then((current) => shell.openPath(current.saveDirectory))
    },
    hotkey: activeHotkey,
    hotkeyFullscreen: activeFullscreenHotkey,
    quit: () => app.quit()
  }
}

/** Settings store, capture session and IPC handlers. */
async function initCore(): Promise<void> {
  const defaultDirectory = path.join(app.getPath('pictures'), 'Flushot')
  settingsStore = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'), defaultDirectory)
  await settingsStore.load()

  session = new CaptureSession({
    settings: settingsStore,
    onError: (message) => notify(message, 'Flushot — ошибка'),
    onStateChange: () => rebuildMenu(trayActions())
  })

  registerIpc({
    session,
    settings: settingsStore,
    getHotkey: () => activeHotkey,
    getFullscreenHotkey: () => activeFullscreenHotkey,
    defaultDirectory,
    onHotkeysChanged: () => applyHotkeyChange(),
    openSettings: () => openSettingsWindow({ closeCapture: () => session.cancel() })
  })
}

async function bootstrap(): Promise<void> {
  await initCore()
  // Shortcuts and autostart are conveniences, not prerequisites: if either
  // misbehaves the app must still open. A throw here used to surface as
  // "Не удалось запустить приложение" and quit before any window existed.
  try {
    registerGlobalHotkey()
  } catch (error) {
    console.error('Не удалось назначить горячие клавиши', error)
    notify('Горячие клавиши не назначены — задайте их в настройках.', 'Flushot')
  }
  await createTray(trayActions())

  // Keep the Windows Run entry in step with the saved preference: the registry
  // survives reinstalls and can be edited by other tools, so it is re-asserted
  // once per launch instead of being trusted blindly.
  const stored = settingsStore.peek()
  if (stored) {
    const actual = syncAutostart(stored.launchAtLogin)
    if (actual !== stored.launchAtLogin) {
      void settingsStore.update({ launchAtLogin: actual })
      if (stored.launchAtLogin && !actual) {
        notify('Не удалось включить автозапуск: Windows отклонила изменение.', 'Flushot')
      }
    }
  }

  // The settings window comes first: it is what the user is waiting for at
  // launch. Building the overlay pool before it would put two extra renderers
  // and a libvips warm-up in front of the first visible pixel.
  const settingsWindow = process.argv.includes('--hidden')
    ? null
    : openSettingsWindow({ closeCapture: () => session.cancel() })

  const warmUp = (): void => {
    // Build the overlay pool while the app is idle, so the very first hotkey does
    // not pay for creating windows and booting their renderer.
    session?.prewarm()
    // Warm the imaging engine as well. Its first call in a process pays for lazy
    // libvips initialisation; without this the cost lands on the first Ctrl+C.
    setTimeout(() => {
      void warmImaging().catch(() => undefined)
    }, 1200)
  }

  if (settingsWindow) {
    // Deferred until the window is actually on screen. `ready-to-show` may have
    // fired already on a warm disk, so a destroyed window is treated as "shown".
    if (settingsWindow.isVisible()) {
      warmUp()
    } else {
      settingsWindow.once('ready-to-show', warmUp)
    }
  } else {
    warmUp()
  }

  process.on('uncaughtException', (error) => {
    console.error('Необработанная ошибка', error)
    notify(`Непредвиденная ошибка: ${error.message}`, 'Flushot')
  })
  process.on('unhandledRejection', (reason) => {
    console.error('Необработанный отказ промиса', reason)
  })
}

/**
 * Register a global shortcut without ever throwing.
 *
 * `globalShortcut.register` throws a `TypeError` for an accelerator it cannot
 * parse — and a single bad value used to abort startup with "Не удалось
 * запустить приложение" before any window appeared. A shortcut that cannot be
 * bound is a degraded feature, never a fatal error: the caller falls back.
 */
function bindShortcut(accelerator: string, handler: () => void): boolean {
  if (!accelerator) return false
  try {
    return globalShortcut.register(accelerator, handler)
  } catch (error) {
    console.warn(`Сочетание ${accelerator} не принимается системой`, error)
    return false
  }
}

/**
 * Bind both global shortcuts from scratch.
 *
 * They are bound as a pair and always together: Windows hands a combination to
 * one handler only, so the second key must be registered knowing which
 * combination the first one actually took. A key that cannot be bound is
 * reported as `''` rather than as the value the user asked for — otherwise the
 * settings window would show a combination that does nothing.
 */
function registerGlobalHotkey(): void {
  const settings = settingsStore.peek()
  const preferred = settings?.hotkey || HOTKEY
  const preferredFull = settings?.hotkeyFullscreen || DEFAULT_FULLSCREEN_HOTKEY

  try {
    globalShortcut.unregisterAll()
  } catch (error) {
    console.warn('Не удалось освободить прежние сочетания', error)
  }
  activeHotkey = ''
  activeFullscreenHotkey = ''

  // Region key first: it is the one the product is built around.
  for (const candidate of [preferred, FALLBACK_HOTKEY]) {
    if (bindShortcut(candidate, () => void startCapture())) {
      activeHotkey = candidate
      break
    }
  }

  if (!activeHotkey) {
    notify(`Не удалось назначить ${formatAccelerator(preferred)} — выберите другое сочетание в настройках.`, 'Flushot')
  } else if (activeHotkey !== preferred) {
    notify(`${formatAccelerator(preferred)} занята другой программой. Flushot использует ${formatAccelerator(activeHotkey)}.`)
  }

  // Then the full-screen key, skipping whatever the region key already holds.
  for (const candidate of [preferredFull, FALLBACK_FULLSCREEN_HOTKEY]) {
    if (candidate === activeHotkey) continue
    if (bindShortcut(candidate, () => void startCapture({ fullscreen: true }))) {
      activeFullscreenHotkey = candidate
      break
    }
  }

  if (!activeFullscreenHotkey) {
    notify(
      `Не удалось назначить ${formatAccelerator(preferredFull)} для снимка всего экрана — выберите другое сочетание в настройках.`,
      'Flushot'
    )
  } else if (activeFullscreenHotkey !== preferredFull) {
    notify(
      `${formatAccelerator(preferredFull)} занята другой программой. Снимок всего экрана — ${formatAccelerator(activeFullscreenHotkey)}.`
    )
  }
}

/**
 * Re-bind both global shortcuts after the user saved a new combination.
 *
 * Deliberately unconditional: the two keys are bound as a pair, because a
 * full-screen combination equal to the region one cannot be registered twice.
 * An earlier version returned early when the *region* accelerator had not
 * changed, which is exactly what happens when the user edits only the
 * full-screen key — the new key was never bound, and the window then reported it
 * as "taken".
 */
function applyHotkeyChange(): void {
  registerGlobalHotkey()
  rebuildMenu(trayActions())
}

async function startCapture(options: { fullscreen?: boolean } = {}): Promise<void> {
  if (!session || session.isActive) return
  getSettingsWindow()?.hide()
  try {
    await session.start(options)
  } catch (error) {
    notify(error instanceof Error ? error.message : 'Не удалось начать захват', 'Flushot')
  }
}

function activateWindow(): void {
  if (!app.isReady() || session?.isActive) return
  openSettingsWindow({ closeCapture: () => session.cancel() })
}

app.on('activate', () => activateWindow())

app.on('window-all-closed', () => {
  // Flushot lives in the tray: closing the settings window keeps the hotkey alive.
})

app.on('before-quit', () => {
  globalShortcut.unregisterAll()
  session?.destroyOverlays()
  destroyTray()
  // The OCR worker is a separate PowerShell process; quitting must not leave it
  // behind, and nothing else would ever stop it.
  stopOcr()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})
