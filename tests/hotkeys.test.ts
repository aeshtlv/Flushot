import { describe, expect, it } from 'vitest'
import { hotkeysChanged, type HotkeyTriple } from '../src/shared/hotkeys'

/**
 * The comparison that decides whether the global shortcuts are re-registered.
 *
 * This exists because of a real bug: when the third key was added, the check listed the
 * other two by hand. Binding only the upload key then wrote settings.json and re-registered
 * nothing, so the program kept listening for the old combination until the next launch —
 * reported by the user as "it does not react to the key I bound".
 */
const base: HotkeyTriple = {
  hotkey: 'CommandOrControl+Shift+S',
  hotkeyFullscreen: 'CommandOrControl+Shift+3',
  hotkeyUpload: 'CommandOrControl+Shift+U'
}

describe('hotkeysChanged', () => {
  it('is false when nothing moved', () => {
    expect(hotkeysChanged(base, { ...base })).toBe(false)
  })

  it('notices a change to the region key', () => {
    expect(hotkeysChanged(base, { ...base, hotkey: 'CommandOrControl+Alt+S' })).toBe(true)
  })

  it('notices a change to the full-screen key', () => {
    expect(hotkeysChanged(base, { ...base, hotkeyFullscreen: 'CommandOrControl+Alt+3' })).toBe(true)
  })

  it('notices a change to the upload key', () => {
    // The case that was broken: this returned false, so the new combination was saved and
    // never registered.
    expect(hotkeysChanged(base, { ...base, hotkeyUpload: 'CommandOrControl+Alt+U' })).toBe(true)
  })

  it('notices a change that only clears one key', () => {
    // '' means "nothing could be bound". It is a change too: the old handler must go.
    expect(hotkeysChanged(base, { ...base, hotkeyUpload: '' })).toBe(true)
    expect(hotkeysChanged({ ...base, hotkeyUpload: '' }, base)).toBe(true)
  })

  it('notices a swap of two keys', () => {
    const swapped = {
      hotkey: base.hotkeyFullscreen,
      hotkeyFullscreen: base.hotkey,
      hotkeyUpload: base.hotkeyUpload
    }
    expect(hotkeysChanged(base, swapped)).toBe(true)
  })

  it('covers every field the settings hold', () => {
    // A field added to the type but not to the comparison is exactly how the upload key
    // was missed, so each key of the object is exercised here by name.
    const keys = Object.keys(base) as Array<keyof HotkeyTriple>
    expect(keys.sort()).toEqual(['hotkey', 'hotkeyFullscreen', 'hotkeyUpload'])
    for (const key of keys) {
      expect(hotkeysChanged(base, { ...base, [key]: 'CommandOrControl+Alt+9' })).toBe(true)
    }
  })
})
