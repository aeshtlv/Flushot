import { describe, expect, it } from 'vitest'
import { translateAnnotation } from '../src/shared/annotate'
import type { Annotation } from '../src/shared/types'

describe('moving annotations', () => {
  it('moves a caption without changing its text or size', () => {
    const caption: Annotation = { tool: 'text', color: '#FF3B30', width: 0.004, at: { x: 0.1, y: 0.2 }, text: 'Привет', size: 0.05 }
    const moved = translateAnnotation(caption, 0.3, 0.4)
    expect(moved).toEqual({ ...caption, at: { x: 0.4, y: 0.6 } })
  })

  it('moves both ends of an arrow, so the shape keeps its direction', () => {
    const arrow: Annotation = { tool: 'arrow', color: '#000000', width: 0.004, from: { x: 0.1, y: 0.1 }, to: { x: 0.2, y: 0.2 } }
    const moved = translateAnnotation(arrow, 0.1, 0.1)
    expect(moved).toMatchObject({ from: { x: 0.2, y: 0.2 }, to: { x: 0.3, y: 0.3 } })
  })

  it('moves a step badge and keeps its number', () => {
    const badge: Annotation = { tool: 'step', color: '#0A84FF', width: 0.004, at: { x: 0.5, y: 0.5 }, size: 0.05, number: 7 }
    const moved = translateAnnotation(badge, -0.1, 0)
    expect(moved).toMatchObject({ at: { x: 0.4, y: 0.5 }, number: 7 })
  })

  it('moves every point of a pen stroke', () => {
    const stroke: Annotation = {
      tool: 'pen',
      color: '#000000',
      width: 0.004,
      points: [
        { x: 0.1, y: 0.1 },
        { x: 0.2, y: 0.15 }
      ]
    }
    const moved = translateAnnotation(stroke, 0.05, 0.05)
    expect(moved).toMatchObject({
      points: [
        { x: 0.15, y: 0.15 },
        { x: 0.25, y: 0.2 }
      ]
    })
  })

  it('moves a blur patch like a rectangle', () => {
    const patch: Annotation = { tool: 'blur', from: { x: 0.1, y: 0.1 }, to: { x: 0.3, y: 0.3 }, mode: 'pixelate' }
    expect(translateAnnotation(patch, 0.1, 0)).toMatchObject({
      from: { x: 0.2, y: 0.1 },
      to: { x: 0.4, y: 0.3 },
      mode: 'pixelate'
    })
  })

  it('stops at the picture edge instead of pushing the shape off-canvas', () => {
    const caption: Annotation = { tool: 'text', color: '#000000', width: 0.004, at: { x: 0.9, y: 0.9 }, text: 'x', size: 0.05 }
    const moved = translateAnnotation(caption, 0.5, 0.5)
    expect(moved).toMatchObject({ at: { x: 1, y: 1 } })

    const back = translateAnnotation(caption, -5, -5)
    expect(back).toMatchObject({ at: { x: 0, y: 0 } })
  })

  it('is reversible: moving by d and back returns the original coordinates', () => {
    const caption: Annotation = { tool: 'text', color: '#000000', width: 0.004, at: { x: 0.4, y: 0.5 }, text: 'x', size: 0.05 }
    const there = translateAnnotation(caption, 0.2, -0.2)
    const back = translateAnnotation(there, -0.2, 0.2)
    expect(back).toMatchObject({ at: { x: 0.4, y: 0.5 } })
  })
})
