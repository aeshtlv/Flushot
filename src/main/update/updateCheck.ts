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

/**
 * Wait for the state to settle.
 *
 * A download of ninety megabytes takes as long as it takes, so this polls instead of
 * sleeping a fixed amount: a fixed wait would either be slow on a fast line or wrong
 * on a slow one.
 */
async function waitForTerminal(timeoutMs: number): Promise<UpdateState> {
  const started = Date.now()
  let last: UpdateState = updateState()
  while (Date.now() - started < timeoutMs) {
    last = updateState()
    if (TERMINAL.includes(last.kind)) return last
    await new Promise((resolve) => setTimeout(resolve, 250))
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
  const final = await waitForTerminal(feed ? 240_000 : 120_000)
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
