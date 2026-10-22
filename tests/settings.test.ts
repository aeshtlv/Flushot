import { describe, expect, it } from 'vitest'
import { DEFAULT_FULLSCREEN_HOTKEY, FALLBACK_FULLSCREEN_HOTKEY } from '../src/shared/hotkey'
import {
  BACKGROUND_PRESETS,
  defaultSettings,
  isValidHexColor,
  normalizeHexColor,
  PALETTE_LIMIT,
  resolveBackgroundColor,
  sanitizeSettings
} from '../src/shared/settings'

const PICTURES = 'C:\\Users\\Test\\Pictures\\Flushot'

describe('defaultSettings', () => {
  it('matches the product defaults', () => {
    const settings = defaultSettings(PICTURES)
    expect(settings.theme).toBe('light')
    expect(settings.backgroundPreset).toBe('white')
    expect(settings.shadowEnabled).toBe(true)
    expect(settings.format).toBe('png')
    expect(settings.saveDirectory).toBe(PICTURES)
    expect(settings.saveMode).toBe('folder')
  })
})

describe('sanitizeSettings', () => {
  it('falls back to defaults for missing data', () => {
    expect(sanitizeSettings(null, PICTURES)).toEqual(defaultSettings(PICTURES))
    expect(sanitizeSettings('broken', PICTURES)).toEqual(defaultSettings(PICTURES))
    expect(sanitizeSettings({}, PICTURES)).toEqual(defaultSettings(PICTURES))
  })

  it('keeps valid values', () => {
    const settings = sanitizeSettings(
      {
        theme: 'dark',
        backgroundPreset: 'custom',
        backgroundColor: '#123abc',
        shadowEnabled: false,
        shadowIntensity: 40,
        shadowBlur: 20,
        format: 'jpeg',
        jpegQuality: 80,
        saveMode: 'ask',
        saveDirectory: 'D:\\Shots'
      },
      PICTURES
    )
    expect(settings.theme).toBe('dark')
    expect(settings.backgroundPreset).toBe('custom')
    expect(settings.backgroundColor).toBe('#123ABC')
    expect(settings.shadowEnabled).toBe(false)
    expect(settings.format).toBe('jpeg')
    expect(settings.saveDirectory).toBe('D:\\Shots')
  })

  it('clamps out-of-range numeric settings', () => {
    const settings = sanitizeSettings(
      { shadowIntensity: 999, shadowBlur: -50, jpegQuality: 500, shadowOffsetY: -3 },
      PICTURES
    )
    expect(settings.shadowIntensity).toBe(60)
    expect(settings.shadowBlur).toBe(0)
    expect(settings.jpegQuality).toBe(100)
    expect(settings.shadowOffsetY).toBe(0)
  })

  it('ignores unknown enum values and malformed colours', () => {
    const settings = sanitizeSettings(
      { theme: 'neon', backgroundPreset: 'rainbow', backgroundColor: 'red', format: 'gif' },
      PICTURES
    )
    expect(settings.theme).toBe('light')
    expect(settings.backgroundPreset).toBe('white')
    expect(settings.backgroundColor).toBe('#FFFFFF')
    expect(settings.format).toBe('png')
  })

  it('accepts WebP as a format', () => {
    expect(sanitizeSettings({ format: 'webp' }, PICTURES).format).toBe('webp')
  })

  it('clamps the corner radius and defaults it to 12', () => {
    expect(sanitizeSettings({}, PICTURES).cornerRadius).toBe(12)
    expect(sanitizeSettings({ cornerRadius: -5 }, PICTURES).cornerRadius).toBe(0)
    expect(sanitizeSettings({ cornerRadius: 999 }, PICTURES).cornerRadius).toBe(24)
    expect(sanitizeSettings({ cornerRadius: 8.6 }, PICTURES).cornerRadius).toBe(9)
  })

  it('defaults autostart to off and ignores non-boolean values', () => {
    expect(sanitizeSettings({}, PICTURES).launchAtLogin).toBe(false)
    expect(sanitizeSettings({ launchAtLogin: true }, PICTURES).launchAtLogin).toBe(true)
    expect(sanitizeSettings({ launchAtLogin: 'yes' }, PICTURES).launchAtLogin).toBe(false)
    expect(sanitizeSettings({ launchAtLogin: 1 }, PICTURES).launchAtLogin).toBe(false)
  })

  it('keeps only valid, unique palette colours, up to the limit', () => {
    const settings = sanitizeSettings(
      { paletteColors: ['#ff0000', 'red', '#FF0000', '#00ff00', 42, null, '#0000ff', '#123456', '#abcdef', '#fedcba'] },
      PICTURES
    )
    // Malformed entries are dropped, duplicates collapse, and the case is fixed.
    expect(settings.paletteColors).toEqual(['#FF0000', '#00FF00', '#0000FF', '#123456', '#ABCDEF', '#FEDCBA'])
    expect(settings.paletteColors.length).toBeLessThanOrEqual(PALETTE_LIMIT)
  })

  it('recovers from a palette that is not an array at all', () => {
    expect(sanitizeSettings({ paletteColors: 'red' }, PICTURES).paletteColors).toEqual([])
    expect(sanitizeSettings({ paletteColors: null }, PICTURES).paletteColors).toEqual([])
  })
})

describe('full-screen shortcut', () => {
  it('has a default that differs from the region shortcut', () => {
    const settings = defaultSettings(PICTURES)
    expect(settings.hotkeyFullscreen).toBe(DEFAULT_FULLSCREEN_HOTKEY)
    expect(settings.hotkeyFullscreen).not.toBe(settings.hotkey)
  })

  it('keeps a valid combination', () => {
    expect(sanitizeSettings({ hotkeyFullscreen: 'ctrl+alt+f' }, PICTURES).hotkeyFullscreen).toBe(
      'CommandOrControl+Alt+F'
    )
  })

  it('replaces a full-screen key that duplicates the region key', () => {
    // Two identical global shortcuts cannot both be registered: the second one
    // would silently do nothing, so the stored value is corrected instead.
    const settings = sanitizeSettings(
      { hotkey: 'CommandOrControl+Shift+S', hotkeyFullscreen: 'CommandOrControl+Shift+S' },
      PICTURES
    )
    expect(settings.hotkey).toBe('CommandOrControl+Shift+S')
    expect(settings.hotkeyFullscreen).toBe(FALLBACK_FULLSCREEN_HOTKEY)
  })

  it('does not duplicate a custom region key either', () => {
    const settings = sanitizeSettings(
      { hotkey: 'F9', hotkeyFullscreen: 'F9' },
      PICTURES
    )
    expect(settings.hotkeyFullscreen).not.toBe('F9')
  })

  it('falls back for garbage instead of throwing', () => {
    expect(sanitizeSettings({ hotkeyFullscreen: 'нет такой' }, PICTURES).hotkeyFullscreen).toBe(
      DEFAULT_FULLSCREEN_HOTKEY
    )
    expect(sanitizeSettings({ hotkeyFullscreen: 42 }, PICTURES).hotkeyFullscreen).toBe(DEFAULT_FULLSCREEN_HOTKEY)
  })

  it('repairs a stored punctuation name into the character Electron accepts', () => {
    // This is the value that made the app fail to start: `Equal` is a DOM code
    // name, and `globalShortcut.register` throws on it. Loading must rewrite it
    // rather than hand it to Electron as-is.
    const settings = sanitizeSettings({ hotkeyFullscreen: 'CommandOrControl+Equal' }, PICTURES)
    expect(settings.hotkeyFullscreen).toBe('CommandOrControl+=')
    expect(settings.hotkeyFullscreen).not.toContain('Equal')
  })

  it('repairs the region shortcut the same way', () => {
    expect(sanitizeSettings({ hotkey: 'CommandOrControl+Minus' }, PICTURES).hotkey).toBe('CommandOrControl+-')
    expect(sanitizeSettings({ hotkey: 'Ctrl+Backquote' }, PICTURES).hotkey).toBe('CommandOrControl+`')
  })

  it('falls back when the stored key cannot be bound at all', () => {
    // `Escape` parses but Windows reserves it, so it is not offered as a choice.
    expect(sanitizeSettings({ hotkeyFullscreen: 'CommandOrControl+Escape' }, PICTURES).hotkeyFullscreen).toBe(
      DEFAULT_FULLSCREEN_HOTKEY
    )
  })
})

describe('background resolution', () => {
  it('resolves presets to exact colours', () => {
    expect(resolveBackgroundColor({ ...defaultSettings(PICTURES), backgroundPreset: 'white' })).toBe('#FFFFFF')
    expect(resolveBackgroundColor({ ...defaultSettings(PICTURES), backgroundPreset: 'gray' })).toBe(BACKGROUND_PRESETS.gray)
    expect(
      resolveBackgroundColor({ ...defaultSettings(PICTURES), backgroundPreset: 'custom', backgroundColor: '#abcdef' })
    ).toBe('#ABCDEF')
  })

  it('validates hex colours', () => {
    expect(isValidHexColor('#FFFFFF')).toBe(true)
    expect(isValidHexColor('#fff')).toBe(false)
    expect(isValidHexColor('FFFFFF')).toBe(false)
    expect(normalizeHexColor('#a0b1c2')).toBe('#A0B1C2')
  })
})
