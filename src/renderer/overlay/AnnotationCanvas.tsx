import { useCallback, useEffect, useRef, useState, type JSX, type PointerEvent as ReactPointerEvent } from 'react'
import { pointOf, snapSegment, textWrapWidth, translateAnnotation } from '../../shared/annotate'
import type { Annotation, AnnotationTool, Point, TextAnnotation } from '../../shared/types'
import { drawAll, drawAnnotation, findAnnotation, findTextAnnotation, type SourceBox } from './annotate'

export interface AnnotationCanvasProps {
  /** Picture size in output pixels; the canvas is exactly this big. */
  width: number
  height: number
  annotations: Annotation[]
  tool: AnnotationTool
  color: string
  stroke: number
  /** Text size as a fraction of the shorter side. */
  textSize: number
  /** Number the next step badge will carry. */
  stepNumber: number
  /** Frozen screenshot and the picture's position inside it. */
  source: SourceBox | null
  onCommit: (annotation: Annotation) => void
  onRemove: (index: number) => void
  canvasRef: React.RefObject<HTMLCanvasElement | null>
}

/**
 * What the inline text editor is working on.
 *
 * `original` is the annotation being edited, if any: it is taken out of the list
 * while the editor is open (so it does not show through the textarea) and put
 * back untouched if the user cancels.
 */
interface TextDraft {
  at: Point
  value: string
  size: number
  color: string
  original: TextAnnotation | null
}

/**
 * The drawing surface.
 *
 * It sits on top of the picture inside the result card and is backed by a
 * canvas at the picture's own pixel size, so the preview and the exported layer
 * are the same raster: no re-rendering, no softening, no font substitution.
 */
export function AnnotationCanvas({
  width,
  height,
  annotations,
  tool,
  color,
  stroke,
  textSize,
  stepNumber,
  source,
  onCommit,
  onRemove,
  canvasRef
}: AnnotationCanvasProps): JSX.Element {
  const [draft, setDraft] = useState<Annotation | null>(null)
  const [text, setText] = useState<TextDraft | null>(null)
  const drawing = useRef(false)
  /**
   * Mirror of `draft` for the pointer handlers.
   *
   * Reading state inside `setDraft`'s updater and committing from there would put
   * a side effect in a function React may call twice (StrictMode), which appended
   * duplicate annotations. The ref is the single source of truth while a drag is
   * in progress; the state exists only to trigger a repaint.
   */
  const draftRef = useRef<Annotation | null>(null)
  /** The annotation being dragged by the move tool, with the grab point. */
  const moving = useRef<{ original: Annotation; start: Point } | null>(null)
  /**
   * The editor can be closed by Enter, Escape and blur at once (unmounting a
   * focused textarea fires blur), so the first decision wins and the rest are
   * ignored. Without this, one Escape would restore the caption twice.
   */
  const settled = useRef(false)

  const setDraftBoth = (next: Annotation | null): void => {
    draftRef.current = next
    setDraft(next)
  }

  const openEditor = (draftText: TextDraft): void => {
    settled.current = false
    setText(draftText)
  }

  const emptySource: SourceBox = { canvas: document.createElement('canvas'), x: 0, y: 0, width: 1, height: 1 }

  // Repaint whenever the committed list or the in-progress shape changes. The
  // whole layer is redrawn, which keeps pen strokes and undo trivially correct.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
    const context = canvas.getContext('2d')
    if (!context) return
    drawAll(context, annotations, width, height, source ?? emptySource)
    if (draft) drawAnnotation(context, draft, width, height, source ?? emptySource)
  }, [annotations, draft, width, height, source, canvasRef])

  const localPoint = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>): Point => {
      const rect = event.currentTarget.getBoundingClientRect()
      return pointOf(event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height)
    },
    []
  )

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (event.button !== 0) return
    event.stopPropagation()
    event.preventDefault()
    const point = localPoint(event)

    if (tool === 'text') {
      // Clicking an existing caption reopens it instead of stacking a new empty
      // editor on top: the saved text is carried into the field as-is, so its
      // wrapping stays exactly the same.
      const hit = findTextAnnotation(annotations, point, width, height)
      if (hit !== null) {
        const existing = annotations[hit]
        if (existing.tool === 'text') {
          onRemove(hit)
          openEditor({ at: existing.at, value: existing.text, size: existing.size, color: existing.color, original: existing })
          return
        }
      }
      openEditor({ at: point, value: '', size: textSize, color, original: null })
      return
    }

    if (tool === 'step') {
      // A badge is placed with a single click; there is nothing to drag.
      onCommit({ tool: 'step', color, width: stroke, at: point, size: textSize, number: stepNumber })
      return
    }

    if (tool === 'move') {
      // Pick up whatever is under the pointer and drag it. The annotation is
      // taken out of the list while it moves, so it is drawn once, on top, and
      // put back at the drop position — which also makes it the newest item.
      const hit = findAnnotation(annotations, point, width, height)
      if (hit === null) return
      const picked = annotations[hit]
      onRemove(hit)
      moving.current = { original: picked, start: point }
      setDraftBoth(picked)
      event.currentTarget.setPointerCapture(event.pointerId)
      drawing.current = true
      return
    }

    event.currentTarget.setPointerCapture(event.pointerId)
    drawing.current = true

    if (tool === 'pen') {
      setDraftBoth({ tool: 'pen', color, width: stroke, points: [point] })
    } else if (tool === 'blur') {
      setDraftBoth({ tool: 'blur', from: point, to: point, mode: 'blur' })
    } else if (tool === 'rect') {
      setDraftBoth({ tool: 'rect', color, width: stroke, from: point, to: point })
    } else if (tool === 'line') {
      setDraftBoth({ tool: 'line', color, width: stroke, from: point, to: point })
    } else {
      setDraftBoth({ tool: 'arrow', color, width: stroke, from: point, to: point })
    }
  }

  /**
   * Extend the in-progress shape to a point.
   *
   * Kept separate from the pointer handler so it can be driven by the animation
   * frame instead of the event: a 1000 Hz mouse fires far more move events than
   * the screen refreshes, and every one of them used to clear and redraw the
   * whole layer. Coalescing turns that into one repaint per frame.
   *
   * `snap` comes from the Shift key: the line tool uses it to keep the segment
   * exactly horizontal, vertical or diagonal, which is what makes it usable for
   * underlining a row of text.
   */
  const extendTo = (point: Point, snap = false): void => {
    const current = draftRef.current
    if (!current) return

    const picked = moving.current
    if (picked) {
      setDraftBoth(translateAnnotation(picked.original, point.x - picked.start.x, point.y - picked.start.y))
      return
    }

    if (current.tool === 'pen') {
      setDraftBoth({ ...current, points: [...current.points, point] })
      return
    }
    // Text and step badges are placed with a click and never dragged out.
    if (current.tool === 'text' || current.tool === 'step') return
    if (current.tool === 'line') {
      setDraftBoth({ ...current, to: snap ? snapSegment(current.from, point, width, height) : point })
      return
    }
    setDraftBoth({ ...current, to: point })
  }

  /** Latest pointer position waiting for the next frame. */
  const pendingMove = useRef<{ point: Point; snap: boolean } | null>(null)
  const frameRequest = useRef(0)

  const flushPending = (): void => {
    if (frameRequest.current) {
      cancelAnimationFrame(frameRequest.current)
      frameRequest.current = 0
    }
    const move = pendingMove.current
    pendingMove.current = null
    if (move) extendTo(move.point, move.snap)
  }

  useEffect(() => {
    return () => {
      if (frameRequest.current) cancelAnimationFrame(frameRequest.current)
      frameRequest.current = 0
    }
  }, [])

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (!drawing.current) return
    // The rectangle is read here, while the event is still live; the point itself
    // is applied once, on the next frame.
    pendingMove.current = { point: localPoint(event), snap: event.shiftKey }
    if (frameRequest.current) return
    frameRequest.current = requestAnimationFrame(() => {
      frameRequest.current = 0
      const move = pendingMove.current
      pendingMove.current = null
      if (move) extendTo(move.point, move.snap)
    })
  }

  const finish = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (!drawing.current) return
    // The last movement must land before the shape is committed, or a quick
    // flick would end one frame short of where the pointer actually stopped.
    flushPending()
    drawing.current = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    const current = draftRef.current
    moving.current = null
    setDraftBoth(null)
    if (current) onCommit(current)
  }

  const commitText = (): void => {
    if (!text || settled.current) return
    settled.current = true
    const value = text.value.trim()
    if (value) {
      onCommit({ tool: 'text', color: text.color, width: stroke, at: text.at, text: value, size: text.size })
    }
    setText(null)
  }

  /** Escape restores the caption that was opened for editing, verbatim. */
  const cancelText = (): void => {
    if (!text || settled.current) return
    settled.current = true
    if (text.original) onCommit(text.original)
    setText(null)
  }

  return (
    <>
      <canvas
        ref={canvasRef}
        className={`annotate-surface annotate-surface--${tool}`}
        width={width}
        height={height}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
      />

      {text && (
        <textarea
          className="annotate-text"
          autoFocus
          rows={Math.min(12, Math.max(1, text.value.split('\n').length))}
          value={text.value}
          placeholder="Текст · Enter — готово, Shift+Enter — новая строка"
          spellCheck={false}
          style={{
            left: `${text.at.x * 100}%`,
            top: `${text.at.y * 100}%`,
            color: text.color,
            // Same width the renderer will wrap at, so the line breaks the user
            // sees while typing are the line breaks that end up in the file.
            width: `${(textWrapWidth(text.at.x, width, height) / width) * 100}%`,
            // The editor never grows past the bottom of the picture. A dozen
            // Shift+Enter presses used to make it taller than the picture, which
            // pushed the whole result column up and hid the toolbars.
            maxHeight: `${Math.max(8, (1 - text.at.y) * 100)}%`,
            // The input mirrors the size the text will have in the output.
            fontSize: `max(12px, ${(text.size * Math.min(width, height) * 100) / width}cqw)`
          }}
          onChange={(event) => setText({ ...text, value: event.target.value })}
          onKeyDown={(event) => {
            event.stopPropagation()
            // Enter confirms, Shift+Enter inserts a line break: wrapping is
            // automatic, so the user only presses Shift when they want a hard
            // break of their own.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              commitText()
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              cancelText()
            }
          }}
          onBlur={commitText}
          onPointerDown={(event) => event.stopPropagation()}
        />
      )}
    </>
  )
}
