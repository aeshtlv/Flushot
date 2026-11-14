import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { checkUpdates, updateState, type UpdateState } from './updater'
import type { ManualInstall } from '../../shared/types'

/**
 * A one-shot update check from the command line.
 *
 * `Flushot.exe --update-check` asks GitHub for a newer release, waits for the answer
 * and prints it as JSON. Without it the only way to see what the updater thinks is
 * to watch the tray for a day, which is no way to support a machine where updates
 * "do not work": the answer is usually a proxy, a blocked host, or a build that was
 * unpacked from a zip and can never replace itself.
 *
 * `--update-feed=<url>` points the check at a plain directory served over HTTP
 * instead of GitHub. That is how the update path is tested without publishing two
 * releases, and it is also the escape hatch if releases ever move off GitHub.
 */

const TERMINAL: UpdateState['kind'][] = ['current', 'ready', 'failed', 'manual', 'off']

function feedOverride(argv: string[]): string | null {
  const argument = argv.find((value) => value.startsWith('--update-feed='))
  if (!argument) return null
  const url = argument.slice('--update-feed='.length).trim()
  return url.length > 0 ? url : null
}

function describe(state: UpdateState): Record<string, unknown> {
  return { ...state } as Record<string, unknown>
}

export interface SettleOptions {
  /** Read the current state. Called every tick. */
  read: () => UpdateState
  /** How long the state may stay identical before it is treated as hung. */
  stallMs: number
  /** Injectable so a test can run a simulated half-hour in a millisecond. */
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  intervalMs?: number
}

/**
 * Wait for the state to settle, judging by movement rather than by the clock.
 *
 * A download of a hundred megabytes takes as long as the line takes, and a fixed
 * cap turned a working update into `ok: false` at 88 % on a slow connection — the
 * first real update this project ever performed was reported as broken while it was
 * downloading correctly. Every change of percentages buys another `stallMs`; only a
 * state that stops moving for that long is treated as hung.
 */
export async function waitForTerminal(options: SettleOptions): Promise<UpdateState> {
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const intervalMs = options.intervalMs ?? 250

  // The first answer can take a while on a cold DNS cache; nothing has moved yet,
  // so the clock starts with a grace period of its own.
  let movedAt = now()
  let previous: string | null = null
  let last = options.read()

  while (now() < movedAt + options.stallMs) {
    last = options.read()
    if (TERMINAL.includes(last.kind)) return last
    const snapshot = JSON.stringify(last)
    if (snapshot !== previous) {
      previous = snapshot
      movedAt = now()
    }
    await sleep(intervalMs)
  }
  return last
}

export async function runUpdateCheck(argv: string[]): Promise<number> {
  const feed = feedOverride(argv)
  const before = updateState()
  if (before.kind === 'manual') {
    console.log(
      JSON.stringify(
        {
          ok: false,
          reason: `this build cannot update itself (${(before as { install: ManualInstall }).install})`,
          hint: 'install with Flushot-<version>-x64.exe; the portable and zip builds are updated by hand',
          state: describe(before)
        },
        null,
        2
      )
    )
    return 2
  }

  if (feed) {
    // A generic feed is a folder over HTTP: `latest.yml` plus the installer beside
    // it, which is exactly what a static host would serve.
    autoUpdater.setFeedURL({ provider: 'generic', url: feed })
  }

  void checkUpdates(true)
  // Long enough for an unreachable host to time out, short enough that a propped
  // open terminal is not left waiting: this is a *stall*, not a total budget.
  const final = await waitForTerminal({ read: updateState, stallMs: feed ? 90_000 : 60_000 })
  const ok = final.kind === 'current' || final.kind === 'ready'

  console.log(
    JSON.stringify(
      {
        ok,
        feed: feed ?? 'github',
        version: app.getVersion(),
        state: describe(final)
      },
      null,
      2
    )
  )
  return ok ? 0 : 1
}
