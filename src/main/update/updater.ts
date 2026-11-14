import { app } from 'electron'
import { promises as fs, readdirSync } from 'node:fs'
import path from 'node:path'
import { autoUpdater } from 'electron-updater'
import { tr } from '../i18n'
import type { ManualInstall, UpdateState } from '../../shared/types'
import { canSelfUpdate, detectInstallKind, type InstallKind } from './installKind'

export type { ManualInstall, UpdateState }

/** How long a successful check stays quiet before the next one. */
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

export interface UpdateDeps {
  /** Reads the saved preference; the updater never caches it. */
  enabled: () => boolean
  /** Tray menu and settings window both need the new state. */
  onState: (state: UpdateState) => void
  /** A message worth interrupting the user, in their language. */
  notify: (message: string) => void
  /** Where the "last checked" timestamp is kept. */
  stateFile: string
  /**
   * Whether to schedule the daily check. The self-test turns it off: it has to stay
   * offline, and a check that fired mid-run would make the report depend on GitHub.
   */
  autoCheck?: boolean
}

let deps: UpdateDeps | null = null
let state: UpdateState = { kind: 'idle' }
let lastCheck = 0
let timer: NodeJS.Timeout | null = null
let wired = false
let checking = false

/** Which kind of build is running; see `detectInstallKind`. */
export function installKind(executable: string = process.execPath): InstallKind {
  let entries: string[] = []
  try {
    entries = readdirSync(path.dirname(executable))
  } catch {
    // The folder of the executable is unreadable: treat it as "no uninstaller",
    // which makes the app claim it cannot update rather than promise and fail.
    entries = []
  }
  return detectInstallKind({
    packaged: app.isPackaged,
    portableDirectory: process.env.PORTABLE_EXECUTABLE_DIR,
    entries
  })
}

export function updateState(): UpdateState {
  return state
}

function publish(next: UpdateState): void {
  state = next
  deps?.onState(next)
}

/** Whether the running build can look for updates at all, ignoring the preference. */
export function canUpdate(): boolean {
  return canSelfUpdate(installKind())
}

async function readLastCheck(file: string): Promise<number> {
  try {
    const raw = JSON.parse(await fs.readFile(file, 'utf8')) as { lastCheck?: unknown }
    return typeof raw.lastCheck === 'number' && Number.isFinite(raw.lastCheck) ? raw.lastCheck : 0
  } catch {
    return 0
  }
}

async function writeLastCheck(file: string, value: number): Promise<void> {
  try {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, JSON.stringify({ lastCheck: value }, null, 2), 'utf8')
  } catch {
    // A timestamp is a convenience: failing to save it costs one extra request.
  }
}

/**
 * Wire the updater to the app and start the daily timer.
 *
 * Called once, after the settings are loaded, because the state depends on the
 * preference. `electron-updater` is only touched for a build that can use it: in
 * development it throws on every call, and on a portable build it would try to
 * replace the temporary folder.
 */
export async function initUpdater(options: UpdateDeps): Promise<void> {
  deps = options
  const kind = installKind()

  if (kind !== 'installed') {
    publish({ kind: 'manual', install: kind })
    return
  }

  lastCheck = await readLastCheck(options.stateFile)
  if (!options.enabled()) {
    publish({ kind: 'off' })
    return
  }

  wire()
  if (options.autoCheck === false) return
  // A quiet check shortly after launch, not during it: the first seconds belong to
  // the tray icon and the hotkeys, and a screenshot key that arrives while the
  // updater is busy should still open instantly.
  setTimeout(() => {
    if (options.enabled() && due()) void checkUpdates(false)
  }, 12_000)

  timer = setInterval(() => {
    if (options.enabled() && due()) void checkUpdates(false)
  }, 60 * 60 * 1000)
  // The app lives in the tray for days; a timer that keeps the process awake would
  // show up in the battery report for no benefit.
  timer.unref?.()
}

function due(): boolean {
  return Date.now() - lastCheck >= CHECK_INTERVAL_MS
}

function wire(): void {
  if (wired) return
  wired = true

  autoUpdater.autoDownload = true
  // Install on the next ordinary quit: the user asked for updates to happen, but
  // not to have the app close while they were drawing a region.
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowDowngrade = false
  // Warnings from the library are not ours to show, and its own logger writes to a
  // console a packaged app does not have.
  autoUpdater.logger = null

  autoUpdater.on('checking-for-update', () => publish({ kind: 'checking' }))

  autoUpdater.on('update-not-available', (info) => {
    lastCheck = Date.now()
    if (deps) void writeLastCheck(deps.stateFile, lastCheck)
    publish({ kind: 'current', version: info?.version ?? app.getVersion(), checkedAt: lastCheck })
  })

  autoUpdater.on('update-available', (info) => {
    publish({ kind: 'downloading', version: info.version, percent: 0 })
  })

  autoUpdater.on('download-progress', (progress) => {
    const version = state.kind === 'downloading' ? state.version : ''
    publish({ kind: 'downloading', version, percent: Math.round(progress.percent) })
  })

  autoUpdater.on('update-downloaded', (info) => {
    lastCheck = Date.now()
    if (deps) void writeLastCheck(deps.stateFile, lastCheck)
    publish({ kind: 'ready', version: info.version })
    deps?.notify(tr('update.readyNotify', { version: info.version }))
  })

  autoUpdater.on('error', (error) => {
    // A machine that is offline, behind a proxy, or simply has GitHub blocked is
    // not an error the user needs to see: the check is silent by design, so a
    // failure is recorded and the next one happens tomorrow.
    lastCheck = Date.now()
    if (deps) void writeLastCheck(deps.stateFile, lastCheck)
    publish({ kind: 'failed', message: messageOf(error), checkedAt: lastCheck })
  })
}

function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  // The library puts a request dump after the first line; the first line is the
  // part a person can act on.
  return text.split('\n')[0].slice(0, 300)
}

/**
 * Ask GitHub for the newest release. `manual` means the user pressed the button, so
 * the answer is always reported, even when it is "no update".
 */
export async function checkUpdates(manual: boolean): Promise<UpdateState> {
  if (!deps) return state
  if (!deps.enabled()) {
    publish({ kind: 'off' })
    return state
  }
  if (installKind() !== 'installed') {
    publish({ kind: 'manual', install: installKind() as ManualInstall })
    return state
  }
  // One request at a time: the daily timer and the button can meet.
  if (checking) return state
  if (state.kind === 'downloading' || state.kind === 'ready') return state

  checking = true
  wire()
  try {
    await autoUpdater.checkForUpdates()
  } catch (error) {
    lastCheck = Date.now()
    await writeLastCheck(deps.stateFile, lastCheck).catch(() => undefined)
    publish({ kind: 'failed', message: messageOf(error), checkedAt: lastCheck })
  } finally {
    checking = false
  }

  // Asked explicitly and the answer was "you are current": say so, because a
  // button that appears to do nothing is indistinguishable from a broken one.
  if (manual && state.kind === 'current') {
    deps.notify(tr('update.currentNotify', { version: state.version }))
  }
  return state
}

/** Quit and apply a downloaded update now. */
export function installUpdate(): void {
  if (state.kind !== 'ready') return
  // `isSilent` keeps the NSIS window out of the way, `isForceRunAfter` brings the
  // app back afterwards — without it the user would have to find the icon again.
  setImmediate(() => autoUpdater.quitAndInstall(true, true))
}

/** React to the preference being switched while the app runs. */
export async function setUpdatesEnabled(enabled: boolean): Promise<void> {
  if (!deps) return
  if (installKind() !== 'installed') {
    publish({ kind: 'manual', install: installKind() as ManualInstall })
    return
  }
  if (!enabled) {
    publish({ kind: 'off' })
    return
  }
  publish({ kind: 'idle' })
  await checkUpdates(false)
}

/** True when a downloaded update is waiting for a restart. */
export function isUpdateReady(): boolean {
  return state.kind === 'ready'
}

export function stopUpdater(): void {
  if (timer) clearInterval(timer)
  timer = null
}
