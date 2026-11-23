/**
 * Finding combinations that are actually free.
 *
 * Why this exists: Windows hands a hotkey to the first program that registers it and to
 * nobody else — a second registration fails with error 1409, even from the same process.
 * Measured on this machine, not assumed. So "make Flushot take priority over the program
 * that already has the key" is not something an application can do; what it can do is stop
 * guessing and offer a combination that is measurably free.
 *
 * The search is deliberately narrow: same key with different modifiers first, then the
 * same modifiers with a neighbouring key. A wall of suggestions is worse than none — an
 * earlier version listed them permanently and they only got in the way.
 */
import { globalShortcut } from 'electron'
import { formatAccelerator, isValidAccelerator, normalizeAccelerator, reservedByWindows } from '../../shared/hotkey'
import { tr } from '../i18n'

/** Does this combination register right now? Registration is undone immediately. */
export function isFree(accelerator: string): boolean {
  if (!isValidAccelerator(accelerator)) return false
  const normalized = normalizeAccelerator(accelerator)
  // A key Windows reserves is never free, and trying it would be a lie.
  if (reservedByWindows(normalized)) return false
  try {
    if (!globalShortcut.register(normalized, () => undefined)) return false
    try {
      globalShortcut.unregister(normalized)
    } catch {
      // Nothing to undo.
    }
    return true
  } catch {
    return false
  }
}

const MODIFIER_SETS = [
  'CommandOrControl+Alt',
  'CommandOrControl+Shift',
  'CommandOrControl+Alt+Shift',
  'CommandOrControl',
  'Alt+Shift'
]

/**
 * Free combinations near the one that was refused.
 *
 * `exclude` holds the combinations already bound to another Flushot action: offering the
 * user a key that our own other action holds would be the same failure one step later.
 */
export function suggestFree(accelerator: string, exclude: string[] = [], limit = 3): string[] {
  if (!isValidAccelerator(accelerator)) return []
  const normalized = normalizeAccelerator(accelerator)
  const parts = normalized.split('+')
  const key = parts[parts.length - 1]
  const taken = new Set(exclude.filter(Boolean).map(normalizeAccelerator))
  taken.add(normalized)

  const suggestions: string[] = []
  const consider = (candidate: string): void => {
    if (suggestions.length >= limit) return
    if (taken.has(candidate)) return
    if (!isFree(candidate)) return
    suggestions.push(candidate)
  }

  // Same key, other modifiers: the smallest change for the user's muscle memory.
  for (const modifiers of MODIFIER_SETS) {
    const candidate = `${modifiers}+${key}`
    if (candidate !== normalized) consider(candidate)
  }

  // Then the same modifiers with a neighbouring key, for when every modifier set is busy.
  const modifiers = parts.slice(0, -1).join('+')
  if (modifiers) {
    for (const neighbour of ['F9', 'F8', 'F10', 'PrintScreen', 'F7', 'F11']) {
      consider(`${modifiers}+${neighbour}`)
    }
  }

  return suggestions
}

/** The message a suggestion is offered with, already in the user's language. */
export function suggestReason(): string {
  return tr('settings.hotkeyTryThese')
}

export { formatAccelerator }
