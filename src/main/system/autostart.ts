import { app } from 'electron'
import { resolveLaunchTarget, type LaunchTarget } from '../../shared/launch'

export type { LaunchTarget }

/**
 * "Start with Windows".
 *
 * Electron writes the entry into `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`,
 * so no installer and no elevation are needed. Two details make it work for a
 * screenshot tool:
 *
 * 1. The command starts Flushot with `--hidden`, otherwise a login would pop the
 *    settings window on top of whatever the user is doing.
 * 2. A portable build runs from a temporary extraction folder, so
 *    `process.execPath` points at a path that disappears. electron-builder
 *    exposes the real portable exe as `PORTABLE_EXECUTABLE_FILE`; that is the
 *    path the entry has to contain.
 *
 * The write and the read use the same arguments on purpose: Electron compares
 * the stored command line with `path` + `args`, so passing them asymmetrically
 * makes every read report "off" no matter what the registry says.
 */

/** Where Windows should start Flushot from, and with which arguments. */
export function launchTarget(): LaunchTarget {
  return resolveLaunchTarget({
    portable: process.env.PORTABLE_EXECUTABLE_FILE,
    execPath: process.execPath,
    packaged: app.isPackaged,
    appPath: app.getAppPath()
  })
}

/** Is the Run entry present *and* pointing at this executable with these arguments? */
export function isAutostartEnabled(): boolean {
  try {
    const target = launchTarget()
    return app.getLoginItemSettings({ path: target.path, args: target.args }).openAtLogin
  } catch (error) {
    console.error('Не удалось прочитать автозапуск', error)
    return false
  }
}

/**
 * Create or remove the Run entry.
 *
 * Returns the state Windows reports afterwards, not the requested one: a locked
 * profile or a group policy can refuse the write, and the settings window should
 * then show the truth instead of a tick that does nothing.
 */
export function setAutostart(enabled: boolean): boolean {
  const target = launchTarget()
  try {
    app.setLoginItemSettings({ openAtLogin: enabled, path: target.path, args: target.args })
  } catch (error) {
    console.error('Не удалось изменить автозапуск', error)
  }
  return isAutostartEnabled()
}

/**
 * Re-apply the stored preference at startup.
 *
 * The registry lives outside the app, so it can be changed by another tool, by a
 * Windows update or by moving the exe. Re-asserting it once per launch keeps the
 * saved setting and the real system state in agreement.
 */
export function syncAutostart(preferred: boolean): boolean {
  if (isAutostartEnabled() === preferred) return preferred
  return setAutostart(preferred)
}
