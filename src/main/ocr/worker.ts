/**
 * Text recognition through the OCR engine that ships with Windows.
 *
 * Why this and not a bundled model: `Windows.Media.Ocr` is part of the operating
 * system, already installed, already trained for the language packs the user has,
 * and costs the application zero megabytes. Tesseract would add a native module
 * plus a 10–30 MB language file per language; a cloud service would add an
 * account, a network round trip and a privacy problem — the picture is the user's
 * screen and must not leave the machine.
 *
 * The engine is reachable only through WinRT, which Node cannot call, so a small
 * PowerShell worker does it. The worker starts once, keeps the WinRT types loaded
 * and answers one JSON line per request: a fresh process per picture costs
 * ~700 ms, a warm one ~130 ms.
 *
 * Every installed recognizer is used, not just the one Windows picks for the user.
 * One engine reads one script well and mangles the other, and a real screen has
 * both: Russian interface, English code. Running two engines costs about 100 ms
 * more and lets `merge.ts` choose per line, which is the only way to get both
 * halves right.
 *
 * Verified on this machine: `AvailableRecognizerLanguages` reports `ru` and
 * `en-US`, `MaxImageDimension` is 10000, and the profile engine is `ru`.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { OcrLine, OcrWord } from '../../shared/types'

export type { OcrLine, OcrWord }

/** One engine's reading of the picture. */
export interface OcrRawResult {
  /** Language tag of the engine, e.g. `ru`. */
  lang: string
  /**
   * Which preparation of the picture produced this reading, when more than one was
   * used. Absent for a single reading.
   *
   * The same engine reading two differently prepared copies of one line gives two
   * independent opinions, and `merge.ts` treats them as such — but they are still
   * the same language, so the script of the reading comes from `lang`, not from here.
   */
  variant?: string
  lines: OcrLine[]
}

/** What the worker answers for one picture: every engine's reading. */
export interface OcrRawOutcome {
  ok: boolean
  results: OcrRawResult[]
  error?: string
}

/**
 * The worker script.
 *
 * Deliberately free of backticks and non-ASCII: it travels as a base64 command
 * line, and there is nothing to gain by making the PowerShell parser work harder
 * than it must.
 */
const WORKER_SCRIPT = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Send($payload) {
  [Console]::Out.WriteLine(($payload | ConvertTo-Json -Depth 8 -Compress))
  [Console]::Out.Flush()
}

function Await($operation, $resultType) {
  $task = $asTask.MakeGenericMethod($resultType).Invoke($null, @($operation))
  $task.Wait(-1) | Out-Null
  $task.Result
}

try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null
  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -like 'IAsyncOperation*'
  })[0]
  if (-not $asTask) { throw 'no-async-bridge' }

  $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
  $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
  $null = [Windows.Storage.StorageFile, Windows.Foundation, ContentType = WindowsRuntime]
  $null = [Windows.Globalization.Language, Windows.Foundation, ContentType = WindowsRuntime]

  # One engine per installed recognizer, built once and kept for the life of the
  # process: constructing them per request costs more than the recognition.
  $engines = @{}
  $tags = @()
  $profile = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
  if ($profile) {
    $tag = $profile.RecognizerLanguage.LanguageTag
    $engines[$tag] = $profile
    $tags += $tag
  }
  foreach ($language in [Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages) {
    $tag = $language.LanguageTag
    if ($engines.ContainsKey($tag)) { continue }
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($language)
    if ($engine) {
      $engines[$tag] = $engine
      $tags += $tag
    }
  }
  if ($tags.Count -eq 0) {
    Send @{ ready = $false; error = 'no-language' }
    exit 3
  }
  Send @{ ready = $true; langs = $tags; maxSide = [Windows.Media.Ocr.OcrEngine]::MaxImageDimension }
} catch {
  Send @{ ready = $false; error = $_.Exception.Message }
  exit 2
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $line = $line.Trim()
  if ($line -eq '') { continue }

  $request = $null
  try {
    $request = $line | ConvertFrom-Json
    $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($request.path)) ([Windows.Storage.StorageFile])

    $results = @()
    foreach ($tag in $request.langs) {
      $engine = $engines[$tag]
      if (-not $engine) { continue }
      # A fresh stream per engine: the decoder consumes it, and a second engine
      # reading a disposed stream would fail.
      $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
      $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
      $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
      $recognized = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
      $stream.Dispose()

      $lines = @()
      foreach ($item in $recognized.Lines) {
        $words = @()
        foreach ($word in $item.Words) {
          $rect = $word.BoundingRect
          $words += @{
            t = $word.Text
            x = [int][math]::Round($rect.X)
            y = [int][math]::Round($rect.Y)
            w = [int][math]::Round($rect.Width)
            h = [int][math]::Round($rect.Height)
          }
        }
        $lines += @{ text = $item.Text; words = $words }
      }
      $results += @{ lang = $tag; lines = $lines }
    }
    Send @{ id = $request.id; ok = $true; results = $results }
  } catch {
    $id = 0
    if ($request -and $request.id) { $id = $request.id }
    Send @{ id = $id; ok = $false; error = $_.Exception.Message }
  }
}
`

/** PowerShell, base64 of UTF-16LE, so no temporary script file is needed. */
const ENCODED_SCRIPT = Buffer.from(WORKER_SCRIPT, 'utf16le').toString('base64')

const POWERSHELL = 'powershell.exe'
/** How long the worker stays alive after its last request. */
const IDLE_MS = 25_000
const READY_TIMEOUT_MS = 15_000
/** Every engine on a 20 MP picture, so generous: three engines can take seconds. */
const REQUEST_TIMEOUT_MS = 45_000

interface Pending {
  resolve: (value: OcrRawOutcome) => void
  timer: NodeJS.Timeout
}

class OcrWorker {
  private child: ChildProcessWithoutNullStreams | null = null
  private ready: Promise<string[] | null> | null = null
  private buffer = ''
  private nextId = 1
  private pending = new Map<number, Pending>()
  private idle: NodeJS.Timeout | null = null

  /**
   * Start the worker if it is not running and wait until the engines report their
   * languages. Resolves `null` when no engine is available, which is not an error
   * worth showing before the user has asked for text.
   */
  warm(): Promise<string[] | null> {
    if (this.ready) return this.ready
    this.ready = this.start()
    return this.ready
  }

  private start(): Promise<string[] | null> {
    return new Promise<string[] | null>((resolve) => {
      let settled = false
      const finish = (value: string[] | null): void => {
        if (settled) return
        settled = true
        resolve(value)
      }

      let child: ChildProcessWithoutNullStreams
      try {
        child = spawn(
          POWERSHELL,
          ['-NoProfile', '-NonInteractive', '-NoLogo', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', ENCODED_SCRIPT],
          { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
        )
      } catch {
        this.ready = null
        finish(null)
        return
      }

      this.child = child
      const timer = setTimeout(() => finish(null), READY_TIMEOUT_MS)
      timer.unref?.()

      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        this.buffer += chunk
        let index = this.buffer.indexOf('\n')
        while (index >= 0) {
          const line = this.buffer.slice(0, index).trim()
          this.buffer = this.buffer.slice(index + 1)
          if (line) this.handleLine(line, finish)
          index = this.buffer.indexOf('\n')
        }
      })

      // stderr carries diagnostics only; a failed engine reports through stdout.
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', () => undefined)

      child.on('exit', () => {
        clearTimeout(timer)
        this.child = null
        this.ready = null
        this.failAll('Распознавание текста недоступно на этом компьютере')
        finish(null)
      })
      child.on('error', () => {
        clearTimeout(timer)
        this.child = null
        this.ready = null
        finish(null)
      })
    })
  }

  private handleLine(line: string, finish: (value: string[] | null) => void): void {
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(line) as Record<string, unknown>
    } catch {
      return
    }
    if (typeof parsed.ready === 'boolean') {
      const langs = Array.isArray(parsed.langs) ? parsed.langs.map((tag) => String(tag)).filter(Boolean) : []
      finish(parsed.ready && langs.length > 0 ? langs : null)
      return
    }
    const id = Number(parsed.id)
    const pending = this.pending.get(id)
    if (!pending) return
    this.pending.delete(id)
    clearTimeout(pending.timer)
    pending.resolve(toOutcome(parsed))
  }

  private failAll(reason: string): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.resolve({ ok: false, results: [], error: reason })
    }
    this.pending.clear()
  }

  private touch(): void {
    if (this.idle) clearTimeout(this.idle)
    this.idle = setTimeout(() => this.stop(), IDLE_MS)
    // The worker must never keep the application alive on its own.
    this.idle.unref?.()
  }

  /** Recognize the picture at `path` with each of `langs`. The file is read, not copied. */
  async recognize(path: string, langs: string[]): Promise<OcrRawOutcome> {
    const available = await this.warm()
    if (!available || !this.child) {
      return { ok: false, results: [], error: 'Распознавание текста недоступно на этом компьютере' }
    }
    const wanted = langs.filter((tag) => available.includes(tag))
    if (wanted.length === 0) return { ok: false, results: [], error: 'Ни одного движка распознавания нет' }

    const id = this.nextId++
    const answer = new Promise<OcrRawOutcome>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        resolve({ ok: false, results: [], error: 'Распознавание не ответило вовремя' })
      }, REQUEST_TIMEOUT_MS)
      timer.unref?.()
      this.pending.set(id, { resolve, timer })
    })
    this.child.stdin.write(`${JSON.stringify({ id, path, langs: wanted })}\n`)
    this.touch()
    return answer
  }

  stop(): void {
    if (this.idle) {
      clearTimeout(this.idle)
      this.idle = null
    }
    this.ready = null
    const child = this.child
    this.child = null
    this.failAll('Распознавание остановлено')
    if (!child) return
    try {
      child.stdin.end()
      child.kill()
    } catch {
      // Already gone.
    }
  }
}

/** Turn one worker answer into typed lines, ignoring anything malformed. */
function toOutcome(parsed: Record<string, unknown>): OcrRawOutcome {
  if (parsed.ok !== true) {
    return { ok: false, results: [], error: String(parsed.error ?? 'Распознать текст не удалось') }
  }
  const rawResults = Array.isArray(parsed.results) ? parsed.results : parsed.results ? [parsed.results] : []
  const results: OcrRawResult[] = []
  for (const raw of rawResults) {
    const record = raw as { lang?: unknown; lines?: unknown }
    const lang = typeof record.lang === 'string' ? record.lang : ''
    if (!lang) continue
    const rawLines = Array.isArray(record.lines) ? record.lines : record.lines ? [record.lines] : []
    const lines: OcrLine[] = []
    for (const item of rawLines) {
      const line = item as { text?: unknown; words?: unknown }
      const text = typeof line.text === 'string' ? line.text : ''
      if (!text) continue
      const wordsRaw = Array.isArray(line.words) ? line.words : line.words ? [line.words] : []
      const words: OcrWord[] = []
      for (const word of wordsRaw) {
        const w = word as { t?: unknown; x?: unknown; y?: unknown; w?: unknown; h?: unknown }
        if (typeof w.t !== 'string') continue
        words.push({
          text: w.t,
          x: Number(w.x) || 0,
          y: Number(w.y) || 0,
          width: Number(w.w) || 0,
          height: Number(w.h) || 0
        })
      }
      lines.push({ text, words })
    }
    results.push({ lang, lines })
  }
  return { ok: true, results }
}

let worker: OcrWorker | null = null

function current(): OcrWorker {
  if (!worker) worker = new OcrWorker()
  return worker
}

/** Start the engines ahead of the first request. Failures are silent by design. */
export function warmOcr(): Promise<string[] | null> {
  return current().warm()
}

/** Every installed recognizer, in the order Windows prefers them. */
export function ocrLanguages(): Promise<string[] | null> {
  return current().warm()
}

export function recognizeRaw(path: string, langs: string[]): Promise<OcrRawOutcome> {
  return current().recognize(path, langs)
}

export function stopOcr(): void {
  worker?.stop()
  worker = null
}

/** Whether the PowerShell worker can be started at all. */
export function isOcrSupported(): boolean {
  return (
    process.platform === 'win32' &&
    existsSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
  )
}
