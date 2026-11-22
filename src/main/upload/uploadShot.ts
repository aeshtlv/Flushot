import { net } from 'electron'
import { tr } from '../i18n'

/** Where the endpoint lives. One constant, so a move is one edit. */
export const UPLOAD_ENDPOINT = 'https://flushot.ink/api/shot'

/** The host reported to the user when the upload fails, for a readable message. */
export const UPLOAD_HOST = 'flushot.ink'

/**
 * What the server said about an uploaded picture.
 *
 * `url` is the whole point: it is what goes on the clipboard. `expiresAt` is a Unix
 * timestamp in seconds, kept because the notification tells the user when the link
 * stops working — an "expires in an hour" that is measured on our side and a link
 * that dies on the server's side would drift apart otherwise.
 */
export interface UploadSuccess {
  ok: true
  url: string
  id: string
  /** `png`, `jpg` or `webp`: decided by the server from the bytes, not by us. */
  format: string
  bytes: number
  expiresAt: number
}

export interface UploadFailure {
  ok: false
  message: string
  /**
   * Whether trying again in a minute could plausibly work.
   *
   * A refused body or a wrong content type is permanent — the same picture will be
   * refused the same way — while no signal, a timeout and a 503 are not. The caller
   * uses this to decide whether to offer a retry.
   */
  retryable: boolean
  /**
   * The underlying cause, when there is one.
   *
   * Never shown in a notification: it is a stack-level detail. It exists for the log
   * and for `--upload-check`, where "could not reach the server" alone would send
   * someone looking at the wrong thing.
   */
  detail?: string
}

export type UploadOutcome = UploadSuccess | UploadFailure

/**
 * How long to wait before giving up.
 *
 * A 2 MB card took 4.8 s on a normal home connection, so this is not a generous number
 * for the usual case — it is the point at which a weak mobile line has still failed.
 * The nginx side allows 120 s, deliberately longer, so the client gives up first and
 * the message the user sees is ours rather than a dropped connection.
 */
const TIMEOUT_MS = 90_000

/**
 * The extension the server is expected to choose for a given setting.
 *
 * Only used for the label shown while uploading. The real name comes back in the
 * response, because the server looks at the bytes: a build configured for PNG that
 * somehow produced a WebP would be stored as `.webp` regardless of what this says.
 */
export function expectedExtension(format: string): string {
  if (format === 'webp') return 'webp'
  if (format === 'jpeg') return 'jpg'
  return 'png'
}

/**
 * Send the finished picture and get a link back.
 *
 * `net.fetch` rather than the global one on purpose: it goes through Chromium's
 * network stack, so a system proxy or a corporate TLS inspection that the user has
 * already configured is respected without asking them to configure it twice. The
 * updater has the same problem and the same answer.
 *
 * Nothing here retries. A retry doubles the chance of two links for one picture, and
 * the failure is shown to the user, who can decide.
 */
export async function uploadShot(buffer: Buffer, format: string): Promise<UploadOutcome> {
  const contentType = format === 'webp' ? 'image/webp' : format === 'jpeg' ? 'image/jpeg' : 'image/png'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const response = await net.fetch(UPLOAD_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        // Names the caller, so a request in a log is attributable to the program and
        // not to a browser extension that copied the address.
        'User-Agent': 'Flushot-upload'
        // No Content-Length: it is a forbidden header name in the fetch standard and
        // Chromium fails the whole request with net::ERR_INVALID_ARGUMENT instead of
        // ignoring it. The length is taken from the body, which is a Uint8Array and
        // therefore a valid body for both this and the browser's own fetch.
      },
      body: buffer,
      signal: controller.signal
    })

    if (response.status === 201) {
      const payload = (await response.json()) as Partial<UploadSuccess>
      if (!payload.url || !payload.id) {
        return { ok: false, message: tr('upload.malformed'), retryable: true }
      }
      return {
        ok: true,
        url: payload.url,
        id: payload.id,
        format: payload.format ?? expectedExtension(format),
        bytes: payload.bytes ?? buffer.byteLength,
        expiresAt: payload.expiresAt ?? Math.floor(Date.now() / 1000) + 3600
      }
    }

    if (response.status === 413) {
      return { ok: false, message: tr('upload.tooBig'), retryable: false }
    }
    if (response.status === 415) {
      return { ok: false, message: tr('upload.wrongType'), retryable: false }
    }
    if (response.status === 429) {
      return { ok: false, message: tr('upload.tooOften'), retryable: true }
    }
    if (response.status === 503) {
      return { ok: false, message: tr('upload.busy'), retryable: true }
    }
    return { ok: false, message: tr('upload.serverError', { status: response.status }), retryable: true }
  } catch (error) {
    // An abort is ours and has a distinct message; anything else is the network.
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, message: tr('upload.timeout'), retryable: true }
    }
    // The user gets the readable sentence, and the cause is kept for the log and for
    // `--upload-check`: "could not reach the server" is not a diagnosis.
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    console.warn(tr('upload.offline'), detail)
    return { ok: false, message: tr('upload.offline'), retryable: true, detail }
  } finally {
    clearTimeout(timer)
  }
}
