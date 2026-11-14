import { describe, expect, it } from 'vitest'
import {
  canSelfUpdate,
  detectInstallKind,
  type InstallProbe
} from '../src/main/update/installKind'

/** A packaged NSIS installation: the only shape that can replace itself. */
function installed(overrides: Partial<InstallProbe> = {}): InstallProbe {
  return {
    packaged: true,
    portableDirectory: undefined,
    entries: ['Flushot.exe', 'Uninstall Flushot.exe', 'resources'],
    ...overrides
  }
}

describe('detectInstallKind', () => {
  it('recognises an installed copy by its uninstaller', () => {
    expect(detectInstallKind(installed())).toBe('installed')
  })

  it('treats a development run as unable to update', () => {
    expect(detectInstallKind(installed({ packaged: false }))).toBe('development')
  })

  it('recognises the portable build from its environment marker', () => {
    // The portable target unpacks into %TEMP% and sets PORTABLE_EXECUTABLE_DIR.
    // It also ships no uninstaller, so both signals agree.
    const probe = installed({ portableDirectory: 'C:\\Users\\Test\\Downloads', entries: ['Flushot.exe'] })
    expect(detectInstallKind(probe)).toBe('portable')
  })

  it('prefers the portable marker over an uninstaller it may share a folder with', () => {
    const probe = installed({ portableDirectory: 'C:\\Users\\Test\\Downloads' })
    expect(detectInstallKind(probe)).toBe('portable')
  })

  it('calls an unpacked archive unpacked', () => {
    const probe = installed({ entries: ['Flushot.exe', 'resources', 'locales'] })
    expect(detectInstallKind(probe)).toBe('unpacked')
  })

  it('does not mistake a random exe for the uninstaller', () => {
    const probe = installed({ entries: ['Flushot.exe', 'uninstallNotes.txt', 'installer.ico'] })
    expect(detectInstallKind(probe)).toBe('unpacked')
  })

  it('matches the uninstaller whatever NSIS named it', () => {
    // NSIS derives the name from the product name, which is why the check is by
    // shape and not by a literal string.
    expect(detectInstallKind(installed({ entries: ['Uninstall.exe'] }))).toBe('installed')
    expect(detectInstallKind(installed({ entries: ['unins000.exe'] }))).toBe('unpacked')
  })

  it('survives an unreadable directory', () => {
    expect(detectInstallKind(installed({ entries: [] }))).toBe('unpacked')
  })
})

describe('canSelfUpdate', () => {
  it('allows only a real installation', () => {
    expect(canSelfUpdate('installed')).toBe(true)
    expect(canSelfUpdate('portable')).toBe(false)
    expect(canSelfUpdate('unpacked')).toBe(false)
    expect(canSelfUpdate('development')).toBe(false)
  })
})
