import { desktopCapturer, screen, type DesktopCapturerSource, type Display, type NativeImage } from 'electron'
import type { DisplayCaptureSnapshot, DisplayDescriptor } from '../../shared/types'

const THUMBNAIL_TIMEOUT_MS = 15_000

/** A frozen screen kept as a NativeImage: pixels stay untouched until needed. */
export interface NativeSnapshot {
  display: DisplayDescriptor
  image: NativeImage
  width: number
  height: number
  /** Rotation Windows reports for this display: 0, 90, 180 or 270. */
  rotation: number
}

export interface CaptureTimings {
  getSources?: number
  encode?: number
  total?: number
}

/**
 * Turn an Electron display into a descriptor. The frozen screenshot is taken
 * at physical resolution (DIP size × scaleFactor), which keeps 125 %, 150 % and
 * mixed-DPI setups pixel exact.
 */
export function describeDisplay(display: Display): DisplayDescriptor {
  const width = Math.round(display.bounds.width * display.scaleFactor)
  const height = Math.round(display.bounds.height * display.scaleFactor)
  return {
    id: String(display.id),
    label: display.label || `Экран ${display.id}`,
    bounds: { ...display.bounds },
    scaleFactor: display.scaleFactor,
    imageWidth: width,
    imageHeight: height
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

/**
 * Capture every connected monitor. Electron 44 returns one source per screen;
 * sources are matched to displays by display_id when available, otherwise by
 * size, and finally by order as a safe fallback.
 *
 * The result is kept as NativeImage on purpose: PNG encoding costs ~70 ms per
 * 1080p screen and is not needed until the user actually saves or copies, so it
 * must not sit on the hotkey path.
 */
export async function captureDisplays(timings: CaptureTimings = {}): Promise<NativeSnapshot[]> {
  const started = performance.now()
  const displays = screen.getAllDisplays()
  if (displays.length === 0) throw new Error('Не найдено ни одного экрана')

  // Request the largest physical size among all monitors so no screen is
  // downsampled by the thumbnail request itself.
  const maxWidth = Math.max(...displays.map((d) => Math.round(d.bounds.width * d.scaleFactor)))
  const maxHeight = Math.max(...displays.map((d) => Math.round(d.bounds.height * d.scaleFactor)))

  const captures = await withTimeout(
    desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: maxWidth, height: maxHeight },
      fetchWindowIcons: false
    }),
    THUMBNAIL_TIMEOUT_MS,
    'Истекло время ожидания захвата экрана'
  )
  timings.getSources = Math.round(performance.now() - started)

  if (captures.length === 0) throw new Error('Не удалось получить снимок экрана')

  const used = new Set<string>()
  const snapshots: NativeSnapshot[] = []

  for (let index = 0; index < displays.length; index++) {
    const display = displays[index]
    const descriptor = describeDisplay(display)
    const source =
      matchSourceByDisplayId(captures, display, used) ??
      matchSourceBySize(captures, descriptor, used) ??
      captures.find((s) => !used.has(s.id))

    if (!source || source.thumbnail.isEmpty()) {
      throw new Error(`Не удалось захватить экран «${descriptor.label}»`)
    }
    used.add(source.id)

    const size = source.thumbnail.getSize()
    if (size.width === 0 || size.height === 0) {
      throw new Error(`Экран «${descriptor.label}» вернул пустое изображение`)
    }

    snapshots.push({
      display: { ...descriptor, imageWidth: size.width, imageHeight: size.height },
      image: source.thumbnail,
      width: size.width,
      height: size.height,
      rotation: display.rotation ?? 0
    })
  }

  timings.total = Math.round(performance.now() - started)
  return snapshots
}

/**
 * Raw pixels for the overlay preview.
 *
 * PNG would have to be encoded in main and decoded in the renderer (~200 ms
 * together). Electron hands out BGRA, while canvas wants RGBA, so the channels
 * are swapped here with one 32-bit operation per pixel — a few milliseconds and
 * completely lossless.
 */
export function toRgbaBitmap(snapshot: Pick<NativeSnapshot, 'image' | 'width' | 'height'>): {
  data: Uint8Array
  width: number
  height: number
} {
  const bitmap = snapshot.image.toBitmap()
  const pixels = new Uint32Array(bitmap.buffer, bitmap.byteOffset, Math.floor(bitmap.byteLength / 4))
  for (let i = 0; i < pixels.length; i++) {
    const value = pixels[i]
    // 0xAARRGGBB → 0xAABBGGRR: swap red and blue, keep alpha and green.
    pixels[i] = (value & 0xff00ff00) | ((value & 0xff) << 16) | ((value >>> 16) & 0xff)
  }
  // A view, not a copy: `new Uint8Array(bitmap)` would duplicate the whole
  // frame — 16 MB for a two-monitor desktop — for nothing.
  const data = new Uint8Array(bitmap.buffer, bitmap.byteOffset, bitmap.byteLength)
  return { data, width: snapshot.width, height: snapshot.height }
}

/** PNG of a frozen screen, produced on demand only. */
export function toPng(snapshot: NativeSnapshot): Buffer {
  return snapshot.image.toPNG()
}

function matchSourceByDisplayId(
  sources: DesktopCapturerSource[],
  display: Display,
  used: Set<string>
): DesktopCapturerSource | undefined {
  const displayId = String(display.id)
  return sources.find((source) => source.display_id === displayId && !used.has(source.id))
}

function matchSourceBySize(
  sources: DesktopCapturerSource[],
  descriptor: DisplayDescriptor,
  used: Set<string>
): DesktopCapturerSource | undefined {
  const expectedAspect = descriptor.bounds.width / descriptor.bounds.height
  return sources.find((source) => {
    if (used.has(source.id)) return false
    const size = source.thumbnail.getSize()
    if (size.width === 0 || size.height === 0) return false
    const aspect = size.width / size.height
    // A monitor stored sideways is still the right monitor: matching only the
    // direct aspect used to leave a rotated screen unmatched, so it fell through
    // to "whatever is left" and two monitors could swap places.
    const turned = 1 / expectedAspect
    return Math.abs(aspect - expectedAspect) < 0.01 || Math.abs(aspect - turned) < 0.01
  })
}

/** Convenience wrapper for callers that want PNG up front (diagnostics). */
export async function captureAllDisplays(timings: CaptureTimings = {}): Promise<DisplayCaptureSnapshot[]> {
  const started = performance.now()
  const natives = await captureDisplays(timings)
  const snapshots = natives.map((snapshot) => ({
    display: snapshot.display,
    image: toPng(snapshot)
  }))
  timings.encode = Math.round(performance.now() - started - (timings.getSources ?? 0))
  timings.total = Math.round(performance.now() - started)
  return snapshots
}
