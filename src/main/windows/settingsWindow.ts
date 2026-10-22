import { BrowserWindow } from 'electron'
import { getAppIcon } from '../ui/icon'
import { preloadPath, rendererUrl } from './paths'

let settingsWindow: BrowserWindow | null = null

export function getSettingsWindow(): BrowserWindow | null {
  return settingsWindow && !settingsWindow.isDestroyed() ? settingsWindow : null
}

export function openSettingsWindow(options: { closeCapture?: () => void } = {}): BrowserWindow {
  const existing = getSettingsWindow()
  if (existing) {
    if (existing.isMinimized()) existing.restore()
    existing.show()
    existing.focus()
    return existing
  }

  // A full-screen overlay would cover the settings window, so the capture
  // session is cancelled first.
  options.closeCapture?.()

  const window = new BrowserWindow({
    width: 520,
    height: 820,
    // The interface wraps instead of overflowing, so it may be squeezed this far.
    minWidth: 400,
    minHeight: 520,
    show: false,
    title: 'Flushot',
    backgroundColor: '#F5F5F7',
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 16, y: 18 },
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  })

  window.setMenuBarVisibility(false)
  void getAppIcon(256).then((icon) => {
    if (!window.isDestroyed()) window.setIcon(icon)
  })

  const { kind, value } = rendererUrl('settings')
  const load = kind === 'url' ? window.loadURL(value) : window.loadFile(value)
  void load.catch((error: unknown) => {
    window.destroy()
    console.error('Не удалось загрузить окно настроек', error)
  })

  window.once('ready-to-show', () => {
    window.show()
    window.focus()
  })

  window.on('closed', () => {
    settingsWindow = null
  })

  settingsWindow = window
  return window
}

export function closeSettingsWindow(): void {
  const window = getSettingsWindow()
  if (window) window.close()
}

export function focusOrOpenSettings(closeCapture?: () => void): void {
  openSettingsWindow({ closeCapture })
}
