import { describe, expect, it } from 'vitest'
import { waitForTerminal } from '../src/main/update/updateCheck'
import type { UpdateState } from '../src/shared/types'

/**
 * A scripted clock and a scripted updater.
 *
 * The bug this guards against shipped in 2.4.1 and was found by running the command
 * against a real release: the check waited a fixed 120 seconds, the download needed
 * 226, and a working update was reported as `ok: false` at 88 % with exit code 1.
 * Nothing in the suite could have caught it, because the loop had no seam.
 */

type Step = { at: number; state: UpdateState }

/**
 * Run the loop against a clock that only moves when the loop sleeps, so a simulated
 * five minutes costs nothing.
 *
 * `read` advances through the script as the clock passes each step: a test says "at
 * twenty seconds it was 40 %" and that is exactly what the loop sees at twenty
 * seconds.
 */
async function drive(steps: Step[], stallMs: number): Promise<{ state: UpdateState; elapsed: number }> {
  let clock = 0
  let index = 0
  let current: UpdateState = { kind: 'idle' }

  const state = await waitForTerminal({
    read: () => {
      while (index < steps.length && steps[index].at <= clock) {
        current = steps[index].state
        index += 1
      }
      return current
    },
    stallMs,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms
    },
    intervalMs: 250
  })

  return { state, elapsed: clock }
}

describe('waitForTerminal', () => {
  it('returns at once on a terminal state', async () => {
    const result = await drive([{ at: 0, state: { kind: 'current', version: '2.4.2', checkedAt: 0 } }], 60_000)
    expect(result.state.kind).toBe('current')
    expect(result.elapsed).toBe(0)
  })

  it('keeps waiting through a download that outlasts a fixed cap', async () => {
    // Ten percent every twenty seconds is a hundred-megabyte download on a slow
    // line: two hundred seconds in total, which is about what the real one took.
    const steps: Step[] = []
    for (let index = 1; index <= 9; index++) {
      steps.push({
        at: (index - 1) * 20_000,
        state: { kind: 'downloading', version: '9.9.9', percent: index * 10 }
      })
    }
    steps.push({ at: 200_000, state: { kind: 'ready', version: '9.9.9' } })

    const result = await drive(steps, 60_000)
    expect(result.state).toEqual({ kind: 'ready', version: '9.9.9' })
    // Past the old fixed cap, which is exactly what used to fail.
    expect(result.elapsed).toBeGreaterThan(120_000)
    expect(result.elapsed).toBeGreaterThanOrEqual(200_000)
  })

  it('gives up on a download that stops moving', async () => {
    const steps: Step[] = [
      { at: 0, state: { kind: 'downloading', version: '9.9.9', percent: 40 } },
      { at: 20_000, state: { kind: 'downloading', version: '9.9.9', percent: 41 } }
    ]
    const result = await drive(steps, 60_000)
    expect(result.state).toEqual({ kind: 'downloading', version: '9.9.9', percent: 41 })
    // Twenty seconds of movement, then a minute of nothing.
    expect(result.elapsed).toBeGreaterThanOrEqual(80_000)
    expect(result.elapsed).toBeLessThan(85_000)
  })

  it('does not treat a repeated percentage as progress', async () => {
    // `percent` can stay put for several ticks while bytes are being checked.
    const steps: Step[] = [
      { at: 0, state: { kind: 'downloading', version: '9.9.9', percent: 50 } },
      { at: 100_000, state: { kind: 'downloading', version: '9.9.9', percent: 50 } }
    ]
    const result = await drive(steps, 60_000)
    expect((result.state as { percent: number }).percent).toBe(50)
    expect(result.elapsed).toBeLessThan(65_000)
  })

  it('survives a state that never leaves idle', async () => {
    const result = await drive([{ at: 0, state: { kind: 'idle' } }], 30_000)
    expect(result.state.kind).toBe('idle')
    expect(result.elapsed).toBeGreaterThanOrEqual(30_000)
  })
})
