/**
 * Which kind of build is running, decided without touching Electron.
 *
 * Kept apart from the updater so it can be tested: `electron-updater` only replaces
 * an installation through the NSIS uninstaller, so the answer decides whether the
 * menu offers an update at all. Everything it needs is passed in.
 */

import type { ManualInstall } from '../../shared/types'

/**
 * `installed` is the only kind that can replace itself; the other three are exactly
 * the reason a `manual` state carries, so the two share their names.
 */
export type InstallKind = ManualInstall | 'installed'

export interface InstallProbe {
  /** `app.isPackaged`. A development run has no release to update to. */
  packaged: boolean
  /**
   * `PORTABLE_EXECUTABLE_DIR`, which electron-builder's portable target sets for the
   * lifetime of the process. The portable build unpacks itself into `%TEMP%` on
   * every launch, so updating it would write into a folder Windows deletes.
   */
  portableDirectory: string | undefined
  /** Names of the files beside the executable. */
  entries: string[]
}

/**
 * The uninstaller is found by shape rather than by exact name: NSIS derives it from
 * the product name, so this keeps working if that name ever changes.
 */
export function detectInstallKind(probe: InstallProbe): InstallKind {
  if (!probe.packaged) return 'development'
  if (probe.portableDirectory) return 'portable'
  const hasUninstaller = probe.entries.some((name) => /^uninstall.*\.exe$/i.test(name))
  return hasUninstaller ? 'installed' : 'unpacked'
}

/**
 * Whether `electron-updater` can replace this build.
 *
 * Only a real installation can: an unpacked archive has no uninstaller for the
 * updater to run, and the portable build lives in a temporary folder.
 */
export function canSelfUpdate(kind: InstallKind): boolean {
  return kind === 'installed'
}
