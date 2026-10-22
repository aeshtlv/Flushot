/**
 * The Flushot mark, in one place.
 *
 * `logo/logo.svg` is the drawing the owner supplied; this module is its copy in a
 * form the app can use. Both the main process (window and tray icons, rasterised
 * through sharp) and the renderer (the mark in the settings title bar) build from
 * these constants, so there is one geometry rather than three.
 *
 * A copy can drift from its source, so `tests/logo.test.ts` reads `logo/logo.svg`
 * and fails if the subpaths here stop matching it. The site reads the SVG file
 * itself (`scripts/build-site.cjs`), which is why the test matters: the site would
 * follow a change automatically while the app would not.
 */

/** The viewBox the mark is drawn in. Everything below is in these units. */
export const LOGO_VIEWBOX = 200

/** The rounded dark tile the mark sits on. */
export const LOGO_TILE = { size: 200, radius: 44, fill: '#111111' } as const

/** The mark's colour: a light blue that reads on the dark tile. */
export const LOGO_INK = '#A3C8F0'

/**
 * The mark: a tall bar, a shorter bar, then a diagonal chain of squares stepping
 * down to the right — a "shot" that starts at full height and breaks into dots.
 *
 * Kept as separate subpaths rather than one long `d`, because the tray glyph and
 * the tests need to reason about the pieces.
 */
export const LOGO_SHAPES: readonly string[] = [
  'M57 57h14v84H57z',
  'M71 71h14v42H71z',
  'M85 85h14v14H85z',
  'M85 113h14v14H85z',
  'M99 99h14v14H99z',
  'M99 127h14v14H99z',
  'M113 113h14v14H113z',
  'M113 141h14v14H113z',
  'M127 99h14v14H127z',
  'M127 127h14v14H127z'
]

/**
 * The full-colour mark as standalone SVG, for rasterising into an icon.
 *
 * `width`/`height` are omitted on purpose: sharp sizes the output, and a fixed
 * size in the markup would make every caller fight it.
 */
export const APP_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${LOGO_VIEWBOX} ${LOGO_VIEWBOX}">
  <title>Flushot</title>
  <rect width="${LOGO_TILE.size}" height="${LOGO_TILE.size}" rx="${LOGO_TILE.radius}" fill="${LOGO_TILE.fill}"/>
  <g fill="${LOGO_INK}">
    ${LOGO_SHAPES.map((shape) => `<path d="${shape}"/>`).join('\n    ')}
  </g>
</svg>`

/**
 * The tray drawing, in the two colourings the taskbar can need.
 *
 * The mark is a dark tile with light bars, and the notification area is exactly where
 * that breaks down: the Windows dark taskbar is `#202020`, so a `#111111` tile has a
 * contrast of 1.05:1 there and the rounded square — the outline of the whole logo — is
 * simply not on screen. Measured at 16 px, the drawing as-is puts 7 % of its pixels at
 * 3:1 or better against a dark taskbar and 89 % against a light one.
 *
 * So the tray gets both colourings, and the shell picks by its own theme. Neither
 * invents a colour and neither redraws anything: the two brand colours swap roles, the
 * tile taking the blue and the staircase taking the tile's colour. That is the same
 * geometry at the same proportions, and it is what makes the square visible in the
 * dark — 89 % of pixels at 3:1, mean contrast 7.98:1, against 1.60:1 for the original.
 */
function trayMark(tile: string, ink: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${LOGO_VIEWBOX} ${LOGO_VIEWBOX}">
  <title>Flushot</title>
  <rect width="${LOGO_TILE.size}" height="${LOGO_TILE.size}" rx="${LOGO_TILE.radius}" fill="${tile}"/>
  <g fill="${ink}">
    ${LOGO_SHAPES.map((shape) => `<path d="${shape}"/>`).join('\n    ')}
  </g>
</svg>`
}

/** For a light taskbar: the mark as drawn, dark tile with blue bars. */
export const TRAY_ICON_SVG = trayMark(LOGO_TILE.fill, LOGO_INK)

/**
 * For a dark taskbar: the same drawing with the two brand colours swapped.
 *
 * The tile becomes `#A3C8F0` and the staircase becomes `#111111`. Both are the logo's
 * own colours; only which one is the figure changes, which is the usual way an icon
 * survives both backgrounds.
 */
export const TRAY_ICON_DARK_SVG = trayMark(LOGO_INK, LOGO_TILE.fill)
