import { describe, expect, it } from 'vitest'
import { quarterTurnsFor, rotateBitmap, uprightBitmap } from '../src/main/capture/orientation'
import { cropFromMonitors, type MonitorSource } from '../src/main/capture/nativeCrop'
import { planNativeCrop } from '../src/shared/virtualScreen'

/**
 * A bitmap where every pixel encodes its own coordinates, so a rotation can be
 * checked exactly instead of by eye: red is x, green is y.
 */
function coordinateBitmap(width: number, height: number): { data: Uint8Array; width: number; height: number } {
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4
      data[index] = x
      data[index + 1] = y
      data[index + 2] = 7
      data[index + 3] = 255
    }
  }
  return { data, width, height }
}

function at(bitmap: { data: Uint8Array; width: number }, x: number, y: number): [number, number, number, number] {
  const index = (y * bitmap.width + x) * 4
  return [bitmap.data[index], bitmap.data[index + 1], bitmap.data[index + 2], bitmap.data[index + 3]]
}

describe('orientation — turning a sideways capture upright', () => {
  it('turns nothing when the capture already matches the desktop', () => {
    expect(quarterTurnsFor(0, { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, imageWidth: 1920, imageHeight: 1080 })).toBe(0)
    // A 150 % screen: the shape agrees even though the size is larger.
    expect(quarterTurnsFor(0, { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, imageWidth: 2880, imageHeight: 1620 })).toBe(0)
  })

  it('turns a capture that came back transposed, whatever the reported rotation', () => {
    // The bug that produced skewed screenshots: the portrait monitor's own
    // capture arrives transposed while Windows still reports rotation 0. The
    // shape decides that a turn is needed; the flag only picks the direction.
    const sideways = { bounds: { x: 0, y: 0, width: 1080, height: 1920 }, imageWidth: 1920, imageHeight: 1080 }
    expect(quarterTurnsFor(0, sideways)).toBe(1)
    expect(quarterTurnsFor(90, sideways)).toBe(1)
    expect(quarterTurnsFor(270, sideways)).toBe(3)
    // 180° would leave the bitmap transposed, so it is never the answer here.
    expect(quarterTurnsFor(180, sideways)).toBe(1)
  })

  it('never turns a capture whose shape already matches the desktop', () => {
    // This is the important guarantee: a correct picture must not be touched,
    // even when Windows reports a rotation for the display. A portrait panel that
    // came back upright already has a portrait bitmap, so turning it again would
    // lay the whole screen on its side.
    const landscape = { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, imageWidth: 1920, imageHeight: 1080 }
    const portrait = { bounds: { x: 0, y: 0, width: 1080, height: 1920 }, imageWidth: 1080, imageHeight: 1920 }
    for (const rotation of [0, 90, 180, 270, 45, undefined]) {
      expect(quarterTurnsFor(rotation, landscape)).toBe(0)
      expect(quarterTurnsFor(rotation, portrait)).toBe(0)
    }
  })

  it('rotates pixels clockwise by 90° without losing any', () => {
    const source = coordinateBitmap(4, 3)
    const turned = rotateBitmap(source, 1)

    expect(turned.width).toBe(3)
    expect(turned.height).toBe(4)
    // Top-left of the original becomes top-right of the result.
    expect(at(turned, 2, 0).slice(0, 2)).toEqual([0, 0])
    // The pixel that was at (3, 0) is now at (2, 3).
    expect(at(turned, 2, 3).slice(0, 2)).toEqual([3, 0])
    // The pixel that was at (0, 2) is now at (0, 0).
    expect(at(turned, 0, 0).slice(0, 2)).toEqual([0, 2])
  })

  it('rotates by 180° and 270° consistently with the 90° case', () => {
    const source = coordinateBitmap(4, 3)
    const twice = rotateBitmap(source, 2)
    const fourTimes = rotateBitmap(rotateBitmap(source, 2), 2)

    expect(twice.width).toBe(4)
    expect(at(twice, 3, 2).slice(0, 2)).toEqual([0, 0])
    expect(at(twice, 0, 0).slice(0, 2)).toEqual([3, 2])
    // Four quarter turns are the identity: no pixels drift.
    expect(fourTimes.data).toEqual(source.data)

    const three = rotateBitmap(source, 3)
    expect(three.width).toBe(3)
    expect(three.height).toBe(4)
    expect(at(three, 0, 3).slice(0, 2)).toEqual([0, 0])
  })

  it('returns the same buffer when nothing has to be turned', () => {
    const source = coordinateBitmap(5, 5)
    const result = uprightBitmap(source, { bounds: { x: 0, y: 0, width: 5, height: 5 }, rotation: 0 })
    // Not a copy: the common case must not pay for one.
    expect(result.data).toBe(source.data)
  })

  it('turns a portrait monitor into a portrait bitmap', () => {
    // A 1920 × 1080 capture for a screen that is really 1080 × 1920.
    const source = coordinateBitmap(1920, 1080)
    const upright = uprightBitmap(source, {
      bounds: { x: 0, y: 0, width: 1080, height: 1920 },
      rotation: 0
    })
    expect(upright.width).toBe(1080)
    expect(upright.height).toBe(1920)
    // Nothing is lost in the turn: the same number of pixels, all opaque.
    expect(upright.data.length).toBe(source.data.length)
    expect(at(upright, 0, 0)[3]).toBe(255)
  })
})

/** One monitor's pixels in BGRA, the order Electron hands them over in. */
function bgraMonitor(
  id: string,
  width: number,
  height: number,
  colour: [number, number, number],
  bounds: { x: number; y: number; width: number; height: number },
  rotation = 0
): MonitorSource {
  const data = new Uint8Array(width * height * 4)
  for (let index = 0; index < data.length; index += 4) {
    // Deliberately swapped: blue in the red slot, so a missing channel swap is
    // visible in the result instead of passing silently.
    data[index] = colour[2]
    data[index + 1] = colour[1]
    data[index + 2] = colour[0]
    data[index + 3] = 255
  }
  return { id, bitmap: { data, width, height }, bounds, rotation }
}

describe('nativeCrop — assembling a selection from the monitors themselves', () => {
  it('copies one monitor pixel for pixel and fixes the channel order', async () => {
    const monitor = bgraMonitor('a', 100, 80, [10, 200, 30], { x: 0, y: 0, width: 100, height: 80 })
    const plan = planNativeCrop({ x: 10, y: 20, width: 40, height: 30 }, [
      { id: 'a', bounds: monitor.bounds, scaleFactor: 1, imageWidth: 100, imageHeight: 80, rotation: 0 }
    ])
    const result = await cropFromMonitors([monitor], plan)

    expect(result.width).toBe(40)
    expect(result.height).toBe(30)
    // RGBA, not BGRA: the red channel really is 10.
    expect(Array.from(result.data.slice(0, 4))).toEqual([10, 200, 30, 255])
    expect(plan.parts[0].resampled).toBe(false)
  })

  it('never upscales a 100 % monitor on a mixed-DPI desk', async () => {
    // The defect: the composite was built at the sharpest density, so a selection
    // on the 100 % screen was cropped out of an upscaled copy of it.
    const normal = bgraMonitor('1x', 100, 100, [255, 0, 0], { x: 0, y: 0, width: 100, height: 100 })
    const retina = bgraMonitor('2x', 200, 200, [0, 0, 255], { x: 100, y: 0, width: 100, height: 100 })
    const monitors = [
      { id: '1x', bounds: normal.bounds, scaleFactor: 1, imageWidth: 100, imageHeight: 100, rotation: 0 },
      { id: '2x', bounds: retina.bounds, scaleFactor: 2, imageWidth: 200, imageHeight: 200, rotation: 0 }
    ]

    const onNormal = planNativeCrop({ x: 20, y: 20, width: 50, height: 40 }, monitors)
    expect(onNormal.width).toBe(50)
    expect(onNormal.height).toBe(40)
    expect(onNormal.density).toBe(1)
    expect(onNormal.parts.every((part) => !part.resampled)).toBe(true)

    const onRetina = planNativeCrop({ x: 120, y: 20, width: 50, height: 40 }, monitors)
    expect(onRetina.width).toBe(100)
    expect(onRetina.height).toBe(80)
    expect(onRetina.density).toBe(2)
    expect(onRetina.parts.every((part) => !part.resampled)).toBe(true)
  })

  it('tiles a selection that crosses the seam without a gap or an overlap', async () => {
    const left = bgraMonitor('left', 60, 40, [255, 0, 0], { x: 0, y: 0, width: 60, height: 40 })
    const right = bgraMonitor('right', 60, 40, [0, 0, 255], { x: 60, y: 0, width: 60, height: 40 })
    const monitors = [
      { id: 'left', bounds: left.bounds, scaleFactor: 1, imageWidth: 60, imageHeight: 40, rotation: 0 },
      { id: 'right', bounds: right.bounds, scaleFactor: 1, imageWidth: 60, imageHeight: 40, rotation: 0 }
    ]

    const plan = planNativeCrop({ x: 30, y: 10, width: 60, height: 20 }, monitors)
    expect(plan.width).toBe(60)
    expect(plan.parts).toHaveLength(2)
    // The parts meet exactly at the seam in the output, so nothing is doubled.
    const [first, second] = plan.parts
    expect(first.target.x + first.target.width).toBe(second.target.x)

    const result = await cropFromMonitors([left, right], plan)
    expect(Array.from(result.data.slice(0, 4))).toEqual([255, 0, 0, 255])
    // The first pixel of the right-hand monitor is already blue.
    const seam = 30 * 4
    expect(Array.from(result.data.slice(seam, seam + 4))).toEqual([0, 0, 255, 255])
  })

  it('fills the strip between screens with black instead of nothing', async () => {
    const left = bgraMonitor('left', 40, 40, [255, 0, 0], { x: 0, y: 0, width: 40, height: 40 })
    const monitors = [{ id: 'left', bounds: left.bounds, scaleFactor: 1, imageWidth: 40, imageHeight: 40, rotation: 0 }]

    // A rectangle that starts in the gap between screens.
    const plan = planNativeCrop({ x: 50, y: 10, width: 20, height: 10 }, monitors)
    const result = await cropFromMonitors([left], plan)
    expect(plan.parts).toHaveLength(0)
    expect(Array.from(result.data.slice(0, 4))).toEqual([0, 0, 0, 255])
  })

  it('takes a portrait monitor upright, at its own pixels', async () => {
    // A 1080 × 1920 screen whose capture came back as 1920 × 1080.
    const portrait = bgraMonitor('p', 1920, 1080, [255, 0, 0], { x: 0, y: 0, width: 1080, height: 1920 })
    const monitors = [
      { id: 'p', bounds: portrait.bounds, scaleFactor: 1, imageWidth: 1920, imageHeight: 1080, rotation: 0 }
    ]

    const plan = planNativeCrop({ x: 0, y: 0, width: 1080, height: 1920 }, monitors)
    expect(plan.width).toBe(1080)
    expect(plan.height).toBe(1920)
    // The source rectangle is expressed in the turned bitmap's own pixels.
    expect(plan.parts[0].source.width).toBe(1080)
    expect(plan.parts[0].source.height).toBe(1920)

    const result = await cropFromMonitors([portrait], plan)
    expect(result.width).toBe(1080)
    expect(result.height).toBe(1920)
    expect(Array.from(result.data.slice(0, 4))).toEqual([255, 0, 0, 255])
  })

  it('resamples only the monitor that differs from the output density', async () => {
    const normal = bgraMonitor('1x', 100, 100, [255, 0, 0], { x: 0, y: 0, width: 100, height: 100 })
    const retina = bgraMonitor('2x', 200, 200, [0, 0, 255], { x: 100, y: 0, width: 100, height: 100 })
    const monitors = [
      { id: '1x', bounds: normal.bounds, scaleFactor: 1, imageWidth: 100, imageHeight: 100, rotation: 0 },
      { id: '2x', bounds: retina.bounds, scaleFactor: 2, imageWidth: 200, imageHeight: 200, rotation: 0 }
    ]

    // Mostly on the 2x screen, with a sliver of the 1x one: the sliver is the
    // only thing that has to be scaled, and it is the smaller share.
    const plan = planNativeCrop({ x: 90, y: 20, width: 40, height: 20 }, monitors)
    expect(plan.width).toBe(80)
    expect(plan.parts).toHaveLength(2)
    const small = plan.parts.find((part) => part.id === '1x')
    const large = plan.parts.find((part) => part.id === '2x')
    expect(small?.resampled).toBe(true)
    expect(large?.resampled).toBe(false)

    const result = await cropFromMonitors([normal, retina], plan)
    expect(result.width).toBe(80)
    expect(result.height).toBe(40)
    // The 2x part keeps its exact blue, at the exact place it belongs.
    const last = (result.width * result.height - 1) * 4
    expect(Array.from(result.data.slice(last, last + 4))).toEqual([0, 0, 255, 255])
  })
})
