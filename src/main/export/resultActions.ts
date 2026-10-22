import { existsSync } from 'node:fs'
import path from 'node:path'
import { BrowserWindow, ClipboardItem, clipboard, dialog } from 'electron'
import type { ActionResult, AnnotationLayerPayload, ScreenshotSettings } from '../../shared/types'
import type { FrameLayout } from '../imaging/layout'
import { pasteAnnotationLayer } from '../imaging/annotations'
import type { Raster } from '../imaging/raster'
import { encodeRaster, writeImageFile } from './imageExport'
import { buildScreenshotFilename, uniqueFilename } from './filename'

export interface ResultContext {
  /** The finished card as pixels: picture, frame, corners and shadow. */
  raster: Raster
  /** Where the picture sits inside the card. */
  layout: FrameLayout
  settings: ScreenshotSettings
  window: BrowserWindow | null
  /**
   * PNG of `raster` with no drawing on it, already encoded.
   *
   * The session starts this encode the moment the card appears, so pressing
   * "Копировать" or "Сохранить" on an untouched card hands over a finished
   * buffer instead of waiting for the encoder. Ignored when the card has to be
   * rebuilt anyway because the user drew on it.
   */
  png?: Buffer
}

/**
 * The card with the drawing already on it, as pixels.
 *
 * Pasting is a memory copy; the caller then encodes once, in the format that is
 * actually needed. The old path encoded the card, decoded it to composite the
 * drawing, encoded it again, and for JPEG decoded and encoded a third time.
 */
function finish(result: ResultContext, annotations?: AnnotationLayerPayload): Raster {
  if (!annotations) return result.raster
  return pasteAnnotationLayer(result.raster, result.layout, annotations)
}

/**
 * The bytes that go to disk, produced with as few passes as the request allows.
 *
 * Three cases, in order of how often they happen: an untouched card in the
 * configured PNG format uses the buffer that was encoded while the user was
 * looking at the result; an untouched card in another format is encoded once; a
 * card with a drawing is pasted and then encoded once.
 */
async function encodeCard(result: ResultContext, annotations?: AnnotationLayerPayload): Promise<Buffer> {
  if (!annotations && result.png && result.settings.format === 'png') return result.png
  const raster = finish(result, annotations)
  return encodeRaster(raster, { format: result.settings.format, jpegQuality: result.settings.jpegQuality })
}

/** Save to the configured folder without asking. */
export async function saveToFolder(result: ResultContext, annotations?: AnnotationLayerPayload): Promise<ActionResult> {
  const directory = result.settings.saveDirectory
  const baseName = buildScreenshotFilename(new Date(), result.settings.format)
  const exists = (name: string): boolean => existsSync(path.join(directory, name))
  const fileName = uniqueFilename(baseName, exists)
  const target = path.join(directory, fileName)

  try {
    // The write itself is the only test that matters: a probe that passes is no
    // guarantee that the write will, and it used to cost three file-system round
    // trips on every save.
    const buffer = await encodeCard(result, annotations)
    await writeImageFile(target, buffer)
  } catch (error) {
    console.error('Не удалось сохранить снимок', error)
    return { ok: false, message: `Нет доступа к папке «${directory}». Выберите другую в настройках.` }
  }
  return { ok: true, message: `Сохранено · ${fileName}`, path: target }
}

/** Show a native save dialog with a sensible default name. */
export async function saveWithDialog(
  result: ResultContext,
  annotations?: AnnotationLayerPayload,
  beforeEncode?: () => void
): Promise<ActionResult> {
  const filters =
    result.settings.format === 'png'
      ? [{ name: 'PNG', extensions: ['png'] }]
      : result.settings.format === 'webp'
        ? [{ name: 'WebP', extensions: ['webp'] }]
        : [{ name: 'JPEG', extensions: ['jpg', 'jpeg'] }]

  const defaultPath = path.join(result.settings.saveDirectory, buildScreenshotFilename(new Date(), result.settings.format))
  const options = {
    title: 'Сохранить снимок',
    defaultPath,
    filters,
    properties: ['createDirectory' as const, 'showOverwriteConfirmation' as const]
  }

  const response = result.window
    ? await dialog.showSaveDialog(result.window, options)
    : await dialog.showSaveDialog(options)
  if (response.canceled || !response.filePath) {
    return { ok: false, canceled: true, message: 'Сохранение отменено' }
  }

  // The dialog is gone, so the picture can leave the screen before the encode
  // starts rather than after it.
  beforeEncode?.()
  const buffer = await encodeCard(result, annotations)
  await writeImageFile(response.filePath, buffer)
  return { ok: true, message: `Сохранено · ${path.basename(response.filePath)}`, path: response.filePath }
}

export async function saveResult(
  result: ResultContext,
  annotations?: AnnotationLayerPayload,
  beforeEncode?: () => void
): Promise<ActionResult> {
  return result.settings.saveMode === 'folder'
    ? saveToFolder(result, annotations)
    : saveWithDialog(result, annotations, beforeEncode)
}

export async function copyResult(result: ResultContext, annotations?: AnnotationLayerPayload): Promise<ActionResult> {
  const raster = finish(result, annotations)
  if (raster.width === 0 || raster.height === 0) {
    return { ok: false, message: 'Не удалось подготовить изображение для буфера обмена' }
  }

  // The clipboard always receives lossless PNG, even when files are saved as
  // JPEG: pasting into another app must not depend on the save format.
  const png =
    !annotations && result.png
      ? result.png
      : await encodeRaster(raster, { format: 'png', jpegQuality: result.settings.jpegQuality })
  // A Buffer is already a Uint8Array, so it is wrapped without an extra copy.
  const blob = new Blob([png], { type: 'image/png' })
  await clipboard.write([new ClipboardItem({ 'image/png': blob })])
  return { ok: true, message: 'Скопировано в буфер обмена' }
}
