/**
 * Accelerator helpers shared by the main process (registration) and the
 * renderer (recording a combination). Nothing here touches Electron, so it can
 * be unit tested directly.
 */

export const DEFAULT_HOTKEY = 'CommandOrControl+Shift+S'
/** Used only when the preferred combination is already taken by another app. */
export const FALLBACK_HOTKEY = 'CommandOrControl+Alt+S'

/**
 * Default for "grab the whole screen at once".
 *
 * Deliberately modelled on the macOS screenshot keys (⌘⇧3 is the whole screen,
 * ⌘⇧4 is a region), so the pair reads as a set: `Ctrl+Shift+3` takes everything,
 * `Ctrl+Shift+S` lets you draw a region.
 */
export const DEFAULT_FULLSCREEN_HOTKEY = 'CommandOrControl+Shift+3'
export const FALLBACK_FULLSCREEN_HOTKEY = 'CommandOrControl+Alt+3'

const MODIFIER_ALIASES: Record<string, string> = {
  commandorcontrol: 'CommandOrControl',
  cmdorctrl: 'CommandOrControl',
  // `Ctrl` is what users type; it maps to the cross-platform modifier.
  ctrl: 'CommandOrControl',
  control: 'Control',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
  super: 'Super',
  meta: 'Super',
  command: 'Super',
  cmd: 'Super',
  win: 'Super'
}

/**
 * Named keys Electron accepts verbatim.
 *
 * This list is the contract: anything not here and not punctuation must not reach
 * `globalShortcut.register`, which throws `conversion failure from …` and takes
 * the whole application down at startup.
 */
const NAMED_KEYS = [
  'Space',
  'Tab',
  'Backspace',
  'Delete',
  'Insert',
  'Enter',
  'Return',
  'Up',
  'Down',
  'Left',
  'Right',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'PrintScreen',
  'Capslock',
  'Numlock',
  'Scrolllock',
  'Plus'
] as const

/**
 * Punctuation: DOM `code` name → the character Electron wants.
 *
 * `KeyboardEvent.code` reports `Equal` or `Minus`, but an accelerator is a key
 * *name*, and Electron only understands punctuation as the character itself.
 * Feeding it `CommandOrControl+Equal` throws, which is exactly how a saved
 * shortcut could stop the app from starting at all.
 *
 * `+` is the one character that cannot be written literally — it is the modifier
 * separator — so it keeps the name `Plus`.
 */
const PUNCTUATION_BY_CODE: Record<string, string> = {
  minus: '-',
  equal: '=',
  bracketleft: '[',
  bracketright: ']',
  backslash: '\\',
  semicolon: ';',
  quote: "'",
  comma: ',',
  period: '.',
  slash: '/',
  backquote: '`'
}

/** The characters above, for accepting an already-correct accelerator. */
const PUNCTUATION_CHARS = new Set(Object.values(PUNCTUATION_BY_CODE))

const FUNCTION_KEY = /^F(?:[1-9]|1[0-9]|2[0-4])$/

export interface KeyboardLike {
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
  code: string
}

function canonicalKey(raw: string): string | null {
  const value = raw.trim()
  if (!value) return null
  if (/^[a-z]$/i.test(value)) return value.toUpperCase()
  if (/^[0-9]$/.test(value)) return value
  const upper = value.toUpperCase()
  if (FUNCTION_KEY.test(upper)) return upper
  const named = NAMED_KEYS.find((key) => key.toLowerCase() === value.toLowerCase())
  if (named) return named
  // Already a valid punctuation character: keep it as written.
  if (PUNCTUATION_CHARS.has(value)) return value
  // A DOM code name such as `Equal` or `Backquote`: rewrite it to the character.
  return PUNCTUATION_BY_CODE[value.toLowerCase()] ?? null
}

function keyFromCode(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (/^Numpad[0-9]$/.test(code)) return `num${code.slice(6)}`
  if (FUNCTION_KEY.test(code)) return code
  if (code === 'NumpadAdd') return 'Plus'
  if (code === 'NumpadDecimal') return 'numdec'
  if (code === 'NumpadSubtract') return 'numsub'
  if (code === 'NumpadMultiply') return 'nummult'
  if (code === 'NumpadDivide') return 'numdiv'
  const arrow = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' }[code]
  if (arrow) return arrow
  // Everything else is a named key or punctuation; both go through the same
  // canonicaliser, so a DOM name can never leak into an accelerator.
  return canonicalKey(code)
}

/**
 * A single key is allowed as a shortcut: `F9`, `PrintScreen`, or even a letter.
 * Bare letters and digits intercept that key system-wide, so the settings
 * window warns about it instead of rejecting the choice.
 */
function isSingleKeyAllowed(key: string): boolean {
  return canonicalKey(key) !== null
}

/** Warn the user that a bare letter or digit is captured in every application. */
export function isIntrusiveShortcut(value: string): boolean {
  const parts = value.split('+').map((part) => part.trim()).filter(Boolean)
  if (parts.length > 1) return false
  return /^[A-Z0-9]$/i.test(parts[0] ?? '')
}

export function isValidAccelerator(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 64) return false

  const parts = trimmed.split('+').map((part) => part.trim()).filter(Boolean)
  if (parts.length === 0) return false

  if (parts.length === 1) {
    const key = canonicalKey(parts[0])
    return key !== null && isSingleKeyAllowed(key)
  }

  const key = canonicalKey(parts[parts.length - 1])
  if (!key) return false

  const seen = new Set<string>()
  for (const part of parts.slice(0, -1)) {
    const modifier = MODIFIER_ALIASES[part.toLowerCase()]
    if (!modifier || seen.has(modifier)) return false
    seen.add(modifier)
  }
  return seen.size > 0
}

/** Rewrite aliases and casing into the canonical Electron form. */
export function normalizeAccelerator(value: string): string {
  const parts = value.split('+').map((part) => part.trim()).filter(Boolean)
  if (parts.length === 0) return DEFAULT_HOTKEY

  const key = canonicalKey(parts[parts.length - 1])
  if (!key) return DEFAULT_HOTKEY

  const modifiers: string[] = []
  for (const part of parts.slice(0, -1)) {
    const modifier = MODIFIER_ALIASES[part.toLowerCase()]
    if (modifier && !modifiers.includes(modifier)) modifiers.push(modifier)
  }

  const order = ['CommandOrControl', 'Control', 'Alt', 'Super', 'Shift']
  modifiers.sort((a, b) => order.indexOf(a) - order.indexOf(b))
  return [...modifiers, key].join('+')
}

/** Human readable form for tooltips, the tray menu and the settings window. */
export function formatAccelerator(value: string): string {
  return value
    .split('+')
    .map((part) => {
      const trimmed = part.trim()
      if (!trimmed) return ''
      if (trimmed === 'CommandOrControl') return 'Ctrl'
      if (trimmed === 'Control') return 'Ctrl'
      if (trimmed === 'Super') return 'Win'
      if (trimmed === 'PrintScreen') return 'PrtSc'
      return trimmed
    })
    .filter(Boolean)
    .join(' + ')
}

/**
 * Build an accelerator from a keydown event. Returns null when the combination
 * cannot be used (modifier only, unsupported key, or a bare letter).
 */
export function acceleratorFromKeyboardEvent(event: KeyboardLike): string | null {
  const modifiers: string[] = []
  if (event.ctrlKey) modifiers.push('CommandOrControl')
  if (event.altKey) modifiers.push('Alt')
  if (event.shiftKey) modifiers.push('Shift')
  if (event.metaKey) modifiers.push('Super')

  const key = keyFromCode(event.code)
  if (!key) return null
  if (modifiers.length === 0 && !isSingleKeyAllowed(key)) return null

  return [...modifiers, key].join('+')
}

/** The two actions a global shortcut can be assigned to. */
export type HotkeyField = 'hotkey' | 'hotkeyFullscreen'

/**
 * Combinations Windows itself claims before any application sees them.
 *
 * `RegisterHotKey` fails with error 1409 ("already registered") for these, and no
 * application can take one over: the owner is the shell or a system app, not
 * another program the user could close. Verified on this machine with
 * `.tmp/hotkey-probe.ps1`: `Win+Shift+S` returns 1409, while `Win+Shift+A`,
 * `PrintScreen`, `Alt+PrintScreen` and `F9` are free.
 *
 * The owner is named because "занята другой программой" is useless advice for a
 * combination that no program can release.
 */
const WINDOWS_RESERVED: Record<string, { owner: string; hint: string }> = {
  'super+shift+s': {
    owner: 'Ножницами Windows',
    hint:
      'Windows забирает это сочетание себе и открывает свои Ножницы, поэтому Flushot его не получит. ' +
      'Либо удалите приложение «Ножницы» (Параметры → Приложения), либо выберите другое сочетание: ' +
      'Ctrl+Shift+S, PrintScreen или Ctrl+Shift+X.'
  },
  'super+v': {
    owner: 'журналом буфера обмена Windows',
    hint: 'Это системное сочетание журнала буфера обмена. Выберите другое: Ctrl+Shift+S или PrintScreen.'
  },
  'super+e': {
    owner: 'Проводником Windows',
    hint: 'Это системное сочетание Проводника. Выберите другое: Ctrl+Shift+S или PrintScreen.'
  },
  'super+l': {
    owner: 'блокировкой Windows',
    hint: 'Это системное сочетание блокировки экрана. Выберите другое: Ctrl+Shift+S или PrintScreen.'
  }
}

/**
 * Why Windows will refuse this combination, or `null` when it is not one of the
 * known system shortcuts.
 */
export function reservedByWindows(value: string): { owner: string; hint: string } | null {
  const parts = value.split('+').map((part) => part.trim()).filter(Boolean)
  const key = canonicalKey(parts[parts.length - 1] ?? '')
  if (!key) return null
  const modifiers = parts
    .slice(0, -1)
    .map((part) => MODIFIER_ALIASES[part.toLowerCase()])
    .filter(Boolean)
  const order = ['CommandOrControl', 'Control', 'Alt', 'Super', 'Shift']
  const sorted = [...modifiers].sort((a, b) => order.indexOf(a) - order.indexOf(b))
  return WINDOWS_RESERVED[[...sorted, key].join('+').toLowerCase()] ?? null
}

/**
 * Which other action already owns this combination, if any.
 *
 * Windows gives a combination to exactly one handler, so region capture and
 * full-screen capture cannot share one: whichever was bound second would be dead
 * while the settings window happily showed both as assigned. Rejecting the
 * duplicate up front, by name, is far clearer than silently substituting the
 * fallback combination afterwards.
 */
export function conflictingField(
  field: HotkeyField,
  value: string,
  current: { hotkey: string; hotkeyFullscreen: string }
): HotkeyField | null {
  const other: HotkeyField = field === 'hotkey' ? 'hotkeyFullscreen' : 'hotkey'
  const otherValue = current[other]
  if (!otherValue) return null
  return normalizeAccelerator(otherValue) === normalizeAccelerator(value) ? other : null
}
