import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { pluralForm, resolveLanguage, t, type LanguagePreference, type MessageKey } from '../../shared/i18n'
import type { OcrOutcome, OcrRegion } from '../../shared/types'
import { CloseIcon, CopyIcon, TextScanIcon } from './icons'

type State = (
  | { status: 'loading' }
  | { status: 'ready'; outcome: OcrOutcome }
  | { status: 'failed'; message: string }
) & {
  /** The fragment that was read; absent when the whole picture was read. */
  region?: OcrRegion
}

export interface TextPanelProps {
  state: State
  /** Copy the recognized text; resolves to the message to show. */
  onCopy: (text: string) => Promise<string>
  onClose: () => void
  /** Ask again, for when the first attempt failed. */
  onRetry: () => void
  /**
   * Saved interface language preference.
   *
   * Passed in rather than read from a context: this panel is the one component
   * that would otherwise need its own provider, and one prop is cheaper than a
   * provider that exists for a single consumer.
   */
  language: LanguagePreference | undefined
}

/**
 * The recognized text, shown next to the picture, and **editable**.
 *
 * Deliberately a panel rather than a dialog: the user wants to compare the text
 * with the screenshot behind it, and a modal would cover exactly what they are
 * checking against.
 *
 * It is an editor, not a read-only view, because recognition is not perfect and
 * never will be: both Windows engines read `Папка` as `Палка` at 11 px and agree on
 * it, so no amount of merging can catch that. What the app *can* do is make the
 * correction take one click — the user sees the wrong word next to the picture,
 * fixes it in place, and copies the corrected text. A read-only panel forced them to
 * paste into another program first, which is the moment the feature stops being
 * worth using.
 */
export function TextPanel({ state, onCopy, onClose, onRetry, language }: TextPanelProps): JSX.Element {
  const [copied, setCopied] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const editorRef = useRef<HTMLTextAreaElement>(null)
  /** Result already focused and selected, so a keystroke never re-selects. */
  const selectedFor = useRef<string | null>(null)

  const lang = resolveLanguage(language, navigator.language)
  const tr = useCallback(
    (key: MessageKey, vars?: Record<string, string | number>) => t(lang, key, vars),
    [lang]
  )

  const outcome = state.status === 'ready' ? state.outcome : null
  const original = outcome?.text ?? ''
  const edited = state.status === 'ready' && draft !== original

  // A new result starts from what the engine said, never from the previous edit.
  useEffect(() => {
    if (!outcome) return
    setDraft(outcome.text ?? '')
    setCopied(null)
  }, [outcome])

  useEffect(() => {
    if (state.status !== 'ready' || draft === '') return
    // Focus and select everything once per result: the most likely next action is
    // "copy this", and a selection makes it one Ctrl+C. It is a textarea, so a click
    // anywhere puts the caret where the user wants to fix a word.
    //
    // Guarded by `selectedFor` because this effect also runs on every keystroke —
    // without the guard, typing one letter would select the whole text again and the
    // next letter would replace it.
    if (selectedFor.current === original) return
    const node = editorRef.current
    if (!node) return
    selectedFor.current = original
    node.focus({ preventScroll: true })
    node.setSelectionRange(0, node.value.length)
  }, [draft, original, state.status])

  const copy = useCallback(async () => {
    if (state.status !== 'ready') return
    // Copy what is on screen, including the user's corrections — that is the whole
    // point of editing it here.
    setCopied(await onCopy(draft))
    window.setTimeout(() => setCopied(null), 2200)
  }, [draft, onCopy, state.status])

  const revert = useCallback(() => {
    setDraft(original)
    const node = editorRef.current
    if (node) {
      node.focus({ preventScroll: true })
      node.setSelectionRange(0, node.value.length)
    }
  }, [original])

  const meta = useMemo(() => {
    if (state.status !== 'ready') return ''
    if (state.outcome.lines.length === 0) return t(lang, 'text.nothing')
    const count = state.outcome.lines.length
    // The counted noun goes through the shared plural rule: three forms in
    // Russian, two in English, and "1 строк" reads as a bug in either.
    const words = t(lang, `text.lines.${pluralForm(lang, count)}`, { count })
    const engines = languagesLabel(state.outcome)
    return engines ? `${words} · ${engines}` : words
  }, [lang, state])

  return (
    <div className="text-panel" data-text-panel={state.status} onPointerDown={(event) => event.stopPropagation()}>
      <header className="text-panel__head">
        <TextScanIcon />
        <span className="text-panel__title">
          {state.region ? tr('text.fragmentTitle') : tr('text.shotTitle')}
        </span>
        {state.status === 'ready' && (
          <span className="text-panel__meta">
            {edited && <span className="text-panel__edited">{tr('text.edited')}</span>}
            <span className="text-panel__summary">{meta}</span>
          </span>
        )}
        <button
          className="tb tb--close"
          onClick={onClose}
          title={tr('text.closeTitle')}
          aria-label={tr('text.closePanel')}
        >
          <CloseIcon />
        </button>
      </header>

      {state.status === 'loading' && (
        <div className="text-panel__body text-panel__body--note">
          <span className="spinner" />
          {tr('text.working')}
        </div>
      )}

      {state.status === 'failed' && (
        <div className="text-panel__body text-panel__body--note">
          <p className="text-panel__error">{state.message}</p>
          <button className="tb tb--primary" onClick={onRetry}>
            {tr('text.retry')}
          </button>
        </div>
      )}

      {state.status === 'ready' &&
        (state.outcome.lines.length === 0 ? (
          <div className="text-panel__body text-panel__body--note">{tr('text.empty')}</div>
        ) : (
          <>
            <textarea
              className="text-panel__body text-panel__editor"
              ref={editorRef}
              value={draft}
              // Enough rows to show the whole result without scrolling for the
              // common case, capped so a page of text does not push the buttons
              // out of the panel. The panel's own max-height takes over beyond that.
              rows={Math.min(18, Math.max(3, draft.split('\n').length))}
              onChange={(event) => setDraft(event.target.value)}
              // No spellcheck: a code line or a path is not a misspelling, and the
              // red squiggles over `app.getPath` look like recognition errors.
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              aria-label={tr('text.editable')}
              data-ocr-editor
            />
            <footer className="text-panel__foot">
              <button className="tb tb--primary" onClick={() => void copy()} data-ocr-copy>
                <CopyIcon />
                {copied ?? tr(edited ? 'text.copyEdited' : 'text.copy')}
              </button>
              {edited && (
                <button className="tb" onClick={revert} title={tr('text.revert')}>
                  {tr('text.revertShort')}
                </button>
              )}
              <span className="text-panel__hint">{tr(edited ? 'text.canEdit' : 'text.editHint')}</span>
            </footer>
          </>
        ))}
    </div>
  )
}

/**
 * Which engines contributed, e.g. `ru` or `ru+en-US`.
 *
 * Shown because a mixed screenshot is read by more than one engine, and "why does
 * it say ru and en-US" deserves an answer on screen rather than in a document.
 */
function languagesLabel(outcome: OcrOutcome): string {
  const langs = outcome.languages ?? (outcome.lang ? [outcome.lang] : [])
  return langs.join('+')
}
