/**
 * Where the Windows "Run" entry should point.
 *
 * Kept free of Electron imports so the awkward cases — portable builds, dev
 * builds — can be unit-tested without starting the app.
 */

export interface LaunchTarget {
  /** Executable the registry entry should launch. */
  path: string
  args: string[]
}

export interface LaunchInputs {
  /** `PORTABLE_EXECUTABLE_FILE`: the real portable exe, if this is a portable build. */
  portable?: string
  /** `process.execPath`. */
  execPath: string
  /** `app.isPackaged`. */
  packaged: boolean
  /** `app.getAppPath()`. */
  appPath: string
}

export function resolveLaunchTarget(inputs: LaunchInputs): LaunchTarget {
  const portable = inputs.portable
  const executable = portable && portable.length > 0 ? portable : inputs.execPath
  // In development `execPath` is Electron itself, so the app directory has to be
  // passed as the first argument or Windows would launch an empty Electron shell.
  const args = inputs.packaged ? ['--hidden'] : [inputs.appPath, '--hidden']
  return { path: executable, args }
}
