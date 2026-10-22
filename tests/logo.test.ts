import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  APP_ICON_SVG,
  LOGO_INK,
  LOGO_SHAPES,
  LOGO_TILE,
  LOGO_VIEWBOX,
  TRAY_ICON_DARK_SVG,
  TRAY_ICON_SVG
} from '../src/shared/logo'

/**
 * `logo/logo.svg` is the drawing the owner supplied, and it is the source of truth.
 * The site reads that file directly; the app carries a copy in `src/shared/logo.ts`
 * because the main process needs the markup as a string to rasterise it.
 *
 * A copy can drift, and the failure would be silent and ugly: change the file, rebuild
 * the site, and the page shows one logo while the taskbar shows the old one. So the
 * copy is checked against the file here.
 */
const SOURCE = readFileSync(join(__dirname, '..', 'logo', 'logo.svg'), 'utf8')

/** Every `d` attribute in the file, split into subpaths, whitespace-normalised. */
function subpaths(svg: string): string[] {
  const shapes: string[] = []
  for (const match of svg.matchAll(/\sd="([^"]+)"/g)) {
    for (const piece of match[1].split(/(?=M)/)) {
      const clean = piece.trim().replace(/\s+/g, ' ')
      if (clean) shapes.push(clean)
    }
  }
  return shapes
}

describe('the logo file and the logo in the app', () => {
  it('draws the same shapes', () => {
    expect(subpaths(SOURCE).sort()).toEqual([...LOGO_SHAPES].sort())
  })

  it('uses the same tile and ink colours', () => {
    expect(SOURCE).toContain(LOGO_INK)
    expect(SOURCE).toContain(LOGO_TILE.fill)
    // The corner radius is what makes the mark look like an app tile rather than a
    // square, and it is easy to lose in a hand-edited copy.
    expect(SOURCE).toContain(`rx="${LOGO_TILE.radius}"`)
    expect(SOURCE).toContain(`viewBox="0 0 ${LOGO_VIEWBOX} ${LOGO_VIEWBOX}"`)
  })

  it('produces icon markup that carries every shape and no placeholder', () => {
    expect(APP_ICON_SVG.startsWith('<svg')).toBe(true)
    for (const shape of LOGO_SHAPES) expect(APP_ICON_SVG).toContain(shape)
    // A stray `${...}` would make sharp throw at runtime, in the main process, where
    // the error only shows up as a window with no icon.
    expect(APP_ICON_SVG).not.toContain('${')
    expect(TRAY_ICON_SVG).not.toContain('${')
  })

  it('gives the tray the real mark, not a redrawn stand-in', () => {
    // The tray used to carry a cut-down glyph — three bars and a dot — because the full
    // drawing was assumed to be too fine for 16 px. That was a substitution of a
    // different picture for the owner's artwork, and it was wrong on principle however
    // it measured. So the tray must be the same drawing: same shapes, same tile, same
    // radius, only the two colours able to swap for a dark taskbar.
    for (const svg of [TRAY_ICON_SVG, TRAY_ICON_DARK_SVG]) {
      expect(subpaths(svg).sort()).toEqual([...LOGO_SHAPES].sort())
      expect(svg).toContain(`viewBox="0 0 ${LOGO_VIEWBOX} ${LOGO_VIEWBOX}"`)
      expect(svg).toContain(`rx="${LOGO_TILE.radius}"`)
      expect(svg).not.toContain('${')
      // Both colourings use the two brand colours and nothing else: no white, no grey,
      // no third colour invented for the tray.
      const colours = new Set(svg.match(/#[0-9A-Fa-f]{6}/g) ?? [])
      expect([...colours].sort()).toEqual([LOGO_INK, LOGO_TILE.fill].sort())
    }
  })

  it('swaps the brand colours for a dark taskbar instead of inventing new ones', () => {
    const light = TRAY_ICON_SVG
    const dark = TRAY_ICON_DARK_SVG
    expect(light).toContain(`fill="${LOGO_TILE.fill}"/>`)
    expect(dark).toContain(`fill="${LOGO_INK}"/>`)
    expect(light).not.toEqual(dark)
    // The geometry is identical: only the colours differ.
    const strip = (svg: string): string => svg.replace(/#[0-9A-Fa-f]{6}/g, '#')
    expect(strip(light)).toEqual(strip(dark))
  })

  it('puts the tile above 3:1 against the taskbar it is meant for', () => {
    // This is the whole reason there are two colourings, so it is checked rather than
    // trusted. Windows 11's dark taskbar is #202020 and its light one is #F3F3F3; a
    // tile under 3:1 is a logo that is technically present and visually absent.
    const relativeLuminance = (hex: string): number => {
      const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255)
      const linear = channels.map((value) =>
        value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)
      )
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
    }
    const contrast = (a: string, b: string): number => {
      const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
      return (light + 0.05) / (dark + 0.05)
    }

    // Light taskbar: the mark as drawn, dark tile.
    expect(contrast(LOGO_TILE.fill, '#F3F3F3')).toBeGreaterThanOrEqual(3)
    // Dark taskbar: the swapped colouring, blue tile.
    expect(contrast(LOGO_INK, '#202020')).toBeGreaterThanOrEqual(3)
    // And the pairing that does not work, recorded so nobody "simplifies" it back:
    // the dark tile on the dark taskbar is below 3:1 and is not an option.
    expect(contrast(LOGO_TILE.fill, '#202020')).toBeLessThan(3)
  })
})
