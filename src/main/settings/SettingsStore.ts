import { promises as fs } from 'node:fs'
import path from 'node:path'
import { sanitizeSettings } from '../../shared/settings'
import type { ScreenshotSettings } from '../../shared/types'

/**
 * Small JSON-backed settings store. Writes atomically (temp file + rename) and
 * recovers from a corrupt file by falling back to defaults.
 *
 * Writes are coalesced: a slider drag produces a settings change per pixel, and
 * writing a file for every one of them is pointless work — only the value the
 * user stops on matters. While a write is in flight the newest snapshot replaces
 * the pending one, so a drag across sixty steps writes twice instead of sixty
 * times, and the last value is always the one on disk.
 */
export class SettingsStore {
  private cache: ScreenshotSettings | null = null
  private pendingWrite: ScreenshotSettings | null = null
  private writer: Promise<void> | null = null
  /** Serialises state changes so a patch is never computed from a stale cache. */
  private applied: Promise<void> = Promise.resolve()
  /** Created once, not on every write. */
  private directoryReady: Promise<void> | null = null

  constructor(
    private readonly filePath: string,
    private readonly defaultDirectory: string
  ) {}

  get path(): string {
    return this.filePath
  }

  async load(): Promise<ScreenshotSettings> {
    if (this.cache) return this.cache
    let raw: unknown = null
    let content = ''
    try {
      content = await fs.readFile(this.filePath, 'utf8')
      raw = JSON.parse(content)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        await this.backupCorruptFile().catch(() => undefined)
      }
    }
    const sanitized = sanitizeSettings(raw, this.defaultDirectory)
    this.cache = sanitized

    // Rewrite the file when cleaning changed anything.
    //
    // Values are repaired on every load, so a bad file can no longer stop the app
    // from starting — but leaving it on disk means the repair is invisible and the
    // file keeps disagreeing with what is running. One write at load makes disk
    // and memory match, and it is skipped entirely for a file that was already
    // valid.
    if (raw !== null && content !== JSON.stringify(sanitized, null, 2)) {
      this.pendingWrite = sanitized
      this.writer ??= this.drain()
    }

    return this.cache
  }

  peek(): ScreenshotSettings | null {
    return this.cache
  }

  async update(patch: Partial<ScreenshotSettings>): Promise<ScreenshotSettings> {
    // The patch is applied in call order: two updates racing on `cache` would
    // otherwise be able to write an older value last. Only the state change is
    // serialised, never the disk write, so a slider drag still coalesces.
    const applied = this.applied.then(async () => {
      const current = await this.load()
      const next = sanitizeSettings({ ...current, ...patch }, this.defaultDirectory)
      this.cache = next
      this.pendingWrite = next
      this.writer ??= this.drain()
      return { next, written: this.writer }
    })
    this.applied = applied.then(
      () => undefined,
      () => undefined
    )
    const { next, written } = await applied
    await written
    return next
  }

  /** Write the newest snapshot, then whatever arrived while writing. */
  private async drain(): Promise<void> {
    try {
      while (this.pendingWrite) {
        const next = this.pendingWrite
        this.pendingWrite = null
        await this.writeAtomically(next)
      }
    } finally {
      this.writer = null
    }
  }

  private async writeAtomically(settings: ScreenshotSettings): Promise<void> {
    this.directoryReady ??= fs.mkdir(path.dirname(this.filePath), { recursive: true }).then(() => undefined)
    await this.directoryReady
    const temp = `${this.filePath}.tmp`
    await fs.writeFile(temp, JSON.stringify(settings, null, 2), 'utf8')
    await fs.rename(temp, this.filePath)
  }

  private async backupCorruptFile(): Promise<void> {
    const backup = `${this.filePath}.corrupt-${Date.now()}`
    await fs.rename(this.filePath, backup)
  }
}
