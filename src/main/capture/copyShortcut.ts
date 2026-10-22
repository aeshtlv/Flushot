import { globalShortcut } from 'electron'

/**
 * Ctrl+C pressed while a region is being selected must copy the screenshot.
 *
 * Two problems make a renderer-only listener unreliable:
 *  - the overlay window may not own keyboard focus (Windows can refuse to give
 *    foreground to a background process), so the keydown never arrives;
 *  - `event.key` follows the layout, so on a Russian layout the physical C key
 *    reports `с` and a comparison with `'c'` fails.
 *
 * Registering the combination globally covers both: the key reaches us no
 * matter which window is focused, and the physical key is what is matched.
 * The shortcut only lives while the selection overlay is open.
 */
export const COPY_SHORTCUT = 'CommandOrControl+C'

let registered = false

/** Returns true when the shortcut is now owned by Flushot. */
export function registerCopyShortcut(handler: () => void): boolean {
  if (registered) return true
  try {
    registered = globalShortcut.register(COPY_SHORTCUT, handler)
  } catch (error) {
    console.warn('Не удалось зарегистрировать Ctrl+C для выделения', error)
    registered = false
  }
  return registered
}

export function unregisterCopyShortcut(): void {
  if (!registered) return
  try {
    globalShortcut.unregister(COPY_SHORTCUT)
  } catch {
    // Nothing to do: the session is ending anyway.
  }
  registered = false
}

export function isCopyShortcutRegistered(): boolean {
  return registered && globalShortcut.isRegistered(COPY_SHORTCUT)
}
