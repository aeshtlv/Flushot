import type { ImageFormat } from '../../shared/types'

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0')
}

/** Local timestamp in the form 2026-10-17_14-30-25. */
export function formatTimestamp(date: Date): string {
  const y = date.getFullYear()
  const mo = pad(date.getMonth() + 1)
  const d = pad(date.getDate())
  const h = pad(date.getHours())
  const mi = pad(date.getMinutes())
  const s = pad(date.getSeconds())
  return `${y}-${mo}-${d}_${h}-${mi}-${s}`
}

export function fileExtension(format: ImageFormat): string {
  if (format === 'jpeg') return 'jpg'
  if (format === 'webp') return 'webp'
  return 'png'
}

export function buildScreenshotFilename(date: Date, format: ImageFormat): string {
  return `screenshot_${formatTimestamp(date)}.${fileExtension(format)}`
}

/** Avoid overwriting: append _1, _2 … when a file already exists. */
export function uniqueFilename(candidate: string, exists: (path: string) => boolean): string {
  if (!exists(candidate)) return candidate
  const dot = candidate.lastIndexOf('.')
  const base = dot > 0 ? candidate.slice(0, dot) : candidate
  const ext = dot > 0 ? candidate.slice(dot) : ''
  for (let index = 1; index < 10_000; index++) {
    const next = `${base}_${index}${ext}`
    if (!exists(next)) return next
  }
  throw new Error('Не удалось подобрать имя файла')
}
