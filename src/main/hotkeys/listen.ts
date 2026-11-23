/**
 * Listening for keys Windows delivers to itself.
 *
 * PrintScreen is the one shortcut a window never sees as a keystroke: the shell handles it
 * (the Snipping Tool, or a browser's own screenshot extension) before the focused window gets
 * a `keydown`. So the recorder field stays empty however many times the key is pressed, and the
 * user concludes it cannot be assigned — while a *global* registration of the same key works
 * perfectly, which is why a key bound in the settings file then fires.
 *
 * This closes that gap: while the recorder is open, the main process registers PrintScreen
 * globally and reports the press. Registration is the only channel Windows leaves for a key it
 * keeps for itself, and it is the same channel the real shortcut uses — so a key that can be
 * listened for here is a key that will work once saved.
 */
import { globalShortcut } from 'electron'

/**
 * Keys worth listening for this way.
 *
 * Deliberately short. Each entry is registered for the duration of the recording, so a long
 * list would be a pile of global shortcuts the user never asked for. PrintScreen is here
 * because it is the reported case and the only common key the shell swallows.
 */
const SYSTEM_KEYS = ['PrintScreen'] as const

/** What the listener currently holds, so it can be released exactly. */
let listening: string[] = []

/**
 * Take the system keys and call `onPress` when one is pressed. Returns the keys taken.
 *
 * A key another program already holds is skipped: the recorder still works for every other
 * key, and the refusal to bind is what the save path reports.
 */
export function startListening(onPress: (key: string) => void): string[] {
  stopListening()
  for (const key of SYSTEM_KEYS) {
    try {
      if (globalShortcut.register(key, () => onPress(key))) {
        listening.push(key)
      }
    } catch {
      // Not available on this machine; the next key is tried.
    }
  }
  return [...listening]
}

/**
 * Release everything the listener holds.
 *
 * Called on every path out of the recorder. A leaked registration would take the key away from
 * the action it belongs to, which is a worse bug than the one this fixes.
 */
export function stopListening(): void {
  for (const key of listening) {
    try {
      globalShortcut.unregister(key)
    } catch {
      // Nothing to release.
    }
  }
  listening = []
}

/** Whether the listener is holding anything right now. */
export function isListening(): boolean {
  return listening.length > 0
}
