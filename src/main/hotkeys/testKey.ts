/**
 * Does a key actually reach Flushot?
 *
 * Registration succeeding is not the same as the key arriving. A combination can register and
 * still never fire, because another program swallowed it with a keyboard hook, or because
 * Windows itself handled it first. The only honest test is to wait for a real press.
 *
 * This is what the settings window runs when the user asks "проверить клавишу": it takes the
 * combination for a few seconds, reports whether a press arrived, and gives the key back.
 */
import { globalShortcut } from 'electron'
import { formatAccelerator, isValidAccelerator, normalizeAccelerator } from '../../shared/hotkey'
import { tr } from '../i18n'

export interface KeyTestResult {
  /** True when the combination registered at all. */
  registered: boolean
  /** True when a real press arrived inside the window. */
  received: boolean
  /** The combination as it was tested, formatted for display. */
  combo: string
  /** Seconds the test waited. */
  seconds: number
}

const WAIT_MS = 5000

/**
 * Register `accelerator` for a few seconds and report whether a press arrives.
 *
 * Resolves early on a press, so the window does not sit waiting for the full five seconds when
 * the answer is already yes. The key is always released: a test that leaves a global shortcut
 * registered would make the real action stop working.
 */
export async function testKey(accelerator: string): Promise<KeyTestResult> {
  const combo = isValidAccelerator(accelerator) ? formatAccelerator(normalizeAccelerator(accelerator)) : accelerator
  if (!isValidAccelerator(accelerator)) {
    return { registered: false, received: false, combo, seconds: 0 }
  }
  const normalized = normalizeAccelerator(accelerator)

  let resolvePress: () => void = () => undefined
  const pressed = new Promise<void>((resolve) => {
    resolvePress = resolve
  })

  let registered = false
  try {
    registered = globalShortcut.register(normalized, () => resolvePress())
  } catch {
    registered = false
  }

  if (!registered) {
    // Nothing to wait for: the combination is held by another program, which the settings
    // window reports separately. A five-second wait would only make the user sit there.
    return { registered: false, received: false, combo, seconds: 0 }
  }

  let received = false
  try {
    received = await Promise.race([
      pressed.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), WAIT_MS))
    ])
  } finally {
    try {
      globalShortcut.unregister(normalized)
    } catch {
      // Nothing to release.
    }
  }

  return { registered: true, received, combo, seconds: received ? 0 : WAIT_MS / 1000 }
}

/** The message for a finished test, in the user's language. */
export function describeKeyTest(result: KeyTestResult): { tone: 'ok' | 'warn'; text: string } {
  if (!result.registered) {
    return { tone: 'warn', text: tr('settings.keyTestTaken', { combo: result.combo }) }
  }
  if (result.received) {
    return { tone: 'ok', text: tr('settings.keyTestOk', { combo: result.combo }) }
  }
  return { tone: 'warn', text: tr('settings.keyTestSwallowed', { combo: result.combo, seconds: result.seconds }) }
}
