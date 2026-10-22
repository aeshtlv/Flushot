import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TEXT_SIZE,
  STROKE_WIDTHS,
  TEXT_SIZE,
  TEXT_SIZES,
  snapSegment,
  textWrapWidth,
  wrapText
} from '../src/shared/annotate'

/**
 * A monospace measure: every character is 10 units wide, so the expected line
 * breaks can be written by hand instead of guessed.
 */
const measure = (line: string): number => line.length * 10

describe('wrapText', () => {
  it('keeps a short line on one line', () => {
    expect(wrapText('Готово', 200, measure)).toEqual(['Готово'])
  })

  it('breaks between words, never inside a word', () => {
    const lines = wrapText('Нажмите сюда чтобы продолжить', 130, measure)
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) {
      // Nothing was cut mid-word: every line is made of whole words only.
      expect('Нажмите сюда чтобы продолжить').toContain(line)
    }
    expect(lines.join(' ')).toBe('Нажмите сюда чтобы продолжить')
  })

  it('fills each line as much as it can', () => {
    // "один два" is 8 characters = 80 units, fits in 90; adding "три" would be 120.
    expect(wrapText('один два три четыре', 90, measure)).toEqual(['один два', 'три', 'четыре'])
  })

  it('honours explicit line breaks', () => {
    expect(wrapText('Первая\nВторая', 500, measure)).toEqual(['Первая', 'Вторая'])
  })

  it('keeps empty lines from double breaks', () => {
    expect(wrapText('Первая\n\nТретья', 500, measure)).toEqual(['Первая', '', 'Третья'])
  })

  it('lets a single over-long word overflow instead of splitting it', () => {
    const lines = wrapText('сверхдлинноеслово', 40, measure)
    expect(lines).toEqual(['сверхдлинноеслово'])
  })

  it('collapses runs of spaces instead of emitting empty lines', () => {
    expect(wrapText('раз   два', 500, measure)).toEqual(['раз два'])
  })

  it('survives a zero-width box without looping forever', () => {
    expect(wrapText('раз два', 0, measure)).toEqual(['раз', 'два'])
  })

  it('returns an empty line for empty text', () => {
    expect(wrapText('', 100, measure)).toEqual([''])
  })
})

describe('snapSegment', () => {
  const W = 1920
  const H = 1080

  it('turns a nearly horizontal drag into an exactly horizontal line', () => {
    // Underlining a row of text: 3 px of drift over 400 px must vanish.
    const to = snapSegment({ x: 0.1, y: 0.5 }, { x: 0.1 + 400 / W, y: 0.5 + 3 / H }, W, H)
    expect(to.y).toBeCloseTo(0.5, 6)
    expect(to.x).toBeGreaterThan(0.1 + 399 / W)
  })

  it('turns a nearly vertical drag into an exactly vertical line', () => {
    const to = snapSegment({ x: 0.5, y: 0.2 }, { x: 0.5 + 2 / W, y: 0.2 + 300 / H }, W, H)
    expect(to.x).toBeCloseTo(0.5, 6)
    expect(to.y).toBeGreaterThan(0.2 + 299 / H)
  })

  it('snaps a diagonal drag to 45 degrees on screen, not in normalized units', () => {
    // A 1920×1080 picture: equal normalized offsets are a 30° line on screen.
    const to = snapSegment({ x: 0.5, y: 0.5 }, { x: 0.6, y: 0.6 }, W, H)
    const dx = (to.x - 0.5) * W
    const dy = (to.y - 0.5) * H
    // 0.1 × 1920 = 192 px across, 0.1 × 1080 = 108 px down → 29.4°, snapped to 45°.
    expect(Math.abs(Math.abs(dx) - Math.abs(dy))).toBeLessThan(0.5)
  })

  it('keeps the length, so the line still follows the pointer', () => {
    const from = { x: 0.3, y: 0.4 }
    const raw = { x: 0.3 + 200 / W, y: 0.4 + 7 / H }
    const snapped = snapSegment(from, raw, W, H)
    const before = Math.hypot((raw.x - from.x) * W, (raw.y - from.y) * H)
    const after = Math.hypot((snapped.x - from.x) * W, (snapped.y - from.y) * H)
    // Coordinates are stored with six decimals, so a thousandth of a pixel of
    // drift is expected and invisible; a real shortening would be far larger.
    expect(Math.abs(after - before)).toBeLessThan(0.01)
  })

  it('leaves a click in place instead of inventing a direction', () => {
    const point = { x: 0.25, y: 0.75 }
    expect(snapSegment(point, point, W, H)).toEqual(point)
  })

  it('never pushes the end outside the picture', () => {
    const to = snapSegment({ x: 0.99, y: 0.99 }, { x: 1.4, y: 1.02 }, W, H)
    expect(to.x).toBeLessThanOrEqual(1)
    expect(to.y).toBeLessThanOrEqual(1)
    expect(to.x).toBeGreaterThanOrEqual(0)
    expect(to.y).toBeGreaterThanOrEqual(0)
  })
})

describe('textWrapWidth', () => {
  it('uses the space between the caret and the right edge', () => {
    // 1000 px wide picture, text at 10 % → 900 px minus a 4 % margin of 30 px.
    expect(textWrapWidth(0.1, 1000, 750)).toBe(870)
  })

  it('never returns a uselessly narrow column', () => {
    // Placed at the very right edge: the minimum column still allows a word.
    expect(textWrapWidth(0.99, 1000, 750)).toBe(90)
  })
})

describe('text sizes', () => {
  it('offers four sizes and defaults to the second, larger than the first release', () => {
    expect(TEXT_SIZES.length).toBe(4)
    expect(DEFAULT_TEXT_SIZE).toBe(1)
    expect(TEXT_SIZE).toBe(TEXT_SIZES[DEFAULT_TEXT_SIZE])
    // The old default was 0.035; the new one must be visibly bigger.
    expect(TEXT_SIZE).toBeGreaterThan(0.035)
  })

  it('grows monotonically, so the buttons make sense left to right', () => {
    for (let index = 1; index < TEXT_SIZES.length; index++) {
      expect(TEXT_SIZES[index]).toBeGreaterThan(TEXT_SIZES[index - 1])
    }
    for (let index = 1; index < STROKE_WIDTHS.length; index++) {
      expect(STROKE_WIDTHS[index]).toBeGreaterThan(STROKE_WIDTHS[index - 1])
    }
  })
})
