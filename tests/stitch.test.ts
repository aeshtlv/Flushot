import { describe, expect, it } from 'vitest'
import { buildVirtualFrame } from '../src/main/capture/virtualFrame'

/** A monitor's frozen pixels: one solid colour, so placement is easy to verify. */
function monitor(id: string, width: number, height: number, colour: [number, number, number, number]) {
  const data = new Uint8Array(width * height * 4)
  for (let index = 0; index < data.length; index += 4) {
    data[index] = colour[0]
    data[index + 1] = colour[1]
    data[index + 2] = colour[2]
    data[index + 3] = colour[3]
  }
  return { id, raw: { data, width, height } }
}

function pixelAt(frame: { data: Uint8Array; width: number }, x: number, y: number): [number, number, number, number] {
  const index = (y * frame.width + x) * 4
  return [frame.data[index], frame.data[index + 1], frame.data[index + 2], frame.data[index + 3]]
}

describe('buildVirtualFrame', () => {
  it('returns a single monitor untouched, without resampling', async () => {
    const only = monitor('a', 40, 30, [10, 20, 30, 255])
    const frame = await buildVirtualFrame([
      { id: 'a', bounds: { x: 0, y: 0, width: 40, height: 30 }, scaleFactor: 1, raw: only.raw }
    ])

    expect(frame.width).toBe(40)
    expect(frame.height).toBe(30)
    expect(frame.resampled).toEqual([])
    // The very same buffer: no copy, no re-encode, no chance of a pixel changing.
    expect(frame.data).toBe(only.raw.data)
  })

  it('places side-by-side monitors at their own offsets', async () => {
    const left = monitor('left', 20, 10, [255, 0, 0, 255])
    const right = monitor('right', 20, 10, [0, 0, 255, 255])

    const frame = await buildVirtualFrame([
      { id: 'left', bounds: { x: 0, y: 0, width: 20, height: 10 }, scaleFactor: 1, raw: left.raw },
      { id: 'right', bounds: { x: 20, y: 0, width: 20, height: 10 }, scaleFactor: 1, raw: right.raw }
    ])

    expect(frame.width).toBe(40)
    expect(frame.height).toBe(10)
    expect(pixelAt(frame, 0, 0)).toEqual([255, 0, 0, 255])
    expect(pixelAt(frame, 19, 9)).toEqual([255, 0, 0, 255])
    expect(pixelAt(frame, 20, 0)).toEqual([0, 0, 255, 255])
    expect(pixelAt(frame, 39, 9)).toEqual([0, 0, 255, 255])
  })

  it('places a monitor that sits above and to the left of the origin', async () => {
    // Negative coordinates are normal: Windows puts the secondary screen above
    // the primary in many setups, so the union starts at a negative y.
    const primary = monitor('primary', 20, 10, [0, 255, 0, 255])
    const upper = monitor('upper', 20, 10, [255, 255, 0, 255])

    const frame = await buildVirtualFrame([
      { id: 'primary', bounds: { x: 0, y: 0, width: 20, height: 10 }, scaleFactor: 1, raw: primary.raw },
      { id: 'upper', bounds: { x: 0, y: -10, width: 20, height: 10 }, scaleFactor: 1, raw: upper.raw }
    ])

    expect(frame.height).toBe(20)
    expect(pixelAt(frame, 0, 0)).toEqual([255, 255, 0, 255])
    expect(pixelAt(frame, 0, 10)).toEqual([0, 255, 0, 255])
  })

  it('fills the gap between offset monitors with opaque black', async () => {
    // Two 20-wide screens, the lower one shifted right: the union is wider than
    // either, and the uncovered strip must not be transparent.
    const left = monitor('left', 20, 10, [255, 0, 0, 255])
    const lower = monitor('lower', 20, 10, [0, 0, 255, 255])

    const frame = await buildVirtualFrame([
      { id: 'left', bounds: { x: 0, y: 0, width: 20, height: 10 }, scaleFactor: 1, raw: left.raw },
      { id: 'lower', bounds: { x: 10, y: 10, width: 20, height: 10 }, scaleFactor: 1, raw: lower.raw }
    ])

    // The bottom-right corner of the upper row is not covered by any monitor.
    expect(pixelAt(frame, 25, 5)).toEqual([0, 0, 0, 255])
  })

  it('keeps the sharpest monitor pixel-exact and resamples only the other one', async () => {
    const sharp2x = monitor('2x', 40, 20, [1, 2, 3, 255])
    const normal = monitor('1x', 20, 10, [9, 9, 9, 255])

    const frame = await buildVirtualFrame([
      { id: '2x', bounds: { x: 0, y: 0, width: 20, height: 10 }, scaleFactor: 2, raw: sharp2x.raw },
      { id: '1x', bounds: { x: 20, y: 0, width: 20, height: 10 }, scaleFactor: 1, raw: normal.raw }
    ])

    expect(frame.scale).toBe(2)
    // The composite is built at the highest density present, so the 2x screen
    // keeps all of its pixels and the 1x screen is scaled up to match.
    expect(frame.width).toBe(80)
    expect(frame.height).toBe(20)
    expect(frame.resampled).toEqual(['1x'])
    expect(pixelAt(frame, 0, 0)).toEqual([1, 2, 3, 255])
    expect(pixelAt(frame, 39, 19)).toEqual([1, 2, 3, 255])
  })

  it('refuses an empty display list instead of dividing by zero', async () => {
    await expect(buildVirtualFrame([])).rejects.toThrow()
  })

  it('turns a portrait monitor upright instead of stretching it into a landscape slot', async () => {
    // The defect this guards: a 1080 × 1920 screen whose capture arrived as
    // 1920 × 1080 was resized into a 1080 × 1920 box, so every pixel was squashed
    // and the saved picture looked skewed.
    const portrait = monitor('portrait', 1920, 1080, [200, 40, 40, 255])

    const frame = await buildVirtualFrame([
      {
        id: 'portrait',
        bounds: { x: 0, y: 0, width: 1080, height: 1920 },
        scaleFactor: 1,
        raw: portrait.raw,
        rotation: 90
      }
    ])

    // A single monitor is returned as-is, so the frame keeps the capture's own
    // shape — the turn happens where the picture is assembled, not here.
    expect(frame.width).toBe(1920)
    expect(frame.height).toBe(1080)
  })

  it('never stretches a bitmap whose shape disagrees with its slot', async () => {
    // A 30 × 40 capture inside a 20 × 40 slot is not a rotated monitor (turning
    // it would make it worse), so it has to be fitted rather than squashed. The
    // old `fit: 'fill'` stretched it to 20 × 40 and distorted everything on it.
    const odd = monitor('odd', 30, 40, [0, 200, 0, 255])
    const normal = monitor('normal', 20, 10, [9, 9, 9, 255])

    const frame = await buildVirtualFrame([
      { id: 'odd', bounds: { x: 0, y: 0, width: 20, height: 40 }, scaleFactor: 1, raw: odd.raw },
      { id: 'normal', bounds: { x: 20, y: 0, width: 20, height: 10 }, scaleFactor: 1, raw: normal.raw }
    ])

    expect(frame.width).toBe(40)
    expect(frame.height).toBe(40)
    // Fitted, not stretched: the bands above and below the picture stay black.
    expect(pixelAt(frame, 5, 1)).toEqual([0, 0, 0, 255])
    expect(pixelAt(frame, 5, 38)).toEqual([0, 0, 0, 255])
    // The picture itself is still there, in the middle of the slot.
    expect(pixelAt(frame, 5, 20)).toEqual([0, 200, 0, 255])
  })
})
