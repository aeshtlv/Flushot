/**
 * `--upload-check`: prove the whole upload path from a terminal.
 *
 * The same shape as `--update-check`. Uploading is the one feature that talks to a
 * server, and when it fails on someone's machine the message in a notification is all
 * they have. This runs the real path — compose a card from a synthetic picture, encode
 * it in the configured format, POST it, fetch the link back, delete it — and prints the
 * JSON, so the answer to "does it work here" does not depend on pressing a key and
 * watching a popup.
 *
 * It deliberately does not use the screen: a diagnostic that needs a display cannot be
 * run over a remote session, and the picture it would capture is the user's desktop,
 * which is not something to upload for a test.
 */
import { Buffer } from 'node:buffer'
import { tr } from '../i18n'
import type { ScreenshotSettings } from '../../shared/types'
import { defaultSettings } from '../../shared/settings'
import { composeRawCard, composeOptionsFromSettings } from '../imaging/compose'
import { encodeRaster } from '../export/imageExport'
import { uploadShot, expectedExtension, UPLOAD_ENDPOINT } from './uploadShot'

export interface UploadCheckReport {
  ok: boolean
  endpoint: string
  /** What the server answered, when it answered. */
  status?: number
  url?: string
  format?: string
  bytes?: number
  /** Seconds until the link stops working, as reported by the server. */
  ttl?: number
  /** Whether the link served the same bytes that were sent. */
  roundTrip?: boolean
  /** Whether deleting the link worked, so a test leaves nothing behind. */
  deleted?: boolean
  error?: string
  /** The underlying cause, when the message alone would not explain it. */
  detail?: string
  note?: string
}

/** A picture with something to compress: a gradient and a block of text-like noise. */
function sampleRaster(width = 640, height = 400): { data: Uint8Array; width: number; height: number } {
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4
      // A diagonal gradient with a soft highlight, so the encoder has real work and the
      // result is not a one-colour image that would compress to nothing.
      data[offset] = Math.round(40 + (x / width) * 180)
      data[offset + 1] = Math.round(60 + (y / height) * 150)
      data[offset + 2] = Math.round(120 + ((x + y) / (width + height)) * 100)
      data[offset + 3] = 255
    }
  }
  return { data, width, height }
}

export async function runUploadCheck(argv: string[]): Promise<number> {
  const report: UploadCheckReport = { ok: false, endpoint: UPLOAD_ENDPOINT }

  try {
    // The format matters: the extension of the link follows it, and a build that can
    // only produce PNG would make the `.webp` half of the feature untested.
    const requested = argv.find((value) => value.startsWith('--format='))?.split('=')[1]
    const settings: ScreenshotSettings = defaultSettings('/tmp')
    if (requested === 'webp' || requested === 'jpeg' || requested === 'png') settings.format = requested

    const raster = sampleRaster()
    const card = await composeRawCard(
      raster,
      { x: 0, y: 0, width: raster.width, height: raster.height },
      composeOptionsFromSettings(settings),
      640
    )
    const buffer = await encodeRaster(
      { data: card.raster.data, width: card.raster.width, height: card.raster.height },
      { format: settings.format, jpegQuality: settings.jpegQuality }
    )
    report.bytes = buffer.byteLength
    report.format = expectedExtension(settings.format)

    const outcome = await uploadShot(buffer, settings.format)
    if (!outcome.ok) {
      report.error = outcome.message
      if (outcome.detail) report.detail = outcome.detail
      report.note = outcome.retryable ? 'the failure looks temporary' : 'the server refused this picture'
      console.log(JSON.stringify(report, null, 2))
      return 1
    }

    report.url = outcome.url
    report.ttl = Math.max(0, outcome.expiresAt - Math.floor(Date.now() / 1000))

    // Fetching it back is the only proof that what was stored is what was sent: a
    // server that answers 201 and writes nothing would pass every check before this.
    try {
      // No `cache` option: this is Node's fetch inside the main process, which has no
      // HTTP cache to bypass. The picture was just written and cannot be stale.
      const fetched = await fetch(outcome.url)
      report.status = fetched.status
      const returned = Buffer.from(await fetched.arrayBuffer())
      report.roundTrip = returned.byteLength === buffer.byteLength && Buffer.compare(returned, buffer) === 0
    } catch (error) {
      report.error = error instanceof Error ? error.message : String(error)
    }

    // And leave nothing behind: a diagnostic that litters the server with a test picture
    // for an hour is worse than no diagnostic.
    try {
      const deleted = await fetch(`${UPLOAD_ENDPOINT}/${outcome.id}`, { method: 'DELETE' })
      report.deleted = deleted.ok
    } catch {
      report.deleted = false
    }

    report.ok = report.roundTrip === true
    if (!report.ok && !report.error) report.error = tr('upload.malformed')
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error)
  }

  console.log(JSON.stringify(report, null, 2))
  return report.ok ? 0 : 1
}
