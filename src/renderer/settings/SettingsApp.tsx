import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { BACKGROUND_PRESETS, PALETTE_LIMIT, SETTINGS_LIMITS } from '../../shared/settings'
import {
  DEFAULT_FULLSCREEN_HOTKEY,
  DEFAULT_HOTKEY,
  acceleratorFromKeyboardEvent,
  conflictingField,
  formatAccelerator,
  isIntrusiveShortcut,
  isValidAccelerator,
  normalizeAccelerator,
  reservedByWindows
} from '../../shared/hotkey'
import type { BackgroundPreset, ImageFormat, SaveMode, ScreenshotSettings, ThemeMode } from '../../shared/types'
import { BrandMark } from '../BrandMark'

const BACKDROP_OPTIONS: { value: BackgroundPreset; label: string; swatch: string }[] = [
  { value: 'white', label: 'Белый', swatch: BACKGROUND_PRESETS.white },
  { value: 'gray', label: 'Серый', swatch: BACKGROUND_PRESETS.gray },
  { value: 'custom', label: 'Свой цвет', swatch: 'conic-gradient(from 210deg, #ff9f0a, #ff375f, #bf5af2, #0a84ff, #32d74b, #ff9f0a)' }
]

export function SettingsApp(): JSX.Element {
  const [settings, setSettings] = useState<ScreenshotSettings | null>(null)
  const [info, setInfo] = useState<{ version: string; hotkey: string; settingsPath: string } | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
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
  }, [])

  useEffect(() => {
    if (!settings) return
    document.documentElement.dataset.theme = settings.theme
  }, [settings?.theme])

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
      showError(error instanceof Error ? error.message : 'Не удалось сохранить настройки')
    }
  }, [showError])

  const pickFolder = useCallback(async () => {
    try {
      const result = await window.flushot.pickDirectory()
      if (result.canceled || !result.path) return
      await patch({ saveDirectory: result.path })
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Не удалось выбрать папку')
    }
  }, [patch, showError])

  const openFolder = useCallback(async () => {
    try {
      await window.flushot.openSaveFolder()
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Не удалось открыть папку')
    }
  }, [showError])

  const reset = useCallback(async () => {
    try {
      const next = await window.flushot.resetSettings()
      setSettings(next)
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Не удалось сбросить настройки')
    }
  }, [showError])

  const saveHotkey = useCallback(
    async (field: 'hotkey' | 'hotkeyFullscreen', hotkey: string) => {
      if (!isValidAccelerator(hotkey)) {
        showError('Добавьте модификатор: Ctrl, Alt или Shift')
        return
      }
      const normalized = normalizeAccelerator(hotkey)

      // The two actions need different combinations: Windows binds a global
      // shortcut to one handler only, so an identical pair would leave one of
      // them dead. Say that plainly instead of letting the saved value silently
      // turn into the fallback combination.
      const clash = conflictingField(field, normalized, {
        hotkey: settings?.hotkey ?? '',
        hotkeyFullscreen: settings?.hotkeyFullscreen ?? ''
      })
      if (clash) {
        showError(
          `${formatAccelerator(normalized)} уже занята ${clash === 'hotkey' ? 'выделением области' : 'снимком всего экрана'} — выберите другое сочетание`
        )
        return
      }

      // Ask the system before saving. A combination Windows reserves for itself
      // cannot be taken by any program, and the honest answer is to name the
      // owner instead of saving a value that will silently do nothing.
      const reserved = reservedByWindows(normalized)
      if (reserved) {
        showError(`${formatAccelerator(normalized)} занята ${reserved.owner}. ${reserved.hint}`)
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
              ? `${formatAccelerator(normalized)} занята ${probe.owner ?? 'другой программой'}. ${probe.hint}`
              : `${formatAccelerator(normalized)} занята другой программой — закройте её или наберите другое сочетание.`
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
              ? `${formatAccelerator(normalized)} занята другой программой — работает ${formatAccelerator(next[field])}`
              : `${formatAccelerator(normalized)} не удалось назначить — выберите другое сочетание`
          )
        } else if (isIntrusiveShortcut(normalized)) {
          showError(`Клавиша ${formatAccelerator(normalized)} перехватывается во всех программах — печатать её не получится`)
        }
      } catch (error) {
        showError(error instanceof Error ? error.message : 'Не удалось изменить клавишу')
      }
    },
    [settings?.hotkey, settings?.hotkeyFullscreen, showError]
  )

  const customColor = useMemo(() => {
    if (!settings) return '#FFFFFF'
    return settings.backgroundPreset === 'custom' ? settings.backgroundColor : '#8E8E93'
  }, [settings])

  if (!settings) {
    return <div className="loading">Загрузка настроек…</div>
  }

  return (
    <div className="app">
      <header className="titlebar">
        <div className="titlebar__title">
          <BrandMark size={16} className="logo" />
          <span>Flushot</span>
        </div>
        <button className="icon-button" onClick={() => void window.flushot.closeWindow()} title="Закрыть (Esc)">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
      </header>

      <main className="content">
        <section className="preview" aria-label="Предпросмотр результата">
          <div className="preview__frame" ref={previewFrame}>
            {preview ? <img src={preview} alt="Предпросмотр снимка" /> : <div className="preview__skeleton" />}
          </div>
          <div className="preview__meta">
            <span>Снимок + рамка</span>
            <span className="dot" />
            <span>{formatSummary(settings.format, settings.jpegQuality)}</span>
          </div>
        </section>

        <div className="panels">
          {/* Colours live right under the preview: the effect of every swatch is
              visible immediately, without scrolling. */}
          <section className="panel">
            <h2>Оформление</h2>

            <Row label="Тема" hint="Светлая по умолчанию">
              <Segmented<ThemeMode>
                value={settings.theme}
                options={[
                  { value: 'light', label: 'Светлая' },
                  { value: 'dark', label: 'Тёмная' }
                ]}
                onChange={(theme) => void patch({ theme })}
              />
            </Row>

            <Row label="Фон" hint="Свободное поле вокруг снимка">
              <div className="swatches">
                {BACKDROP_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    className={`swatch ${settings.backgroundPreset === option.value ? 'is-active' : ''}`}
                    onClick={() => void patch({ backgroundPreset: option.value })}
                    title={option.label}
                    aria-pressed={settings.backgroundPreset === option.value}
                  >
                    <span className="swatch__color" style={{ background: option.swatch }} />
                    <span className="swatch__label">{option.label}</span>
                  </button>
                ))}
                <label className={`swatch swatch--picker ${settings.backgroundPreset === 'custom' ? 'is-active' : ''}`} title="Выбрать цвет">
                  <input
                    type="color"
                    value={customColor}
                    onChange={(event) => {
                      const backgroundColor = event.target.value.toUpperCase()
                      void patch({ backgroundPreset: 'custom', backgroundColor })
                    }}
                  />
                  <span className="swatch__color swatch__color--custom" style={{ background: settings.backgroundColor }} />
                  <span className="swatch__label">Палитра</span>
                </label>

                {settings.paletteColors.map((saved) => (
                  <button
                    key={saved}
                    className={`swatch swatch--saved ${
                      settings.backgroundPreset === 'custom' && settings.backgroundColor === saved ? 'is-active' : ''
                    }`}
                    title={`${saved} — правый клик, чтобы убрать`}
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
                    title="Сохранить этот цвет в палитру"
                    disabled={settings.paletteColors.length >= PALETTE_LIMIT}
                    onClick={() =>
                      void patch({ paletteColors: [...settings.paletteColors, settings.backgroundColor].slice(0, PALETTE_LIMIT) })
                    }
                  >
                    <span className="swatch__color swatch__color--add" />
                    <span className="swatch__label">В палитру</span>
                  </button>
                )}
              </div>
            </Row>

            <Slider
              label="Толщина рамки"
              value={settings.frameWidth}
              min={SETTINGS_LIMITS.frameWidth.min}
              max={SETTINGS_LIMITS.frameWidth.max}
              suffix="px"
              onChange={(frameWidth) => void patch({ frameWidth })}
            />

            <Slider
              label="Скругление углов"
              value={settings.cornerRadius}
              min={SETTINGS_LIMITS.cornerRadius.min}
              max={SETTINGS_LIMITS.cornerRadius.max}
              suffix="px"
              onChange={(cornerRadius) => void patch({ cornerRadius })}
            />
          </section>

          <section className="panel">
            <h2>Снимок</h2>

            <Row label="Горячая клавиша" hint="Выделение области — сочетание или одна клавиша">
              <HotkeyRecorder
                value={settings.hotkey}
                fallback={DEFAULT_HOTKEY}
                fallbackLabel={formatAccelerator(DEFAULT_HOTKEY)}
                onCommit={(hotkey) => void saveHotkey('hotkey', hotkey)}
              />
            </Row>

            <Row label="Весь экран" hint="Сразу снимок всего экрана, без выделения">
              <HotkeyRecorder
                value={settings.hotkeyFullscreen}
                fallback={DEFAULT_FULLSCREEN_HOTKEY}
                fallbackLabel={formatAccelerator(DEFAULT_FULLSCREEN_HOTKEY)}
                onCommit={(hotkey) => void saveHotkey('hotkeyFullscreen', hotkey)}
              />
            </Row>

            <Row label="Запускать с Windows" hint="Flushot стартует в трее, окно не открывается">
              <Toggle
                checked={settings.launchAtLogin}
                onChange={(launchAtLogin) => void patch({ launchAtLogin })}
              />
            </Row>
          </section>

          <section className="panel">
            <h2>Тень</h2>

            <Row label="Тень вокруг снимка">
              <Toggle checked={settings.shadowEnabled} onChange={(shadowEnabled) => void patch({ shadowEnabled })} />
            </Row>

            <Slider
              label="Интенсивность"
              value={settings.shadowIntensity}
              min={SETTINGS_LIMITS.shadowIntensity.min}
              max={SETTINGS_LIMITS.shadowIntensity.max}
              suffix="%"
              disabled={!settings.shadowEnabled}
              onChange={(shadowIntensity) => void patch({ shadowIntensity })}
            />
            <Slider
              label="Радиус размытия"
              value={settings.shadowBlur}
              min={SETTINGS_LIMITS.shadowBlur.min}
              max={SETTINGS_LIMITS.shadowBlur.max}
              suffix="px"
              disabled={!settings.shadowEnabled}
              onChange={(shadowBlur) => void patch({ shadowBlur })}
            />
          </section>

          <section className="panel">
            <h2>Сохранение</h2>

            <Row label="Папка" hint="Нажмите на путь, чтобы открыть папку">
              <div className="folder">
                <button className="folder__path" onClick={() => void openFolder()} title={`Открыть ${settings.saveDirectory}`}>
                  {settings.saveDirectory}
                </button>
                <button className="button" onClick={() => void pickFolder()}>
                  Изменить…
                </button>
              </div>
            </Row>

            <Row label="После снимка" hint="Как поступать с готовым изображением">
              <Segmented<SaveMode>
                value={settings.saveMode}
                options={[
                  { value: 'folder', label: 'Сохранять в папку' },
                  { value: 'ask', label: 'Спрашивать' }
                ]}
                onChange={(saveMode) => void patch({ saveMode })}
              />
            </Row>

            <Row label="Формат">
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
                label={settings.format === 'webp' ? 'Качество WebP' : 'Качество JPEG'}
                value={settings.jpegQuality}
                min={SETTINGS_LIMITS.jpegQuality.min}
                max={SETTINGS_LIMITS.jpegQuality.max}
                suffix="%"
                onChange={(jpegQuality) => void patch({ jpegQuality })}
              />
            )}
          </section>

          {/* Deliberately at the very end: reaching it requires scrolling past
              every setting, so it cannot be hit while changing colours. */}
          <section className="panel panel--reset">
            <div className="reset">
              <div className="reset__text">
                <span className="reset__title">Сбросить все настройки</span>
                <span className="reset__hint">
                  Вернуть оформление, тень, сохранение и горячую клавишу к значениям по умолчанию
                </span>
              </div>
              <button className="button button--danger" onClick={() => void reset()}>
                Сбросить
              </button>
            </div>
          </section>
        </div>
      </main>

      <footer className="footer">
        <div className="footer__hint">
          <kbd>{formatAccelerator(settings.hotkey)}</kbd>
          <span>вызов выделения</span>
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
  value,
  fallback,
  fallbackLabel,
  onCommit
}: {
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
        title={recording ? 'Нажмите сочетание клавиш, Esc — отмена' : 'Нажмите, чтобы записать сочетание'}
      >
        {recording ? <span className="hotkey__prompt">Нажмите сочетание…</span> : <kbd>{formatAccelerator(value)}</kbd>}
      </button>
      <button className="button button--ghost" onClick={() => onCommit(fallback)} title={`Вернуть ${fallbackLabel}`}>
        Сброс
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
  label,
  value,
  min,
  max,
  suffix,
  disabled,
  onChange
}: {
  label: string
  value: number
  min: number
  max: number
  suffix: string
  disabled?: boolean
  onChange: (value: number) => void
}): JSX.Element {
  return (
    <div className={`slider ${disabled ? 'is-disabled' : ''}`}>
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
