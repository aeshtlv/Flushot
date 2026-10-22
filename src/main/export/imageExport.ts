import { promises as fs } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import type { ImageFormat } from '../../shared/types'
import { FAST_PNG } from '../imaging/compose'
import { choosePngPolicy } from '../imaging/pngPolicy'
import type { Raster } from '../imaging/raster'

export interface ExportOptions {
  format: ImageFormat
  jpegQuality: number
}

/** Raw pixels as a sharp input, without copying the buffer. */
function fromRaster(raster: Raster): ReturnType<typeof sharp> {
  return sharp(Buffer.from(raster.data.buffer, raster.data.byteOffset, raster.data.byteLength), {
    raw: { width: raster.width, height: raster.height, channels: 4 }
  })
}

/**
 * Encode the finished card in the format the user chose, straight from pixels.
 *
 * One encode, no intermediate PNG: saving as JPEG used to compose a PNG, write
 * it, decode it again and then encode the JPEG — three passes over the same
 * pixels. PNG comes out lossless at the same settings a plain save always used,
 * so the file is identical to what the old path produced.
 *
 * PNG filtering is chosen from the content (`choosePngPolicy`): a screenshot is
 * flat and a fixed filter is four times faster on it for a few percent of size,
 * while noisy content keeps the slower per-row filtering that compresses it.
 */
export async function encodeRaster(raster: Raster, options: ExportOptions): Promise<Buffer> {
  const quality = Math.min(100, Math.max(60, Math.round(options.jpegQuality)))

  if (options.format === 'webp') {
    return fromRaster(raster)
      .removeAlpha()
      .webp({ quality, alphaQuality: 100, effort: 2, smartSubsample: false })
      .toBuffer()
  }

  if (options.format === 'jpeg') {
    return fromRaster(raster)
      .flatten({ background: '#FFFFFF' })
      .jpeg({ quality, chromaSubsampling: '4:4:4' })
      .toBuffer()
  }

  const policy = choosePngPolicy(raster, FAST_PNG.compressionLevel)
  return fromRaster(raster)
    .removeAlpha()
    .png({ compressionLevel: policy.compressionLevel, adaptiveFiltering: policy.adaptiveFiltering })
    .toBuffer()
}

/**
 * Encode the composed PNG buffer for the requested format. The size is whatever
 * the user selected plus its frame, so nothing here depends on a fixed canvas.
 *
 * For PNG the buffer is returned untouched: it is already a lossless PNG, and a
 * decode + re-encode cycle would only cost time and risk a colour-management
 * pass on the way through. What the user sees is byte for byte what was composed.
 *
 * JPEG and WebP are lossy, so they get the settings that keep small text sharp:
 * 4:4:4 chroma for JPEG and no smart subsampling for WebP. Measured on a real
 * 1920 × 1080 capture:
 *
 * | encoder                    | time   | size   |
 * |----------------------------|--------|--------|
 * | JPEG q94 4:4:4 + mozjpeg   | 513 ms | 541 KB |
 * | JPEG q94 4:4:4             |  59 ms | 581 KB |
 * | WebP q94, effort 4         | 282 ms | 320 KB |
 * | WebP q94, effort 2         | 165 ms | 319 KB |
 * | WebP q94, effort 0         | 126 ms | 332 KB |
 *
 * mozjpeg and a high WebP effort are size optimisers, not quality settings: the
 * pixels are the same, the file is 7 % smaller, and the wait is nine times
 * longer. Effort 2 is the point where WebP stops improving at all.
 */
export async function encodeImage(pngBuffer: Buffer, options: ExportOptions): Promise<Buffer> {
  if (options.format === 'png') {
    return pngBuffer
  }

  const quality = Math.min(100, Math.max(60, Math.round(options.jpegQuality)))

  if (options.format === 'webp') {
    return sharp(pngBuffer)
      .webp({ quality, alphaQuality: 100, effort: 2, smartSubsample: false })
      .toBuffer()
  }

  return sharp(pngBuffer)
    .flatten({ background: '#FFFFFF' })
    .jpeg({ quality, chromaSubsampling: '4:4:4' })
    .toBuffer()
}

export async function writeImageFile(filePath: string, data: Buffer): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, data)
}

export async function ensureDirectory(directory: string): Promise<void> {
  const stat = await fs.stat(directory)
  if (!stat.isDirectory()) throw new Error('Выбранный путь не является папкой')
}

export async function isDirectoryWritable(directory: string): Promise<boolean> {
  try {
    await fs.mkdir(directory, { recursive: true })
    const probe = path.join(directory, `.flushot-write-test-${process.pid}`)
    await fs.writeFile(probe, 'ok')
    await fs.unlink(probe)
    return true
  } catch {
    return false
  }
}
