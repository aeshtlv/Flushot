import { useCallback, useEffect, useRef, useState } from 'react'
import { clamp, normalizeRect } from '../../shared/geometry'
import type { Rect } from '../../shared/types'

export type DragMode = 'create' | 'move' | 'resize' | 'idle'

export type Handle =
  | 'nw'
  | 'n'
  | 'ne'
  | 'e'
  | 'se'
  | 's'
  | 'sw'
  | 'w'

export const MIN_SELECTION = 8

interface PointerState {
  mode: DragMode
  handle?: Handle
  startX: number
  startY: number
  origin: Rect | null
}

function resizeRect(origin: Rect, handle: Handle, dx: number, dy: number, bounds: Rect): Rect {
  let left = origin.x
  let top = origin.y
  let right = origin.x + origin.width
  let bottom = origin.y + origin.height

  if (handle.includes('w')) left += dx
  if (handle.includes('e')) right += dx
  if (handle.includes('n')) top += dy
  if (handle.includes('s')) bottom += dy

  // Keep the rectangle valid when a handle is dragged past the opposite edge.
  if (right - left < MIN_SELECTION) {
    if (handle.includes('w')) left = right - MIN_SELECTION
    else right = left + MIN_SELECTION
  }
  if (bottom - top < MIN_SELECTION) {
    if (handle.includes('n')) top = bottom - MIN_SELECTION
    else bottom = top + MIN_SELECTION
  }

  left = clamp(left, 0, bounds.width - MIN_SELECTION)
  top = clamp(top, 0, bounds.height - MIN_SELECTION)
  right = clamp(right, left + MIN_SELECTION, bounds.width)
  bottom = clamp(bottom, top + MIN_SELECTION, bounds.height)

  return { x: Math.round(left), y: Math.round(top), width: Math.round(right - left), height: Math.round(bottom - top) }
}

function moveRect(origin: Rect, dx: number, dy: number, bounds: Rect): Rect {
  const x = clamp(Math.round(origin.x + dx), 0, Math.max(0, bounds.width - origin.width))
  const y = clamp(Math.round(origin.y + dy), 0, Math.max(0, bounds.height - origin.height))
  return { x, y, width: origin.width, height: origin.height }
}

export interface SelectionState {
  rect: Rect | null
  mode: DragMode
  isDragging: boolean
  beginCreate: (x: number, y: number) => void
  beginMove: (x: number, y: number) => void
  beginResize: (handle: Handle, x: number, y: number) => void
  reset: () => void
  setRect: (rect: Rect | null) => void
}

export function useSelection(bounds: Rect): SelectionState {
  const [rect, setRect] = useState<Rect | null>(null)
  const [mode, setMode] = useState<DragMode>('idle')
  const pointer = useRef<PointerState | null>(null)

  useEffect(() => {
    setRect(null)
    setMode('idle')
    pointer.current = null
  }, [bounds.width, bounds.height])

  const beginCreate = useCallback(
    (x: number, y: number) => {
      const startX = clamp(x, 0, bounds.width)
      const startY = clamp(y, 0, bounds.height)
      pointer.current = { mode: 'create', startX, startY, origin: { x: startX, y: startY, width: 0, height: 0 } }
      setMode('create')
      setRect({ x: Math.round(startX), y: Math.round(startY), width: 0, height: 0 })
    },
    [bounds.width, bounds.height]
  )

  const beginMove = useCallback(
    (x: number, y: number) => {
      if (!rect) return
      pointer.current = { mode: 'move', startX: x, startY: y, origin: rect }
      setMode('move')
    },
    [rect]
  )

  const beginResize = useCallback(
    (handle: Handle, x: number, y: number) => {
      if (!rect) return
      pointer.current = { mode: 'resize', handle, startX: x, startY: y, origin: rect }
      setMode('resize')
    },
    [rect]
  )

  useEffect(() => {
    const onMove = (event: PointerEvent): void => {
      const state = pointer.current
      if (!state) return
      const x = clamp(event.clientX, 0, bounds.width)
      const y = clamp(event.clientY, 0, bounds.height)

      if (state.mode === 'create') {
        const next = normalizeRect({ x: state.startX, y: state.startY }, { x, y })
        setRect({
          x: Math.round(clamp(next.x, 0, bounds.width)),
          y: Math.round(clamp(next.y, 0, bounds.height)),
          width: Math.round(Math.min(next.width, bounds.width)),
          height: Math.round(Math.min(next.height, bounds.height))
        })
      } else if (state.mode === 'move' && state.origin) {
        setRect(moveRect(state.origin, x - state.startX, y - state.startY, bounds))
      } else if (state.mode === 'resize' && state.origin && state.handle) {
        setRect(resizeRect(state.origin, state.handle, x - state.startX, y - state.startY, bounds))
      }
    }

    const onUp = (): void => {
      const state = pointer.current
      if (!state) return
      pointer.current = null
      setMode('idle')
      if (state.mode === 'create') {
        setRect((current) => {
          if (!current || current.width < MIN_SELECTION || current.height < MIN_SELECTION) return null
          return current
        })
      }
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [bounds])

  const reset = useCallback(() => {
    pointer.current = null
    setMode('idle')
    setRect(null)
  }, [])

  return {
    rect,
    mode,
    isDragging: mode !== 'idle',
    beginCreate,
    beginMove,
    beginResize,
    reset,
    setRect
  }
}
