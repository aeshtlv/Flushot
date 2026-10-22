import sharp from 'sharp'
import type { ScreenshotSettings } from '../../shared/types'
import { PREVIEW_DEFAULT_WIDTH, clampPreviewWidth } from '../../shared/preview'
import { composeOptionsFromSettings, composePreview } from '../imaging/compose'

const MOCK_SCREENSHOT = `
<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900" viewBox="0 0 1440 900">
  <defs>
    <linearGradient id="wall" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1F2937"/>
      <stop offset="0.5" stop-color="#312E81"/>
      <stop offset="1" stop-color="#0F172A"/>
    </linearGradient>
    <linearGradient id="card" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFFFFF"/>
      <stop offset="1" stop-color="#F2F2F7"/>
    </linearGradient>
  </defs>
  <rect width="1440" height="900" fill="url(#wall)"/>
  <circle cx="1180" cy="140" r="220" fill="#5E5CE6" opacity="0.28"/>
  <circle cx="240" cy="780" r="260" fill="#0A84FF" opacity="0.22"/>
  <g>
    <rect x="270" y="190" width="900" height="520" rx="18" fill="url(#card)"/>
    <rect x="270" y="190" width="900" height="46" rx="18" fill="#E9E9EF"/>
    <rect x="270" y="222" width="900" height="14" fill="#E9E9EF"/>
    <circle cx="302" cy="213" r="7" fill="#FF5F57"/>
    <circle cx="326" cy="213" r="7" fill="#FEBC2E"/>
    <circle cx="350" cy="213" r="7" fill="#28C840"/>
    <rect x="310" y="286" width="270" height="20" rx="10" fill="#1D1D1F" opacity="0.82"/>
    <rect x="310" y="330" width="420" height="11" rx="5.5" fill="#1D1D1F" opacity="0.28"/>
    <rect x="310" y="356" width="380" height="11" rx="5.5" fill="#1D1D1F" opacity="0.2"/>
    <rect x="310" y="382" width="440" height="11" rx="5.5" fill="#1D1D1F" opacity="0.16"/>
    <rect x="310" y="446" width="180" height="40" rx="10" fill="#0A84FF"/>
    <rect x="512" y="446" width="150" height="40" rx="10" fill="#0A84FF" opacity="0.14"/>
    <rect x="800" y="286" width="330" height="200" rx="14" fill="#0A84FF" opacity="0.12"/>
    <rect x="800" y="516" width="330" height="120" rx="14" fill="#34C759" opacity="0.14"/>
  </g>
</svg>`

let cachedKey = ''
let cachedResult = ''
let cachedMock: Buffer | null = null

/**
 * Render a sample card with the current settings for the settings preview.
 *
 * `width` is the CSS width the preview is displayed at, already multiplied by the
 * device pixel ratio by the caller. It is clamped and included in the cache key,
 * so a resize produces a new picture rather than the one rendered for the
 * previous window size.
 */
export async function renderPreview(settings: ScreenshotSettings, width?: number): Promise<string> {
  const target = clampPreviewWidth(width ?? PREVIEW_DEFAULT_WIDTH)
  const key = `${target}|${JSON.stringify(settings)}`
  if (key === cachedKey && cachedResult) return cachedResult

  // The sample is a constant SVG: rasterising it once per process saves ~10 ms
  // on every slider move.
  cachedMock ??= await sharp(Buffer.from(MOCK_SCREENSHOT)).png().toBuffer()
  // Width only: the result may have any aspect ratio now, so forcing 960×540
  // would crop it. The preview is built straight from the composite, so no
  // full-size PNG is ever encoded just to be thrown away.
  const preview = await composePreview(cachedMock, composeOptionsFromSettings(settings), target)

  cachedKey = key
  cachedResult = preview
  return cachedResult
}
