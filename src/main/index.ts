import { Notification, app, dialog, globalShortcut, shell } from 'electron'
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { HOTKEY } from '../shared/settings'
import { DEFAULT_FULLSCREEN_HOTKEY, DEFAULT_UPLOAD_HOTKEY, FALLBACK_FULLSCREEN_HOTKEY, FALLBACK_HOTKEY, FALLBACK_UPLOAD_HOTKEY, formatAccelerator } from '../shared/hotkey'
import { CaptureSession } from './capture/CaptureSession'
import { stopOcr } from './ocr/worker'
import { warmImaging } from './imaging/compose'
import { registerIpc } from './ipc/registerIpc'
import { SettingsStore } from './settings/SettingsStore'
import { syncAutostart } from './system/autostart'
import { createTray, destroyTray, rebuildMenu } from './ui/tray'
import { getSettingsWindow, openSettingsWindow } from './windows/settingsWindow'
import { setLanguage, tr } from './i18n'
import {
  canUpdate,
  checkUpdates,
  initUpdater,
  installUpdate,
  setUpdatesEnabled,
  stopUpdater,
  updateState,
  type UpdateState
} from './update/updater'

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
      console.warn(tr('app.tempUnavailable', { fallback }))
    }
  } catch (error) {
    console.error(tr('app.tempPrepareFailed'), error)
  }
}

ensureUsableTemp()

let settingsStore: SettingsStore
let session: CaptureSession
let activeHotkey = HOTKEY
/** Combination actually bound to the full-screen capture, '' when none worked. */
let activeFullscreenHotkey = ''
/** Combination actually bound to capture-and-upload, '' when none worked. */
let activeUploadHotkey = ''

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
      // One-shot upload check from a terminal; see `upload/uploadCheck.ts`.
      if (process.argv.includes('--upload-check')) {
        const { runUploadCheck } = await import('./upload/uploadCheck')
        await initCore()
        app.exit(await runUploadCheck(process.argv))
        return
      }
      // One-shot update check from a terminal; see `update/updateCheck.ts`.
      if (process.argv.includes('--update-check')) {
        const { runUpdateCheck } = await import('./update/updateCheck')
        await initCore()
        app.exit(await runUpdateCheck(process.argv))
        return
      }
      await bootstrap()
    })
    .catch((error: unknown) => {
      console.error(tr('app.startFailed'), error)
      dialog.showErrorBox('Flushot', tr('app.startFailedDetail', { detail: String(error) }))
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
    console.warn(tr('app.notificationFailed'), error)
  }
  console.warn(`${title}: ${message}`)
}

function trayActions(): Parameters<typeof rebuildMenu>[0] {
  return {
    capture: () => void startCapture(),
    captureFullscreen: () => void startCapture({ fullscreen: true }),
    captureUpload: () => void startCapture({ upload: true }),
    openSettings: () => openSettingsWindow({ closeCapture: () => session.cancel() }),
    openFolder: () => {
      void settingsStore.load().then((current) => shell.openPath(current.saveDirectory))
    },
    hotkey: activeHotkey,
    hotkeyFullscreen: activeFullscreenHotkey,
    hotkeyUpload: activeUploadHotkey,
    update: trayUpdate(),
    quit: () => app.quit()
  }
}

/**
 * One row for whatever the updater is doing, or nothing when it cannot do anything.
 *
 * A portable build has no row at all: offering "check for updates" in a menu to
 * someone whose copy can never be replaced would be a promise the app cannot keep.
 */
function trayUpdate(): Parameters<typeof rebuildMenu>[0]['update'] {
  const state = updateState()
  if (!canUpdate()) return undefined
  if (state.kind === 'ready') {
    return { label: tr('tray.updateReady', { version: state.version }), enabled: true, action: () => installUpdate() }
  }
  const busy = state.kind === 'checking' || state.kind === 'downloading'
  return {
    label: busy ? tr('tray.checkingUpdates') : tr('tray.checkUpdates'),
    enabled: !busy,
    action: () => void checkUpdates(true)
  }
}

/** Settings store, capture session and IPC handlers. */
async function initCore(): Promise<void> {
  const defaultDirectory = path.join(app.getPath('pictures'), 'Flushot')
  settingsStore = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'), defaultDirectory)
  await settingsStore.load()
  // Before anything can speak: the tray, the first notification and every error
  // go through `tr`, and they must already be in the user's language.
  setLanguage(settingsStore.peek()?.language, app.getLocale())

  session = new CaptureSession({
    settings: settingsStore,
    onError: (message) => notify(message, tr('app.notifyTitle')),
    onNotice: (message) => notify(message, tr('upload.noticeTitle')),
    onStateChange: () => rebuildMenu(trayActions())
  })

  registerIpc({
    session,
    settings: settingsStore,
    getHotkey: () => activeHotkey,
    getFullscreenHotkey: () => activeFullscreenHotkey,
    getUploadHotkey: () => activeUploadHotkey,
    defaultDirectory,
    onHotkeysChanged: () => applyHotkeyChange(),
    // Language lives in the settings file like everything else, so a change has
    // to reach the tray menu too — it is the one piece of the interface that is
    // built outside the renderer. The overlay picks the new value up on the next
    // capture, because it reads the settings when it opens.
    onSettingsChanged: () => {
      setLanguage(settingsStore.peek()?.language, app.getLocale())
      rebuildMenu(trayActions())
    },
    onUpdatesChanged: (enabled) => {
      void setUpdatesEnabled(enabled).then(() => rebuildMenu(trayActions()))
    },
    updateState,
    checkUpdates: async (): Promise<UpdateState> => {
      const state = await checkUpdates(true)
      rebuildMenu(trayActions())
      return state
    },
    installUpdate: () => installUpdate(),
    openSettings: () => openSettingsWindow({ closeCapture: () => session.cancel() })
  })

  // Started here rather than in `bootstrap` so the settings window always has a
  // state to render, including under `--self-test`. Nothing reaches the network
  // until the first scheduled check, and a build that cannot update itself only
  // records that fact.
  void initUpdater({
    enabled: () => settingsStore.peek()?.checkUpdates ?? true,
    onState: () => rebuildMenu(trayActions()),
    notify,
    stateFile: path.join(app.getPath('userData'), 'update-state.json'),
    // The report must not depend on the network or on the clock.
    autoCheck: !process.argv.includes('--self-test')
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
    console.error(tr('app.hotkeysFailed'), error)
    notify(tr('app.hotkeysNotAssigned'), 'Flushot')
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
        notify(tr('app.autostartRejected'), 'Flushot')
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
    console.error(tr('app.unhandledError'), error)
    notify(tr('app.unexpectedError', { message: error.message }), 'Flushot')
  })
  process.on('unhandledRejection', (reason) => {
    console.error(tr('app.unhandledRejection'), reason)
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
    console.warn(tr('app.comboRejected', { combo: accelerator }), error)
    return false
  }
}

/**
 * Bind all three global shortcuts from scratch.
 *
 * They are bound as a set and always together: Windows hands a combination to one
 * handler only, so each key must be registered knowing which combinations the ones
 * before it actually took. A key that cannot be bound is reported as `''` rather than
 * as the value the user asked for — otherwise the settings window would show a
 * combination that does nothing.
 */
function registerGlobalHotkey(): void {
  const settings = settingsStore.peek()
  const preferred = settings?.hotkey || HOTKEY
  const preferredFull = settings?.hotkeyFullscreen || DEFAULT_FULLSCREEN_HOTKEY
  const preferredUpload = settings?.hotkeyUpload || DEFAULT_UPLOAD_HOTKEY

  try {
    globalShortcut.unregisterAll()
  } catch (error) {
    console.warn(tr('app.hotkeysReleaseFailed'), error)
  }
  activeHotkey = ''
  activeFullscreenHotkey = ''
  activeUploadHotkey = ''

  // Region key first: it is the one the product is built around.
  for (const candidate of [preferred, FALLBACK_HOTKEY]) {
    if (bindShortcut(candidate, () => void startCapture())) {
      activeHotkey = candidate
      break
    }
  }

  if (!activeHotkey) {
    notify(tr('app.hotkeyUnavailable', { combo: formatAccelerator(preferred) }), 'Flushot')
  } else if (activeHotkey !== preferred) {
    notify(tr('app.hotkeyTaken', { combo: formatAccelerator(preferred), active: formatAccelerator(activeHotkey) }))
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
      tr('app.fullscreenHotkeyUnavailable', { combo: formatAccelerator(preferredFull) }),
      'Flushot'
    )
  } else if (activeFullscreenHotkey !== preferredFull) {
    notify(
      tr('app.fullscreenHotkeyTaken', {
        combo: formatAccelerator(preferredFull),
        active: formatAccelerator(activeFullscreenHotkey)
      })
    )
  }

  // And the upload key, skipping both of the above.
  for (const candidate of [preferredUpload, FALLBACK_UPLOAD_HOTKEY]) {
    if (candidate === activeHotkey || candidate === activeFullscreenHotkey) continue
    if (bindShortcut(candidate, () => void startCapture({ upload: true }))) {
      activeUploadHotkey = candidate
      break
    }
  }

  if (!activeUploadHotkey) {
    notify(tr('app.uploadHotkeyUnavailable', { combo: formatAccelerator(preferredUpload) }), 'Flushot')
  } else if (activeUploadHotkey !== preferredUpload) {
    notify(
      tr('app.uploadHotkeyTaken', {
        combo: formatAccelerator(preferredUpload),
        active: formatAccelerator(activeUploadHotkey)
      })
    )
  }
}

/**
 * Re-bind all global shortcuts after the user saved a new combination.
 *
 * Deliberately unconditional: the keys are bound as a set, because a full-screen
 * combination equal to the region one cannot be registered twice. An earlier version
 * returned early when the *region* accelerator had not changed, which is exactly what
 * happens when the user edits only the full-screen key — the new key was never bound,
 * and the window then reported it as "taken".
 */
function applyHotkeyChange(): void {
  registerGlobalHotkey()
  rebuildMenu(trayActions())
}

async function startCapture(options: { fullscreen?: boolean; upload?: boolean } = {}): Promise<void> {
  if (!session || session.isActive) return
  getSettingsWindow()?.hide()
  try {
    await session.start(options)
  } catch (error) {
    notify(error instanceof Error ? error.message : tr('app.captureFailed'), 'Flushot')
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
  stopUpdater()
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
