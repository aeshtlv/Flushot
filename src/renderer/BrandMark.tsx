import type { JSX } from 'react'
import { LOGO_INK, LOGO_SHAPES, LOGO_TILE, LOGO_VIEWBOX } from '../shared/logo'

export interface BrandMarkProps {
  /** Rendered size in CSS pixels. The mark is square. */
  size?: number
  /** Accessible name; when omitted the mark is decorative and hidden from AT. */
  title?: string
  className?: string
}

/**
 * The Flushot mark as an inline SVG.
 *
 * Inline rather than an image file because the settings window is loaded from
 * inside the packaged app, where a relative `<img src>` would have to survive
 * asar packing and the dev server's different URL scheme. Inline markup has no
 * path to get wrong, and it stays crisp at any size because it is vector.
 *
 * The geometry comes from `src/shared/logo.ts`, the same constants the app icon
 * is rasterised from, so the title bar cannot end up showing a different logo
 * than the taskbar.
 */
export function BrandMark({ size = 16, title, className }: BrandMarkProps): JSX.Element {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox={`0 0 ${LOGO_VIEWBOX} ${LOGO_VIEWBOX}`}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      <rect
        width={LOGO_TILE.size}
        height={LOGO_TILE.size}
        rx={LOGO_TILE.radius}
        fill={LOGO_TILE.fill}
      />
      <g fill={LOGO_INK}>
        {LOGO_SHAPES.map((shape) => (
          <path key={shape} d={shape} />
        ))}
      </g>
    </svg>
  )
}
