/** Colour helpers shared by the imaging code. */

/** Parse `#rrggbb` into channels. */
export function parseHexColor(hex: string): { r: number; g: number; b: number } {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex.trim())
  if (!match) throw new Error(`Некорректный цвет фона: ${hex}`)
  const value = Number.parseInt(match[1], 16)
  return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff }
}
