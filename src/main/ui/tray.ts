import { Menu, Tray, app, nativeTheme } from 'electron'
import { formatAccelerator } from '../../shared/hotkey'
import { HOTKEY } from '../../shared/settings'
import { getTrayIcon } from './icon'

let tray: Tray | null = null
let followingTheme = false

export interface TrayActions {
  capture: () => void
  /** Grab the whole screen with the region already selected. */
  captureFullscreen: () => void
  openSettings: () => void
  openFolder: () => void
  /** Effective accelerator, which may differ from the configured one when it was taken. */
  hotkey?: string
  /** Effective full-screen accelerator, or '' when it could not be bound. */
  hotkeyFullscreen?: string
  quit: () => void
}

export async function createTray(actions: TrayActions): Promise<Tray | null> {
  if (tray) return tray
  try {
    // The tray sits on the taskbar, so it follows the Windows theme and not the app's.
    // `shouldUseDarkColors` is the shell's answer, which is the one that matters: the
    // mark's own tile is #111111 and would be invisible on a dark taskbar.
    const icon = await getTrayIcon(nativeTheme.shouldUseDarkColors)
    tray = new Tray(icon)
    tray.setToolTip(tooltip(actions.hotkey))
    rebuildMenu(actions)
    tray.on('click', () => actions.capture())
    tray.on('double-click', () => actions.openSettings())
    followTheme()
    return tray
  } catch (error) {
    console.error('Не удалось создать значок в трее', error)
    return null
  }
}

/**
 * Swap the tray image when Windows switches between light and dark.
 *
 * Without this the icon keeps the colouring it was created with, which is wrong for
 * half of the time the app is running — a dark-on-dark square is not a visible icon.
 */
function followTheme(): void {
  if (followingTheme) return
  followingTheme = true
  nativeTheme.on('updated', () => {
    if (!tray || tray.isDestroyed()) return
    void getTrayIcon(nativeTheme.shouldUseDarkColors).then((image) => {
      if (tray && !tray.isDestroyed()) tray.setImage(image)
    })
  })
}

/** Empty accelerator means "nothing could be bound", which must not read as a key. */
function hotkeyLabel(value: string | undefined): string {
  return value ? formatAccelerator(value) : 'не назначена'
}

function tooltip(value: string | undefined): string {
  return `Flushot — снимок экрана (${hotkeyLabel(value)})`
}

export function rebuildMenu(actions: TrayActions): void {
  if (!tray) return
  const hotkey = actions.hotkey ?? HOTKEY
  tray.setToolTip(tooltip(actions.hotkey))
  const menu = Menu.buildFromTemplate([
    {
      label: 'Сделать снимок',
      // An empty accelerator would show a blank hint and do nothing, so it is
      // dropped rather than rendered as an empty key.
      accelerator: hotkey || undefined,
      click: actions.capture
    },
    {
      label: 'Снимок всего экрана',
      accelerator: actions.hotkeyFullscreen || undefined,
      click: actions.captureFullscreen
    },
    { type: 'separator' },
    { label: 'Настройки…', click: actions.openSettings },
    { label: 'Открыть папку сохранения', click: actions.openFolder },
    { type: 'separator' },
    { label: `Flushot ${app.getVersion()}`, enabled: false },
    { label: 'Выход', click: actions.quit }
  ])
  tray.setContextMenu(menu)
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
