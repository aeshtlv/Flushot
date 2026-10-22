import { DEFAULT_FULLSCREEN_HOTKEY, FALLBACK_FULLSCREEN_HOTKEY, DEFAULT_HOTKEY, isValidAccelerator, normalizeAccelerator } from './hotkey'
import type { ImageFormat, ScreenshotSettings } from './types'

/** Default width of the background frame drawn around the screenshot (px). */
export const FRAME_WIDTH = 64
/** Corner radius applied to the screenshot inside the frame (px). */
export const CARD_RADIUS = 12

export const BACKGROUND_PRESETS = {
  white: '#FFFFFF',
  gray: '#F2F2F7'
} as const

export const SETTINGS_LIMITS = {
  frameWidth: { min: 0, max: 200 },
  cornerRadius: { min: 0, max: 24 },
  shadowIntensity: { min: 0, max: 60 },
  shadowBlur: { min: 0, max: 48 },
  shadowOffsetY: { min: 0, max: 24 },
  jpegQuality: { min: 60, max: 100 }
} as const

/** How many custom colours the palette remembers. */
export const PALETTE_LIMIT = 6

export const HOTKEY = DEFAULT_HOTKEY

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

export function isValidHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR.test(value)
}

export function normalizeHexColor(value: string): string {
  return value.toUpperCase()
}

export function defaultSettings(picturesDirectory: string): ScreenshotSettings {
  return {
    theme: 'light',
    backgroundPreset: 'white',
    backgroundColor: '#FFFFFF',
    frameWidth: FRAME_WIDTH,
    cornerRadius: CARD_RADIUS,
    paletteColors: [],
    shadowEnabled: true,
    shadowIntensity: 30,
    shadowBlur: 40,
    shadowOffsetY: 16,
    saveDirectory: picturesDirectory,
    saveMode: 'folder',
    format: 'png',
    jpegQuality: 94,
    hotkey: DEFAULT_HOTKEY,
    hotkeyFullscreen: DEFAULT_FULLSCREEN_HOTKEY,
    launchAtLogin: false
  }
}

/** Keep only valid, de-duplicated colours, at most PALETTE_LIMIT of them. */
function cleanPalette(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  for (const entry of value) {
    if (!isValidHexColor(entry)) continue
    seen.add(normalizeHexColor(entry))
    if (seen.size >= PALETTE_LIMIT) break
  }
  return [...seen]
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

function cleanDirectory(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : fallback
}

/**
 * Merge unknown persisted data with defaults, enforcing valid ranges and types.
 * Never throws: a corrupt settings file must not prevent the app from starting.
 */
export function sanitizeSettings(input: unknown, picturesDirectory: string): ScreenshotSettings {
  const defaults = defaultSettings(picturesDirectory)
  if (typeof input !== 'object' || input === null) return defaults
  const raw = input as Partial<Record<keyof ScreenshotSettings, unknown>>

  const backgroundPreset = oneOf(raw.backgroundPreset, ['white', 'gray', 'custom'] as const, defaults.backgroundPreset)
  const backgroundColor = isValidHexColor(raw.backgroundColor)
    ? normalizeHexColor(raw.backgroundColor)
    : defaults.backgroundColor

  return {
    theme: oneOf(raw.theme, ['light', 'dark'] as const, defaults.theme),
    backgroundPreset,
    backgroundColor,
    frameWidth: clampInt(
      raw.frameWidth,
      SETTINGS_LIMITS.frameWidth.min,
      SETTINGS_LIMITS.frameWidth.max,
      defaults.frameWidth
    ),
    cornerRadius: clampInt(
      raw.cornerRadius,
      SETTINGS_LIMITS.cornerRadius.min,
      SETTINGS_LIMITS.cornerRadius.max,
      defaults.cornerRadius
    ),
    paletteColors: cleanPalette(raw.paletteColors),
    shadowEnabled: typeof raw.shadowEnabled === 'boolean' ? raw.shadowEnabled : defaults.shadowEnabled,
    shadowIntensity: clampInt(
      raw.shadowIntensity,
      SETTINGS_LIMITS.shadowIntensity.min,
      SETTINGS_LIMITS.shadowIntensity.max,
      defaults.shadowIntensity
    ),
    shadowBlur: clampInt(
      raw.shadowBlur,
      SETTINGS_LIMITS.shadowBlur.min,
      SETTINGS_LIMITS.shadowBlur.max,
      defaults.shadowBlur
    ),
    shadowOffsetY: clampInt(
      raw.shadowOffsetY,
      SETTINGS_LIMITS.shadowOffsetY.min,
      SETTINGS_LIMITS.shadowOffsetY.max,
      defaults.shadowOffsetY
    ),
    saveDirectory: cleanDirectory(raw.saveDirectory, defaults.saveDirectory),
    saveMode: oneOf(raw.saveMode, ['folder', 'ask'] as const, defaults.saveMode),
    format: oneOf<ImageFormat>(raw.format, ['png', 'jpeg', 'webp'], defaults.format),
    jpegQuality: clampInt(
      raw.jpegQuality,
      SETTINGS_LIMITS.jpegQuality.min,
      SETTINGS_LIMITS.jpegQuality.max,
      defaults.jpegQuality
    ),
    hotkey: isValidAccelerator(raw.hotkey) ? normalizeAccelerator(raw.hotkey) : defaults.hotkey,
    // A full-screen key equal to the region key would make one of the two
    // unreachable: the first registration wins and the other silently does
    // nothing. The second one falls back to its default instead.
    hotkeyFullscreen: sanitizeFullscreenHotkey(raw.hotkeyFullscreen, raw.hotkey, defaults),
    launchAtLogin: typeof raw.launchAtLogin === 'boolean' ? raw.launchAtLogin : defaults.launchAtLogin
  }
}

/** Full-screen shortcut, kept distinct from the region one. */
function sanitizeFullscreenHotkey(
  value: unknown,
  regionValue: unknown,
  defaults: ScreenshotSettings
): string {
  const region = isValidAccelerator(regionValue) ? normalizeAccelerator(regionValue) : defaults.hotkey
  if (!isValidAccelerator(value)) return defaults.hotkeyFullscreen === region ? FALLBACK_FULLSCREEN_HOTKEY : defaults.hotkeyFullscreen
  const normalized = normalizeAccelerator(value)
  return normalized === region ? FALLBACK_FULLSCREEN_HOTKEY : normalized
}

/** Effective background colour after resolving the preset. */
export function resolveBackgroundColor(settings: ScreenshotSettings): string {
  if (settings.backgroundPreset === 'white') return BACKGROUND_PRESETS.white
  if (settings.backgroundPreset === 'gray') return BACKGROUND_PRESETS.gray
  return isValidHexColor(settings.backgroundColor) ? normalizeHexColor(settings.backgroundColor) : BACKGROUND_PRESETS.white
}
