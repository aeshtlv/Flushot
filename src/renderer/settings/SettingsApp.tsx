import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { BACKGROUND_PRESETS, PALETTE_LIMIT, SETTINGS_LIMITS } from '../../shared/settings'
import {
  DEFAULT_FULLSCREEN_HOTKEY,
  DEFAULT_UPLOAD_HOTKEY,
  DEFAULT_HOTKEY,
  acceleratorFromKeyboardEvent,
  conflictingField,
  formatAccelerator,
  isIntrusiveShortcut,
  isValidAccelerator,
  normalizeAccelerator,
  reservedByWindows
} from '../../shared/hotkey'
import {
  LANGUAGE_NAMES,
  LANGUAGES,
  resolveLanguage,
  t,
  type Language,
  type LanguagePreference,
  type MessageKey
} from '../../shared/i18n'
import type { HotkeyState, SettingsWithHotkeys,
  AfterRegion,
  BackgroundPreset,
  ImageFormat,
  SaveMode,
  ScreenshotSettings,
  ThemeMode,
  UpdateState
} from '../../shared/types'
import { BrandMark } from '../BrandMark'

const BACKDROP_OPTIONS: { value: BackgroundPreset; label: MessageKey; swatch: string }[] = [
  { value: 'white', label: 'settings.backgroundWhite', swatch: BACKGROUND_PRESETS.white },
  { value: 'gray', label: 'settings.backgroundGray', swatch: BACKGROUND_PRESETS.gray },
  {
    value: 'custom',
    label: 'settings.backgroundCustom',
    swatch: 'conic-gradient(from 210deg, #ff9f0a, #ff375f, #bf5af2, #0a84ff, #32d74b, #ff9f0a)'
  }
]

export function SettingsApp(): JSX.Element {
  const [settings, setSettings] = useState<SettingsWithHotkeys | null>(null)
  const [info, setInfo] = useState<{ version: string; hotkey: string; settingsPath: string } | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [update, setUpdate] = useState<UpdateState>({ kind: 'idle' })
  /** Only problems are reported; successful changes are visible in the UI itself. */
  const [status, setStatus] = useState<string | null>(null)
  const previewTimer = useRef<number | null>(null)
  const statusTimer = useRef<number | null>(null)
  /**
   * Width the preview frame is currently drawn at, in CSS pixels.
   *
   * The sample is re-rendered at this width instead of a fixed 960 px: stretching
   * the window used to leave the picture at its old size with empty space beside
   * it, and simply scaling it up would have made a blurry preview. Zero means
   * "not measured yet" and falls back to a sane default.
   */
  const [previewWidth, setPreviewWidth] = useState(0)
  const previewFrame = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    void window.flushot.getSettings().then(setSettings)
    void window.flushot.getAppInfo().then(setInfo)
    // Optional on purpose: an older preload, and the headless stubs the screenshot
    // checks run against, have no update methods. Asking only for what exists
    // leaves the updates panel empty instead of taking the whole window down.
    if (typeof window.flushot.getUpdateState === 'function') {
      void window.flushot.getUpdateState().then(setUpdate)
    }
  }, [])

  useEffect(() => {
    if (!settings) return
    document.documentElement.dataset.theme = settings.theme
  }, [settings?.theme])

  /**
   * The interface language.
   *
   * Resolved here rather than received from the main process: the settings
   * payload already carries the preference, and the system language is a property
   * of this renderer. Both sides run the same `resolveLanguage`, so a changed
   * preference reaches the window with the same update that changes everything
   * else — no extra IPC call, no chance of the two disagreeing.
   */
  const lang: Language = resolveLanguage(settings?.language, navigator.language)
  const tr = useCallback(
    (key: MessageKey, vars?: Record<string, string | number>) => t(lang, key, vars),
    [lang]
  )

  // The frame is measured rather than the window: the padding and the scrollbar
  // differ between platforms, and the frame is what the picture has to fill.
  //
  // Re-subscribed once the settings arrive: the first render is the loading
  // placeholder, so the frame does not exist yet and a one-shot effect would
  // observe nothing at all.
  const ready = settings !== null
  useEffect(() => {
    if (!ready) return
    const node = previewFrame.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const width = Math.round(entries[0]?.contentRect.width ?? 0)
      if (width <= 0) return
      // Sub-pixel jitter and 1 px drags must not each trigger a re-render; the
      // render is debounced too, but this keeps the state itself quiet.
      setPreviewWidth((current) => (Math.abs(current - width) >= 6 ? width : current))
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [ready])

  const showError = useCallback((text: string) => {
    setStatus(text)
    if (statusTimer.current) window.clearTimeout(statusTimer.current)
    statusTimer.current = window.setTimeout(() => setStatus(null), 6000)
  }, [])

  const refreshPreview = useCallback(() => {
    if (previewTimer.current) window.clearTimeout(previewTimer.current)
    previewTimer.current = window.setTimeout(() => {
      // Rendered in device pixels so a wide window gets a sharp picture rather
      // than a stretched one. The main process clamps the value.
      const cssWidth = previewWidth || 440
      const pixels = Math.round(cssWidth * (window.devicePixelRatio || 1))
      void window.flushot.getPreview(pixels).then(setPreview).catch(() => undefined)
    }, 180)
  }, [previewWidth])

  useEffect(() => {
    if (settings) refreshPreview()
  }, [settings, previewWidth, refreshPreview])

  useEffect(
    () => () => {
      if (previewTimer.current) window.clearTimeout(previewTimer.current)
      if (statusTimer.current) window.clearTimeout(statusTimer.current)
    },
    []
  )

  const patch = useCallback(async (changes: Partial<ScreenshotSettings>) => {
    setSettings((current) => (current ? { ...current, ...changes } : current))
    try {
      const next = await window.flushot.updateSettings(changes)
      setSettings(next)
    } catch (error) {
      showError(error instanceof Error ? error.message : t(lang, 'settings.saveFailed'))
    }
  }, [lang, showError])

  const pickFolder = useCallback(async () => {
    try {
      const result = await window.flushot.pickDirectory()
      if (result.canceled || !result.path) return
      await patch({ saveDirectory: result.path })
    } catch (error) {
      showError(error instanceof Error ? error.message : t(lang, 'settings.folderPickFailed'))
    }
  }, [lang, patch, showError])

  const openFolder = useCallback(async () => {
    try {
      await window.flushot.openSaveFolder()
    } catch (error) {
      showError(error instanceof Error ? error.message : t(lang, 'settings.folderOpenFailed'))
    }
  }, [lang, showError])

  const reset = useCallback(async () => {
    try {
      const next = await window.flushot.resetSettings()
      setSettings(next)
    } catch (error) {
      showError(error instanceof Error ? error.message : t(lang, 'settings.resetFailed'))
    }
  }, [lang, showError])

  const saveHotkey = useCallback(
    async (field: 'hotkey' | 'hotkeyFullscreen' | 'hotkeyUpload', hotkey: string) => {
      if (!isValidAccelerator(hotkey)) {
        showError(tr('settings.hotkeyNeedsModifier'))
        return
      }
      const normalized = normalizeAccelerator(hotkey)
      const combo = formatAccelerator(normalized)

      // The two actions need different combinations: Windows binds a global
      // shortcut to one handler only, so an identical pair would leave one of
      // them dead. Say that plainly instead of letting the saved value silently
      // turn into the fallback combination.
      const clash = conflictingField(field, normalized, {
        hotkey: settings?.hotkey ?? '',
        hotkeyFullscreen: settings?.hotkeyFullscreen ?? '',
        hotkeyUpload: settings?.hotkeyUpload ?? ''
      })
      if (clash) {
        showError(
          tr('settings.hotkeyClash', {
            combo,
            action: tr(
              clash === 'hotkey'
                ? 'settings.actionRegion'
                : clash === 'hotkeyUpload'
                  ? 'settings.actionUpload'
                  : 'settings.actionFullscreen'
            )
          })
        )
        return
      }

      // Ask the system before saving. A combination Windows reserves for itself
      // cannot be taken by any program, and the honest answer is to name the
      // owner instead of saving a value that will silently do nothing.
      const reserved = reservedByWindows(normalized, lang)
      if (reserved) {
        showError(tr('settings.hotkeyReserved', { combo, owner: reserved.owner, hint: reserved.hint }))
        return
      }
      try {
        const probe = await window.flushot.probeHotkey(normalized)
        if (!probe.free && !probe.ours) {
          // Name the owner and stop there. Listing "free" combinations was tried and
          // removed: it turned the row into a menu of our suggestions and the user
          // asked to choose their own key.
          showError(
            probe.hint
              ? tr('settings.hotkeyTakenWithHint', {
                  combo,
                  owner: probe.owner ?? tr('settings.otherProgram'),
                  hint: probe.hint
                })
              : tr('settings.hotkeyTaken', { combo })
          )
          return
        }
      } catch {
        // A probe that fails is not a reason to block the change; the save below
        // reports whether the key really bound.
      }

      try {
        const next = await window.flushot.updateSettings({ [field]: normalized })
        setSettings(next)
        const applied = next[field] === normalized
        if (!applied) {
          // `''` means the combination could not be bound at all, which is a
          // different problem from another app owning it.
          showError(
            next[field]
              ? tr('settings.hotkeySwitched', { combo, active: formatAccelerator(next[field]) })
              : tr('settings.hotkeyNotAssigned', { combo })
          )
        } else if (isIntrusiveShortcut(normalized)) {
          showError(tr('settings.hotkeyIntrusive', { combo }))
        }
      } catch (error) {
        showError(error instanceof Error ? error.message : tr('settings.hotkeyChangeFailed'))
      }
    },
    [lang, settings?.hotkey, settings?.hotkeyFullscreen, showError, tr]
  )

  const customColor = useMemo(() => {
    if (!settings) return '#FFFFFF'
    return settings.backgroundPreset === 'custom' ? settings.backgroundColor : '#8E8E93'
  }, [settings])

  if (!settings) {
    return <div className="loading">{t(lang, 'settings.loading')}</div>
  }

  return (
    <div className="app">
      <header className="titlebar">
        <div className="titlebar__title">
          <BrandMark size={16} className="logo" />
          <span>Flushot</span>
        </div>
        <button className="icon-button" onClick={() => void window.flushot.closeWindow()} title={tr('settings.close')}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
      </header>

      <main className="content">
        <section className="preview" aria-label={tr('settings.previewLabel')}>
          <div className="preview__frame" ref={previewFrame}>
            {preview ? <img src={preview} alt={tr('settings.previewAlt')} /> : <div className="preview__skeleton" />}
          </div>
          <div className="preview__meta">
            <span>{tr('settings.previewCaption')}</span>
            <span className="dot" />
            <span>{formatSummary(settings.format, settings.jpegQuality)}</span>
          </div>
        </section>

        <div className="panels">
          {/* Colours live right under the preview: the effect of every swatch is
              visible immediately, without scrolling. */}
          <section className="panel">
            <h2>{tr('settings.sectionAppearance')}</h2>

            <Row label={tr('settings.theme')} hint={tr('settings.themeHint')}>
              <Segmented<ThemeMode>
                value={settings.theme}
                options={[
                  { value: 'light', label: tr('settings.themeLight') },
                  { value: 'dark', label: tr('settings.themeDark') }
                ]}
                onChange={(theme) => void patch({ theme })}
              />
            </Row>

            <Row label={tr('settings.background')} hint={tr('settings.backgroundHint')}>
              <div className="swatches">
                {BACKDROP_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    className={`swatch ${settings.backgroundPreset === option.value ? 'is-active' : ''}`}
                    onClick={() => void patch({ backgroundPreset: option.value })}
                    title={tr(option.label)}
                    aria-pressed={settings.backgroundPreset === option.value}
                  >
                    <span className="swatch__color" style={{ background: option.swatch }} />
                    <span className="swatch__label">{tr(option.label)}</span>
                  </button>
                ))}
                <label className={`swatch swatch--picker ${settings.backgroundPreset === 'custom' ? 'is-active' : ''}`} title={tr('settings.pickColor')}>
                  <input
                    type="color"
                    value={customColor}
                    onChange={(event) => {
                      const backgroundColor = event.target.value.toUpperCase()
                      void patch({ backgroundPreset: 'custom', backgroundColor })
                    }}
                  />
                  <span className="swatch__color swatch__color--custom" style={{ background: settings.backgroundColor }} />
                  <span className="swatch__label">{tr('settings.palette')}</span>
                </label>

                {settings.paletteColors.map((saved) => (
                  <button
                    key={saved}
                    className={`swatch swatch--saved ${
                      settings.backgroundPreset === 'custom' && settings.backgroundColor === saved ? 'is-active' : ''
                    }`}
                    title={tr('settings.paletteRemove', { color: saved })}
                    onClick={() => void patch({ backgroundPreset: 'custom', backgroundColor: saved })}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      void patch({ paletteColors: settings.paletteColors.filter((entry) => entry !== saved) })
                    }}
                  >
                    <span className="swatch__color" style={{ background: saved }} />
                    <span className="swatch__label">{saved.slice(1)}</span>
                  </button>
                ))}

                {/* The current custom colour can be pinned for later reuse. */}
                {settings.backgroundPreset === 'custom' && !settings.paletteColors.includes(settings.backgroundColor) && (
                  <button
                    className="swatch swatch--add"
                    title={tr('settings.paletteAdd')}
                    disabled={settings.paletteColors.length >= PALETTE_LIMIT}
                    onClick={() =>
                      void patch({ paletteColors: [...settings.paletteColors, settings.backgroundColor].slice(0, PALETTE_LIMIT) })
                    }
                  >
                    <span className="swatch__color swatch__color--add" />
                    <span className="swatch__label">{tr('settings.paletteAddShort')}</span>
                  </button>
                )}
              </div>
            </Row>

            <Slider
              name="frameWidth"
              label={tr('settings.frameWidth')}
              value={settings.frameWidth}
              min={SETTINGS_LIMITS.frameWidth.min}
              max={SETTINGS_LIMITS.frameWidth.max}
              suffix="px"
              onChange={(frameWidth) => void patch({ frameWidth })}
            />

            <Slider
              name="cornerRadius"
              label={tr('settings.cornerRadius')}
              value={settings.cornerRadius}
              min={SETTINGS_LIMITS.cornerRadius.min}
              max={SETTINGS_LIMITS.cornerRadius.max}
              suffix="px"
              onChange={(cornerRadius) => void patch({ cornerRadius })}
            />
          </section>

          <section className="panel">
            <h2>{tr('settings.sectionCapture')}</h2>

            <Row label={tr('settings.hotkey')} hint={tr('settings.hotkeyHint')}>
              <HotkeyRecorder
                lang={lang}
                value={settings.hotkey}
                fallback={DEFAULT_HOTKEY}
                fallbackLabel={formatAccelerator(DEFAULT_HOTKEY)}
                onCommit={(hotkey) => void saveHotkey('hotkey', hotkey)}
              />
            </Row>
            <HotkeyNotice state={settings.hotkeys?.region} lang={lang} />

            <Row label={tr('settings.fullscreen')} hint={tr('settings.fullscreenHint')}>
              <HotkeyRecorder
                lang={lang}
                value={settings.hotkeyFullscreen}
                fallback={DEFAULT_FULLSCREEN_HOTKEY}
                fallbackLabel={formatAccelerator(DEFAULT_FULLSCREEN_HOTKEY)}
                onCommit={(hotkey) => void saveHotkey('hotkeyFullscreen', hotkey)}
              />
            </Row>
            <HotkeyNotice state={settings.hotkeys?.fullscreen} lang={lang} />

            {/* The note under this row is the only place in the interface that says a
                screenshot can leave the computer, so it is part of the control and not
                a footnote somewhere else. */}
            <Row label={tr('settings.upload')} hint={tr('settings.uploadHint')}>
              <HotkeyRecorder
                lang={lang}
                value={settings.hotkeyUpload}
                fallback={DEFAULT_UPLOAD_HOTKEY}
                fallbackLabel={formatAccelerator(DEFAULT_UPLOAD_HOTKEY)}
                onCommit={(hotkey) => void saveHotkey('hotkeyUpload', hotkey)}
              />
            </Row>
            <HotkeyNotice state={settings.hotkeys?.upload} lang={lang} />

            <p className="row-note">{tr('settings.uploadPrivacy')}</p>

            <Row
              label={tr('settings.afterRegion')}
              hint={t(
                lang,
                settings.afterRegion === 'copy'
                  ? 'settings.afterRegionCopyHint'
                  : 'settings.afterRegionEditHint'
              )}
            >
              <Segmented<AfterRegion>
                value={settings.afterRegion}
                options={[
                  { value: 'copy', label: tr('settings.afterRegionCopy') },
                  { value: 'edit', label: tr('settings.afterRegionEdit') }
                ]}
                onChange={(afterRegion) => void patch({ afterRegion })}
              />
            </Row>

            <Row label={tr('settings.launchAtLogin')} hint={tr('settings.launchAtLoginHint')}>
              <Toggle
                checked={settings.launchAtLogin}
                onChange={(launchAtLogin) => void patch({ launchAtLogin })}
              />
            </Row>
          </section>

          <section className="panel">
            <h2>{tr('settings.sectionShadow')}</h2>

            <Row label={tr('settings.shadow')}>
              <Toggle checked={settings.shadowEnabled} onChange={(shadowEnabled) => void patch({ shadowEnabled })} />
            </Row>

            <Slider
              name="shadowIntensity"
              label={tr('settings.shadowIntensity')}
              value={settings.shadowIntensity}
              min={SETTINGS_LIMITS.shadowIntensity.min}
              max={SETTINGS_LIMITS.shadowIntensity.max}
              suffix="%"
              disabled={!settings.shadowEnabled}
              onChange={(shadowIntensity) => void patch({ shadowIntensity })}
            />
            <Slider
              name="shadowBlur"
              label={tr('settings.shadowBlur')}
              value={settings.shadowBlur}
              min={SETTINGS_LIMITS.shadowBlur.min}
              max={SETTINGS_LIMITS.shadowBlur.max}
              suffix="px"
              disabled={!settings.shadowEnabled}
              onChange={(shadowBlur) => void patch({ shadowBlur })}
            />
          </section>

          <section className="panel">
            <h2>{tr('settings.sectionSaving')}</h2>

            <Row label={tr('settings.folder')} hint={tr('settings.folderHint')}>
              <div className="folder">
                <button className="folder__path" onClick={() => void openFolder()} title={tr('settings.folderOpen', { path: settings.saveDirectory })}>
                  {settings.saveDirectory}
                </button>
                <button className="button" onClick={() => void pickFolder()}>
                  {tr('settings.folderChange')}
                </button>
              </div>
            </Row>

            <Row label={tr('settings.afterShot')} hint={tr('settings.afterShotHint')}>
              <Segmented<SaveMode>
                value={settings.saveMode}
                options={[
                  { value: 'folder', label: tr('settings.saveToFolder') },
                  { value: 'ask', label: tr('settings.askWhere') }
                ]}
                onChange={(saveMode) => void patch({ saveMode })}
              />
            </Row>

            <Row label={tr('settings.format')}>
              <Segmented<ImageFormat>
                value={settings.format}
                options={[
                  { value: 'png', label: 'PNG' },
                  { value: 'jpeg', label: 'JPEG' },
                  { value: 'webp', label: 'WebP' }
                ]}
                onChange={(format) => void patch({ format })}
              />
            </Row>

            {settings.format !== 'png' && (
              <Slider
                name="quality"
                label={tr(settings.format === 'webp' ? 'settings.qualityWebp' : 'settings.qualityJpeg')}
                value={settings.jpegQuality}
                min={SETTINGS_LIMITS.jpegQuality.min}
                max={SETTINGS_LIMITS.jpegQuality.max}
                suffix="%"
                onChange={(jpegQuality) => void patch({ jpegQuality })}
              />
            )}
          </section>

          {/* Language sits after the settings that change how a screenshot looks,
              because it changes nothing about the picture — only this window and
              the overlay. Anyone who needs it is looking for it by name. */}
          <section className="panel">
            <h2>{tr('settings.sectionLanguage')}</h2>

            <Row label={tr('settings.language')} hint={tr('settings.languageHint')}>
              <div className="segmented segmented--wrap" role="group">
                {(['auto', ...LANGUAGES] as LanguagePreference[]).map((option) => (
                  <button
                    key={option}
                    className={`segmented__item ${settings.language === option ? 'is-active' : ''}`}
                    aria-pressed={settings.language === option}
                    onClick={() => void patch({ language: option })}
                  >
                    {option === 'auto' ? tr('settings.languageAuto') : LANGUAGE_NAMES[option]}
                  </button>
                ))}
              </div>
            </Row>
          </section>

          {/* After the language, before the reset: version and updates are what
              someone looks for once, not a setting they tune. */}
          <section className="panel panel--updates">
            <h2>{tr('settings.sectionUpdates')}</h2>

            {update.kind !== 'manual' && (
              <Row label={tr('settings.checkUpdates')} hint={tr('settings.checkUpdatesHint')}>
                <Toggle
                  checked={settings.checkUpdates}
                  onChange={(checkUpdates) => void patch({ checkUpdates })}
                />
              </Row>
            )}

            <div className="update-line">
              <span className="update-line__text">{describeUpdate(update, tr, info?.version)}</span>
              {update.kind === 'ready' ? (
                <button className="button button--primary" onClick={() => void window.flushot.installUpdate?.()}>
                  {tr('settings.updateInstall')}
                </button>
              ) : (
                update.kind !== 'manual' && (
                  <button
                    className="button"
                    disabled={!settings.checkUpdates || !canCheck(update)}
                    onClick={() => {
                      setUpdate({ kind: 'checking' })
                      void window.flushot.checkForUpdates?.().then(setUpdate)
                    }}
                  >
                    {tr('settings.checkNow')}
                  </button>
                )
              )}
            </div>
          </section>

          {/* Deliberately at the very end: reaching it requires scrolling past
              every setting, so it cannot be hit while changing colours. */}
          <section className="panel panel--reset">
            <div className="reset">
              <div className="reset__text">
                <span className="reset__title">{tr('settings.resetTitle')}</span>
                <span className="reset__hint">{tr('settings.resetHint')}</span>
              </div>
              <button className="button button--danger" onClick={() => void reset()}>
                {tr('settings.resetButton')}
              </button>
            </div>
          </section>
        </div>
      </main>

      <footer className="footer">
        <div className="footer__hint">
          <kbd>{formatAccelerator(settings.hotkey)}</kbd>
          <span>{tr('settings.footerHint')}</span>
        </div>
        <span className="version">v{info?.version ?? '1.0.0'}</span>
        {status && (
          <span className="status" role="status">
            {status}
          </span>
        )}
      </footer>
    </div>
  )
}

/**
 * Click to start listening, then press the combination. Escape cancels, and the
 * reset button restores the default shortcut.
 */
function HotkeyRecorder({
  lang,
  value,
  fallback,
  fallbackLabel,
  onCommit
}: {
  lang: Language
  value: string
  /** Combination the reset button restores. */
  fallback: string
  fallbackLabel: string
  onCommit: (hotkey: string) => void
}): JSX.Element {
  const [recording, setRecording] = useState(false)

  useEffect(() => {
    if (!recording) return

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setRecording(false)
        return
      }

      // Ignore bare modifier presses so the user can hold Ctrl before the key.
      if (['Control', 'Alt', 'Shift', 'Meta', 'CapsLock'].includes(event.key)) return

      const accelerator = acceleratorFromKeyboardEvent({
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        metaKey: event.metaKey,
        code: event.code
      })

      event.preventDefault()
      event.stopPropagation()
      if (!accelerator) return

      setRecording(false)
      onCommit(accelerator)
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onCommit, recording])

  return (
    <div className="hotkey">
      <button
        className={`hotkey__field ${recording ? 'is-recording' : ''}`}
        onClick={() => setRecording((current) => !current)}
        title={t(lang, recording ? 'settings.recordingTitle' : 'settings.recordTitle')}
      >
        {recording ? (
          <span className="hotkey__prompt">{t(lang, 'settings.recordingPrompt')}</span>
        ) : (
          <kbd>{formatAccelerator(value)}</kbd>
        )}
      </button>
      <button
        className="button button--ghost"
        onClick={() => onCommit(fallback)}
        title={t(lang, 'settings.resetHotkey', { combo: fallbackLabel })}
      >
        {t(lang, 'settings.resetHotkeyShort')}
      </button>
    </div>
  )
}

/**
 * Short label for the chosen file format.
 *
 * WebP used to fall into the JPEG branch, so the preview caption claimed "JPEG"
 * while the file was written as `.webp` — the format worked, the label lied.
 */
function formatSummary(format: ImageFormat, quality: number): string {
  if (format === 'png') return 'PNG'
  if (format === 'webp') return `WebP · ${quality}%`
  return `JPEG · ${quality}%`
}

/** Whether the button can do anything in the current state. */
function canCheck(state: UpdateState): boolean {
  return state.kind !== 'checking' && state.kind !== 'downloading' && state.kind !== 'ready' && state.kind !== 'off'
}

/**
 * One sentence for the whole state.
 *
 * The state is a tagged union, so a kind nobody handled is a compile error rather
 * than a blank line — which is how this would otherwise fail: silently, and only in
 * the one state nobody had seen yet.
 */
function describeUpdate(
  state: UpdateState,
  tr: (key: MessageKey, vars?: Record<string, string | number>) => string,
  version: string | undefined
): string {
  switch (state.kind) {
    case 'idle':
      return tr('settings.updateIdle')
    case 'off':
      return tr('settings.updateOff')
    case 'manual':
      return tr('settings.updateManual')
    case 'checking':
      return tr('settings.updateChecking')
    case 'current':
      return tr('settings.updateCurrent', { version: state.version })
    case 'downloading':
      // A download that starts before the version is known (the manifest is read
      // first) still has to say something, so it falls back to the running one.
      return tr('settings.updateDownloading', {
        version: state.version || version || '—',
        percent: state.percent
      })
    case 'ready':
      return tr('settings.updateReady', { version: state.version })
    case 'failed':
      return tr('settings.updateFailed', { message: state.message })
  }
}

/**
 * The honest answer to "is this shortcut working".
 *
 * Three states, and the middle one is the reason this exists: Windows gives a combination
 * to one program only, so a taken key is replaced by an alternative, or by nothing at all.
 * The window used to show the combination from the file in every case — the user pressed
 * it, nothing happened, and nothing on screen said why.
 */
function HotkeyNotice({ state, lang }: { state?: HotkeyState; lang: Language }): JSX.Element | null {
  if (!state) return null
  if (!state.active) {
    return (
      <p className="row-note row-note--warn" data-hotkey-notice="unbound">
        {t(lang, 'settings.hotkeyUnbound', { requested: formatAccelerator(state.requested) })}
      </p>
    )
  }
  if (state.active !== state.requested) {
    return (
      <p className="row-note row-note--warn" data-hotkey-notice="fallback">
        {t(lang, 'settings.hotkeyFallback', {
          requested: formatAccelerator(state.requested),
          active: formatAccelerator(state.active)
        })}
      </p>
    )
  }
  return null
}

function Row({ label, hint, children }: { label: string; hint?: string; children: JSX.Element }): JSX.Element {
  return (
    <div className="row">
      <div className="row__text">
        <span className="row__label">{label}</span>
        {hint && (
          <span className="row__hint" title={hint}>
            {hint}
          </span>
        )}
      </div>
      <div className="row__control">{children}</div>
    </div>
  )
}

function Segmented<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}): JSX.Element {
  return (
    <div className="segmented" role="group">
      {options.map((option) => (
        <button
          key={option.value}
          className={`segmented__item ${option.value === value ? 'is-active' : ''}`}
          onClick={() => onChange(option.value)}
          aria-pressed={option.value === value}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }): JSX.Element {
  return (
    <button
      className={`toggle ${checked ? 'is-on' : ''}`}
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle__knob" />
    </button>
  )
}

function Slider({
  name,
  label,
  value,
  min,
  max,
  suffix,
  disabled,
  onChange
}: {
  /**
   * Stable name for the slider itself.
   *
   * The label is interface text and therefore translated, so anything that has
   * to find this control — the self-test, the screenshot script — cannot look
   * for the word. The name does not change with the language.
   */
  name: string
  label: string
  value: number
  min: number
  max: number
  suffix: string
  disabled?: boolean
  onChange: (value: number) => void
}): JSX.Element {
  return (
    <div className={`slider ${disabled ? 'is-disabled' : ''}`} data-slider={name}>
      <div className="slider__head">
        <span className="row__label">{label}</span>
        <span className="slider__value">
          {value}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  )
}
