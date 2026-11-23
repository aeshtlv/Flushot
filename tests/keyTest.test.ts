import { describe, expect, it } from 'vitest'
import { describeKeyTest, type KeyTestResult } from '../src/main/hotkeys/testKey'

/**
 * The wording of the key test's answer.
 *
 * Three outcomes, and they call for three different actions from the user: pick another key,
 * find what is eating this one, or nothing. Getting the wording wrong is not cosmetic — it
 * sends someone to the wrong fix, which is what happened with "занята другой программой" being
 * shown for a key that was free but swallowed.
 *
 * `describeKeyTest` is the pure half: the registration and the wait need a live Electron, the
 * mapping from a result to an answer does not.
 */
const base: Omit<KeyTestResult, 'registered' | 'received'> = { combo: 'Ctrl + Alt + K', seconds: 0 }

describe('describeKeyTest', () => {
  it('says the key works when a press arrived', () => {
    const answer = describeKeyTest({ ...base, registered: true, received: true })
    expect(answer.tone).toBe('ok')
    expect(answer.text).toContain('Ctrl + Alt + K')
  })

  it('says the key could not be taken when registration failed', () => {
    const answer = describeKeyTest({ ...base, registered: false, received: false })
    expect(answer.tone).toBe('warn')
    // It must not claim the press was swallowed: nothing was ever registered, so there was no
    // press to swallow, and the fix is a different key.
    expect(answer.text).not.toContain('не дошла')
  })

  it('says the press did not arrive when the key registered but stayed silent', () => {
    const answer = describeKeyTest({ ...base, registered: true, received: false, seconds: 5 })
    expect(answer.tone).toBe('warn')
    expect(answer.text).toContain('5')
  })

  it('distinguishes the two warnings from each other', () => {
    // The whole point of the feature: "taken" and "swallowed" are different problems with
    // different fixes, and one message for both is what the user was complaining about.
    const taken = describeKeyTest({ ...base, registered: false, received: false })
    const swallowed = describeKeyTest({ ...base, registered: true, received: false, seconds: 5 })
    expect(taken.text).not.toBe(swallowed.text)
  })

  it('uses the combination it was given, formatted', () => {
    const answer = describeKeyTest({ combo: 'PrintScreen', registered: true, received: true, seconds: 0 })
    expect(answer.text).toContain('PrintScreen')
  })
})
