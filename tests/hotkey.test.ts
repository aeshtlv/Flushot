import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FULLSCREEN_HOTKEY,
  DEFAULT_HOTKEY,
  acceleratorFromKeyboardEvent,
  conflictingField,
  formatAccelerator,
  isValidAccelerator,
  isIntrusiveShortcut,
  normalizeAccelerator,
  reservedByWindows
} from '../src/shared/hotkey'
import { defaultSettings, sanitizeSettings } from '../src/shared/settings'

const PICTURES = 'C:\\Users\\Test\\Pictures\\Flushot'

describe('isValidAccelerator', () => {
  it('accepts modifier combinations with a letter, digit or function key', () => {
    expect(isValidAccelerator('CommandOrControl+Shift+S')).toBe(true)
    expect(isValidAccelerator('Control+Alt+4')).toBe(true)
    expect(isValidAccelerator('Ctrl+Shift+F12')).toBe(true)
    expect(isValidAccelerator('Alt+PrintScreen')).toBe(true)
  })

  it('allows a single key, including a bare letter or digit', () => {
    expect(isValidAccelerator('F9')).toBe(true)
    expect(isValidAccelerator('PrintScreen')).toBe(true)
    expect(isValidAccelerator('S')).toBe(true)
    expect(isValidAccelerator('4')).toBe(true)
    expect(isValidAccelerator('Space')).toBe(true)
  })

  it('rejects malformed or empty combinations', () => {
    expect(isValidAccelerator('')).toBe(false)
    expect(isValidAccelerator('Ctrl+')).toBe(false)
    expect(isValidAccelerator('Ctrl+Shift')).toBe(false)
    expect(isValidAccelerator('Ctrl+Nope')).toBe(false)
    expect(isValidAccelerator('Ctrl+Ctrl+S')).toBe(false)
    expect(isValidAccelerator(undefined)).toBe(false)
    expect(isValidAccelerator(42)).toBe(false)
  })
})

describe('normalizeAccelerator', () => {
  it('rewrites aliases and casing into the Electron form', () => {
    expect(normalizeAccelerator('ctrl+shift+s')).toBe('CommandOrControl+Shift+S')
    expect(normalizeAccelerator('Win+Shift+4')).toBe('Super+Shift+4')
    expect(normalizeAccelerator('  alt + f9  ')).toBe('Alt+F9')
  })

  it('orders modifiers consistently', () => {
    expect(normalizeAccelerator('Shift+Alt+CommandOrControl+K')).toBe('CommandOrControl+Alt+Shift+K')
  })

  it('falls back to the default for unusable input', () => {
    expect(normalizeAccelerator('nonsense')).toBe(DEFAULT_HOTKEY)
    expect(normalizeAccelerator('')).toBe(DEFAULT_HOTKEY)
  })
})

describe('formatAccelerator', () => {
  it('renders a readable shortcut for the UI', () => {
    expect(formatAccelerator('CommandOrControl+Shift+S')).toBe('Ctrl + Shift + S')
    expect(formatAccelerator('Control+Alt+F9')).toBe('Ctrl + Alt + F9')
    expect(formatAccelerator('Super+PrintScreen')).toBe('Win + PrtSc')
  })
})

describe('acceleratorFromKeyboardEvent', () => {
  const base = { ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, code: 'KeyS' }

  it('builds a combination from a keydown event', () => {
    expect(acceleratorFromKeyboardEvent({ ...base, ctrlKey: true, shiftKey: true })).toBe('CommandOrControl+Shift+S')
    expect(acceleratorFromKeyboardEvent({ ...base, ctrlKey: true, altKey: true, code: 'Digit4' })).toBe(
      'CommandOrControl+Alt+4'
    )
  })

  it('supports function keys and letters on their own', () => {
    expect(acceleratorFromKeyboardEvent({ ...base, code: 'F9' })).toBe('F9')
    expect(acceleratorFromKeyboardEvent({ ...base, code: 'PrintScreen' })).toBe('PrintScreen')
    expect(acceleratorFromKeyboardEvent({ ...base })).toBe('S')
    expect(acceleratorFromKeyboardEvent({ ...base, code: 'Digit4' })).toBe('4')
  })

  it('ignores modifier-only keys and keys without a mapping', () => {
    expect(acceleratorFromKeyboardEvent({ ...base, ctrlKey: true, code: 'ShiftLeft' })).toBeNull()
    expect(acceleratorFromKeyboardEvent({ ...base, ctrlKey: true, code: 'Lang1' })).toBeNull()
  })

  it('turns punctuation DOM codes into the characters Electron accepts', () => {
    // Regression: `CommandOrControl+Equal` was saved as-is and then made
    // `globalShortcut.register` throw, which stopped the app from starting.
    const record = (code: string): string | null => acceleratorFromKeyboardEvent({ ...base, ctrlKey: true, code })
    expect(record('Equal')).toBe('CommandOrControl+=')
    expect(record('Minus')).toBe('CommandOrControl+-')
    expect(record('BracketLeft')).toBe('CommandOrControl+[')
    expect(record('BracketRight')).toBe('CommandOrControl+]')
    expect(record('Backslash')).toBe('CommandOrControl+\\')
    expect(record('Semicolon')).toBe('CommandOrControl+;')
    expect(record('Quote')).toBe("CommandOrControl+'")
    expect(record('Comma')).toBe('CommandOrControl+,')
    expect(record('Period')).toBe('CommandOrControl+.')
    expect(record('Slash')).toBe('CommandOrControl+/')
    expect(record('Backquote')).toBe('CommandOrControl+`')
  })

  it('keeps Plus named, because the character is the separator', () => {
    expect(acceleratorFromKeyboardEvent({ ...base, ctrlKey: true, code: 'NumpadAdd' })).toBe('CommandOrControl+Plus')
    expect(acceleratorFromKeyboardEvent({ ...base, ctrlKey: true, code: 'Equal', shiftKey: true })).toBe(
      'CommandOrControl+Shift+='
    )
  })

  it('maps the numpad to Electron key names', () => {
    expect(acceleratorFromKeyboardEvent({ ...base, ctrlKey: true, code: 'Numpad5' })).toBe('CommandOrControl+num5')
    expect(acceleratorFromKeyboardEvent({ ...base, ctrlKey: true, code: 'NumpadDecimal' })).toBe(
      'CommandOrControl+numdec'
    )
  })
})

describe('punctuation accelerators', () => {
  it('accepts a DOM code name and rewrites it to the character', () => {
    expect(isValidAccelerator('CommandOrControl+Equal')).toBe(true)
    expect(normalizeAccelerator('CommandOrControl+Equal')).toBe('CommandOrControl+=')
    expect(normalizeAccelerator('ctrl+minus')).toBe('CommandOrControl+-')
    expect(normalizeAccelerator('CommandOrControl+Backquote')).toBe('CommandOrControl+`')
  })

  it('accepts an already-correct punctuation character', () => {
    expect(isValidAccelerator('CommandOrControl+=')).toBe(true)
    expect(normalizeAccelerator('CommandOrControl+=')).toBe('CommandOrControl+=')
    expect(normalizeAccelerator('Ctrl+/')).toBe('CommandOrControl+/')
  })

  it('rejects names Electron cannot parse', () => {
    // `Escape` looks valid but is reserved by Windows, so it is not offered.
    expect(isValidAccelerator('CommandOrControl+Escape')).toBe(false)
    expect(isValidAccelerator('CommandOrControl+NumpadAdd')).toBe(false)
    expect(isValidAccelerator('CommandOrControl+Foo')).toBe(false)
  })

  it('renders punctuation readably', () => {
    expect(formatAccelerator('CommandOrControl+=')).toBe('Ctrl + =')
    expect(formatAccelerator('CommandOrControl+Plus')).toBe('Ctrl + Plus')
  })
})

describe('isIntrusiveShortcut', () => {
  it('flags a bare letter or digit', () => {
    expect(isIntrusiveShortcut('S')).toBe(true)
    expect(isIntrusiveShortcut('4')).toBe(true)
  })

  it('accepts combinations and dedicated keys', () => {
    expect(isIntrusiveShortcut('CommandOrControl+Shift+S')).toBe(false)
    expect(isIntrusiveShortcut('F9')).toBe(false)
    expect(isIntrusiveShortcut('PrintScreen')).toBe(false)
    expect(isIntrusiveShortcut('Space')).toBe(false)
  })
})

describe('settings sanitizing of the capture shortcut', () => {
  it('exposes the default shortcut on a fresh profile', () => {
    expect(defaultSettings(PICTURES).hotkey).toBe(DEFAULT_HOTKEY)
  })

  it('normalizes a stored shortcut', () => {
    expect(sanitizeSettings({ hotkey: 'ctrl+alt+p' }, PICTURES).hotkey).toBe('CommandOrControl+Alt+P')
  })

  it('keeps a single-key shortcut', () => {
    expect(sanitizeSettings({ hotkey: 'F9' }, PICTURES).hotkey).toBe('F9')
    expect(sanitizeSettings({ hotkey: 'p' }, PICTURES).hotkey).toBe('P')
    expect(sanitizeSettings({ hotkey: 'PrintScreen' }, PICTURES).hotkey).toBe('PrintScreen')
  })

  it('replaces an unusable stored shortcut with the default', () => {
    expect(sanitizeSettings({ hotkey: 'not a shortcut' }, PICTURES).hotkey).toBe(DEFAULT_HOTKEY)
    expect(sanitizeSettings({ hotkey: 'Ctrl+' }, PICTURES).hotkey).toBe(DEFAULT_HOTKEY)
    expect(sanitizeSettings({}, PICTURES).hotkey).toBe(DEFAULT_HOTKEY)
  })
})

describe('conflictingField', () => {
  const current = {
    hotkey: 'CommandOrControl+Shift+S',
    hotkeyFullscreen: 'CommandOrControl+Shift+3'
  }

  it('reports the other action when the combination is already taken', () => {
    // Saving the region key into the full-screen field is the case that made the
    // settings window say "занята" without explaining who had taken it.
    expect(conflictingField('hotkeyFullscreen', 'CommandOrControl+Shift+S', current)).toBe('hotkey')
    expect(conflictingField('hotkey', 'CommandOrControl+Shift+3', current)).toBe('hotkeyFullscreen')
  })

  it('allows a free combination', () => {
    expect(conflictingField('hotkeyFullscreen', 'CommandOrControl+Alt+9', current)).toBeNull()
    expect(conflictingField('hotkey', 'F9', current)).toBeNull()
  })

  it('compares normalized forms, so aliases cannot slip through', () => {
    expect(conflictingField('hotkeyFullscreen', 'ctrl+shift+s', current)).toBe('hotkey')
    expect(conflictingField('hotkey', 'CommandOrControl+Shift+3', current)).toBe('hotkeyFullscreen')
  })

  it('treats an unbound other action as no conflict', () => {
    // '' means the combination could not be registered at all, so it owns nothing.
    expect(conflictingField('hotkey', 'CommandOrControl+Shift+3', { hotkey: '', hotkeyFullscreen: '' })).toBeNull()
  })
})

describe('shortcuts Windows keeps for itself', () => {
  it('names the Snipping Tool for Win+Shift+S', () => {
    // The whole point of the list: "занята" is not an answer when the owner is
    // the very tool the user was trying to replace.
    const reserved = reservedByWindows('Super+Shift+S')
    expect(reserved).not.toBeNull()
    expect(reserved?.owner).toContain('Ножниц')
    expect(reserved?.hint).toContain('PrintScreen')
  })

  it('matches regardless of modifier order, case and aliases', () => {
    expect(reservedByWindows('super+shift+s')).not.toBeNull()
    expect(reservedByWindows('Shift+Super+S')).not.toBeNull()
    expect(reservedByWindows('CmdOrCtrl+Super+Shift+S')).toBeNull()
  })

  it('leaves ordinary combinations alone', () => {
    expect(reservedByWindows('CommandOrControl+Shift+S')).toBeNull()
    expect(reservedByWindows('PrintScreen')).toBeNull()
    expect(reservedByWindows('F9')).toBeNull()
    expect(reservedByWindows('CommandOrControl+Shift+X')).toBeNull()
  })

  it('covers the other system keys a user may try', () => {
    expect(reservedByWindows('Super+V')?.owner).toContain('буфера')
    expect(reservedByWindows('Super+E')?.owner).toContain('Проводник')
    expect(reservedByWindows('Super+L')?.owner).toContain('блокировк')
  })
})

describe('the combinations the app itself offers', () => {
  // There used to be four preset chips next to the recorder. They were removed at
  // the user's request — the row turned into a menu of our suggestions instead of
  // the user's own choice. What still has to hold is that every combination the app
  // ships as a default is bindable, and that the two defaults cannot collide.
  it('ships defaults that are valid accelerators', () => {
    expect(isValidAccelerator(DEFAULT_HOTKEY)).toBe(true)
    expect(isValidAccelerator(DEFAULT_FULLSCREEN_HOTKEY)).toBe(true)
  })

  it('ships defaults Windows does not keep for itself', () => {
    expect(reservedByWindows(DEFAULT_HOTKEY)).toBeNull()
    expect(reservedByWindows(DEFAULT_FULLSCREEN_HOTKEY)).toBeNull()
  })

  it('never ships the same combination for both actions', () => {
    expect(normalizeAccelerator(DEFAULT_HOTKEY)).not.toBe(normalizeAccelerator(DEFAULT_FULLSCREEN_HOTKEY))
  })
})
