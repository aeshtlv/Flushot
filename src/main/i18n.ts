/**
 * The interface language of the main process.
 *
 * The renderer gets its language from the settings payload it already receives
 * and resolves it with the same function, so there is no language to pass through
 * IPC and no way for the two halves to disagree after a change.
 *
 * Kept as a module rather than threaded through every call: a tray menu, a
 * notification and an error thrown three layers down all need the same answer,
 * and a `language` parameter on each of them would be a parameter that no caller
 * ever varies.
 */

import { resolveLanguage, t, type Language, type MessageKey } from '../shared/i18n'

let current: Language = 'ru'

/** Called once at startup and again whenever the preference changes. */
export function setLanguage(preference: Parameters<typeof resolveLanguage>[0], systemLocale: string): Language {
  current = resolveLanguage(preference, systemLocale)
  return current
}

export function language(): Language {
  return current
}

/** Translate a message for the main process. */
export function tr(key: MessageKey, vars?: Record<string, string | number>): string {
  return t(current, key, vars)
}
