/**
 * Did any of the three shortcuts change?
 *
 * A separate, pure function because this is where the third key was forgotten: the
 * comparison listed the region and full-screen keys by hand, so binding only the upload
 * key wrote the settings file and re-registered nothing until the next launch. A test on a
 * pure function catches that; a test on an IPC handler needs a running Electron.
 */
export interface HotkeyTriple {
  hotkey: string
  hotkeyFullscreen: string
  hotkeyUpload: string
}

const FIELDS: Array<keyof HotkeyTriple> = ['hotkey', 'hotkeyFullscreen', 'hotkeyUpload']

export function hotkeysChanged(before: HotkeyTriple, after: HotkeyTriple): boolean {
  return FIELDS.some((field) => before[field] !== after[field])
}
