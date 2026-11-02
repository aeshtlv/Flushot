import sharp from 'sharp'
import type { ScreenshotSettings } from '../../shared/types'
import { PREVIEW_DEFAULT_WIDTH, clampPreviewWidth } from '../../shared/preview'
import { composeOptionsFromSettings, composePreview } from '../imaging/compose'

/**
 * The picture the settings preview is built on top of.
 *
 * It has to look like something a Windows user would actually have on screen,
 * because the point of the preview is «this is what your screenshot will look
 * like». An earlier version was a macOS window — three coloured circles in the
 * corner and SF blue everywhere — which meant the preview of a Windows program's
 * output showed a foreign desktop. This one is a Windows window: a flat title bar
 * with the title on the left and three boxed caption buttons on the right, and
 * the accent colour Windows uses.
 */
const MOCK_SCREENSHOT = `
<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900" viewBox="0 0 1440 900">
  <defs>
    <linearGradient id="wall" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1F2937"/>
      <stop offset="0.5" stop-color="#243B55"/>
      <stop offset="1" stop-color="#0F172A"/>
    </linearGradient>
    <linearGradient id="card" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFFFFF"/>
      <stop offset="1" stop-color="#F7F8FA"/>
    </linearGradient>
    <clipPath id="win">
      <rect x="270" y="190" width="900" height="520" rx="10"/>
    </clipPath>
  </defs>
  <rect width="1440" height="900" fill="url(#wall)"/>
  <circle cx="1180" cy="140" r="220" fill="#0078D4" opacity="0.26"/>
  <circle cx="240" cy="780" r="260" fill="#2B88D8" opacity="0.2"/>
  <g clip-path="url(#win)">
    <rect x="270" y="190" width="900" height="520" fill="url(#card)"/>
    <rect x="270" y="190" width="900" height="42" fill="#F3F3F3"/>
    <rect x="270" y="231" width="900" height="1" fill="#E5E5E5"/>
    <rect x="286" y="203" width="14" height="14" rx="3" fill="#0078D4"/>
    <rect x="310" y="208" width="150" height="6" rx="3" fill="#3F4451" opacity="0.75"/>
    <rect x="1020" y="211" width="10" height="1" fill="#4B5563"/>
    <rect x="1066" y="206.5" width="9" height="9" fill="none" stroke="#4B5563" stroke-width="1"/>
    <path d="M1113 206l10 10M1123 206l-10 10" stroke="#4B5563" stroke-width="1" fill="none"/>
    <rect x="310" y="286" width="270" height="20" rx="4" fill="#1D1D1F" opacity="0.82"/>
    <rect x="310" y="330" width="420" height="11" rx="2" fill="#1D1D1F" opacity="0.28"/>
    <rect x="310" y="356" width="380" height="11" rx="2" fill="#1D1D1F" opacity="0.2"/>
    <rect x="310" y="382" width="440" height="11" rx="2" fill="#1D1D1F" opacity="0.16"/>
    <rect x="310" y="446" width="180" height="40" rx="4" fill="#0078D4"/>
    <rect x="512" y="446" width="150" height="40" rx="4" fill="#0078D4" opacity="0.14"/>
    <rect x="800" y="286" width="330" height="200" rx="6" fill="#0078D4" opacity="0.12"/>
    <rect x="800" y="516" width="330" height="120" rx="6" fill="#107C10" opacity="0.14"/>
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
