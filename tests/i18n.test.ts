import { describe, expect, it } from 'vitest'
import {
  LANGUAGES,
  LANGUAGE_NAMES,
  MESSAGES,
  pluralForm,
  resolveLanguage,
  t,
  type MessageKey
} from '../src/shared/i18n'
import { sceneStrings } from '../src/shared/demoSceneText'

const KEYS = Object.keys(MESSAGES.ru) as MessageKey[]
const CYRILLIC = /[\u0400-\u04FF]/
/** `{name}` placeholders, in the order they appear. */
const placeholders = (text: string): string[] => [...text.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((m) => m[1])

describe('demo scene words', () => {
  // The fake desktop the overlay is shown against appears in the README, on the
  // landing page and in every interface picture. It is not part of the message
  // dictionary — it is a picture of another program — so nothing else would
  // notice a Russian name left in the English version.
  // Rows are objects, paragraphs are arrays: both have to be walked, or the
  // collected text is "[object Object]" and every check below passes for free.
  const flatten = (value: unknown): string => {
    if (Array.isArray(value)) return value.map(flatten).join(' ')
    if (value && typeof value === 'object') return Object.values(value).map(flatten).join(' ')
    return String(value)
  }
  const allText = (language: 'ru' | 'en'): string => flatten(Object.values(sceneStrings(language)))

  it('has no Russian left in the English scene', () => {
    expect(CYRILLIC.test(allText('en'))).toBe(false)
    expect(allText('en')).toContain('Quarterly report')
    // The figures stay: the language changes words, not numbers.
    expect(allText('en')).toContain('45,8'.replace(',', '.'))
  })

  it('is Russian by default', () => {
    expect(CYRILLIC.test(allText('ru'))).toBe(true)
  })

  it('fills every slot in both languages', () => {
    // A table that forgot a row would draw the Russian word in a window that
    // otherwise says "Revenue", and the picture would pass every pixel check.
    const empty = (language: 'ru' | 'en'): string[] => {
      const strings = sceneStrings(language)
      const bad: string[] = []
      for (const [key, value] of Object.entries(strings)) {
        if (typeof value === 'string' && value.trim() === '') bad.push(`${language}.${key}`)
        if (Array.isArray(value) && value.some((entry) => String(entry).trim() === '')) bad.push(`${language}.${key}`)
        if (Array.isArray(value) && value.length === 0) bad.push(`${language}.${key}`)
      }
      return bad
    }
    expect(empty('ru')).toEqual([])
    expect(empty('en')).toEqual([])
    // Same shape on both sides, so neither can be quietly shorter.
    expect(Object.keys(sceneStrings('en')).sort()).toEqual(Object.keys(sceneStrings('ru')).sort())
    expect(sceneStrings('en').rows).toHaveLength(sceneStrings('ru').rows.length)
    expect(sceneStrings('en').paragraph).toHaveLength(sceneStrings('ru').paragraph.length)
    expect(sceneStrings('en').sidebar).toHaveLength(sceneStrings('ru').sidebar.length)
  })
})

describe('message dictionary', () => {
  it('has every Russian message translated into English', () => {
    // The two objects are typed against each other, so this can only fail if the
    // file is edited with a cast; it is the runtime half of the compile-time check.
    expect(Object.keys(MESSAGES.en).sort()).toEqual([...KEYS].sort())
  })

  it('never leaves a message empty', () => {
    for (const key of KEYS) {
      expect(MESSAGES.ru[key].trim(), `ru ${key}`).not.toBe('')
      expect(MESSAGES.en[key].trim(), `en ${key}`).not.toBe('')
    }
  })

  it('keeps English free of Cyrillic', () => {
    // A copied Russian line is the failure this catches: it builds fine, reads
    // wrong, and nobody notices until an English window shows it.
    for (const [key, value] of Object.entries(MESSAGES.en)) {
      expect(CYRILLIC.test(value), `en ${key}: ${value}`).toBe(false)
    }
  })

  it('uses the same placeholders in both languages', () => {
    // A missing placeholder silently drops a path or a combination from the
    // sentence; an extra one prints a literal `{combo}` to the user.
    for (const key of KEYS) {
      expect(placeholders(MESSAGES.en[key]).sort(), `en ${key}`).toEqual(placeholders(MESSAGES.ru[key]).sort())
    }
  })

  it('names each language in itself', () => {
    // Readable to someone who cannot read the interface yet, which is the whole
    // point of a language switcher.
    expect(LANGUAGE_NAMES.ru).toBe('Русский')
    expect(LANGUAGE_NAMES.en).toBe('English')
    expect(Object.keys(LANGUAGE_NAMES).sort()).toEqual([...LANGUAGES].sort())
  })
})

describe('resolveLanguage', () => {
  it('follows Windows when the preference is automatic', () => {
    expect(resolveLanguage('auto', 'ru-RU')).toBe('ru')
    expect(resolveLanguage('auto', 'en-US')).toBe('en')
    expect(resolveLanguage(undefined, 'ru')).toBe('ru')
  })

  it('lets an explicit choice win over the system language', () => {
    expect(resolveLanguage('en', 'ru-RU')).toBe('en')
    expect(resolveLanguage('ru', 'en-US')).toBe('ru')
  })

  it('matches on the primary subtag only', () => {
    // Windows reports full tags; `ru-RU` and `ru` are the same language.
    expect(resolveLanguage('auto', 'ru-BY')).toBe('ru')
    expect(resolveLanguage('auto', 'EN-gb')).toBe('en')
  })

  it('gives a language nobody else covers English', () => {
    // A Belarusian or Kazakh Windows is likelier to read English than a
    // language it did not ask for.
    expect(resolveLanguage('auto', 'be-BY')).toBe('en')
    expect(resolveLanguage('auto', 'de-DE')).toBe('en')
    expect(resolveLanguage('auto', undefined)).toBe('en')
    expect(resolveLanguage('auto', '')).toBe('en')
  })
})

describe('t', () => {
  it('returns the message for the chosen language', () => {
    expect(t('ru', 'tray.quit')).toBe('Выход')
    expect(t('en', 'tray.quit')).toBe('Quit')
  })

  it('fills named placeholders', () => {
    expect(t('en', 'screen.displayLabel', { id: 2 })).toBe('Display 2')
    expect(t('ru', 'capture.done', { width: 1920, height: 1080 })).toBe('Готово · 1920 × 1080')
  })

  it('leaves an unknown placeholder visible instead of printing "undefined"', () => {
    // A visible `{directory}` reads as a bug report; "undefined" reads as a
    // broken feature, which is worse.
    expect(t('en', 'capture.copiedNotSavedFolder', {})).toContain('{directory}')
  })

  it('fills the same placeholder more than once', () => {
    expect(t('en', 'app.hotkeyTaken', { combo: 'Ctrl+S', active: 'Ctrl+Alt+S' })).toBe(
      'Ctrl+S is taken by another program. Flushot uses Ctrl+Alt+S.'
    )
  })
})

describe('pluralForm', () => {
  it('uses the three Russian forms', () => {
    const forms = [1, 2, 5, 11, 12, 21, 22, 25, 101, 111].map((n) => pluralForm('ru', n))
    expect(forms).toEqual(['one', 'few', 'many', 'many', 'many', 'one', 'few', 'many', 'one', 'many'])
  })

  it('uses two English forms', () => {
    expect([1, 2, 5, 11, 21].map((n) => pluralForm('en', n))).toEqual([
      'one',
      'many',
      'many',
      'many',
      'many'
    ])
  })

  it('counts zero and negatives the same way', () => {
    expect(pluralForm('ru', 0)).toBe('many')
    expect(pluralForm('en', 0)).toBe('many')
    expect(pluralForm('ru', -3)).toBe('few')
  })

  it('picks a real message for every count', () => {
    // The point of the three forms: "1 строк" reads as a bug, and the English
    // dictionary has only two of them, so `few` must exist in both.
    for (const count of [0, 1, 2, 5, 11, 21, 22]) {
      const key = `text.lines.${pluralForm('ru', count)}` as MessageKey
      expect(t('ru', key, { count })).toContain(String(count))
      expect(t('en', key, { count })).toContain(String(count))
    }
  })
})
