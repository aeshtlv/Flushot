import sharp from 'sharp'
import { parseHexColor } from '../src/main/imaging/compose'

export interface RawImage {
  data: Buffer
  width: number
  height: number
  channels: number
}

export async function raw(buffer: Buffer): Promise<RawImage> {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height, channels: info.channels }
}

/**
 * Read pixels that are already decoded, so a test can inspect a raster without
 * encoding and decoding it first.
 */
export function fromRaster(raster: { data: Uint8Array; width: number; height: number }): RawImage {
  return {
    data: Buffer.from(raster.data.buffer, raster.data.byteOffset, raster.data.byteLength),
    width: raster.width,
    height: raster.height,
    channels: 4
  }
}

export function pixel(image: RawImage, x: number, y: number): { r: number; g: number; b: number; a: number } {
  const index = (Math.round(y) * image.width + Math.round(x)) * image.channels
  return { r: image.data[index], g: image.data[index + 1], b: image.data[index + 2], a: image.data[index + 3] }
}

export function colorOf(hex: string): { r: number; g: number; b: number } {
  return parseHexColor(hex)
}

/** Distance between two RGB colours (0–441). */
export function colorDistance(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }): number {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2)
}

/** Solid colour PNG used as a stand-in for a captured region. */
export async function solidImage(width: number, height: number, hex: string): Promise<Buffer> {
  const { r, g, b } = parseHexColor(hex)
  return sharp({ create: { width, height, channels: 4, background: { r, g, b, alpha: 1 } } })
    .png()
    .toBuffer()
}

/**
 * Test image with four distinct corner markers and a gradient centre.
 * Used to prove that nothing is cropped and proportions stay intact.
 */
export async function markerImage(width: number, height: number): Promise<Buffer> {
  const marker = Math.max(8, Math.round(Math.min(width, height) * 0.08))
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2b2b2b"/><stop offset="1" stop-color="#8a8a8a"/>
    </linearGradient></defs>
    <rect width="${width}" height="${height}" fill="url(#g)"/>
    <rect x="0" y="0" width="${marker}" height="${marker}" fill="#FF0000"/>
    <rect x="${width - marker}" y="0" width="${marker}" height="${marker}" fill="#00FF00"/>
    <rect x="0" y="${height - marker}" width="${marker}" height="${marker}" fill="#0000FF"/>
    <rect x="${width - marker}" y="${height - marker}" width="${marker}" height="${marker}" fill="#FFFF00"/>
  </svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}
