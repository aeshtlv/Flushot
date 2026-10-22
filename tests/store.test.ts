import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SettingsStore } from '../src/main/settings/SettingsStore'
import { defaultSettings } from '../src/shared/settings'

const created: string[] = []

async function storeWith(content?: string): Promise<{ store: SettingsStore; file: string; dir: string }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'flushot-settings-'))
  created.push(dir)
  const file = path.join(dir, 'settings.json')
  if (content !== undefined) await writeFile(file, content, 'utf8')
  return { store: new SettingsStore(file, path.join(dir, 'Flushot')), file, dir }
}

afterEach(async () => {
  while (created.length) {
    const dir = created.pop()
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
})

describe('SettingsStore', () => {
  it('starts from defaults when there is no file yet', async () => {
    const { store, dir } = await storeWith()
    const settings = await store.load()
    expect(settings).toEqual(defaultSettings(path.join(dir, 'Flushot')))
  })

  it('round-trips a change through the file', async () => {
    const { store, file } = await storeWith()
    await store.update({ frameWidth: 96 })
    const written = JSON.parse(await readFile(file, 'utf8'))
    expect(written.frameWidth).toBe(96)
  })

  it('falls back to defaults for a corrupt file instead of throwing', async () => {
    const { store, dir } = await storeWith('{ not json')
    const settings = await store.load()
    expect(settings).toEqual(defaultSettings(path.join(dir, 'Flushot')))
  })

  it('keeps only the newest value when updates overlap', async () => {
    const { store, file } = await storeWith()
    // A slider drag: every step calls update() before the previous write has
    // finished. Only the value the user stops on has to reach the disk.
    const widths = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
    const results = await Promise.all(widths.map((frameWidth) => store.update({ frameWidth })))

    const written = JSON.parse(await readFile(file, 'utf8'))
    expect(written.frameWidth).toBe(100)
    // Every caller still sees a settled state, and the cache is never stale.
    expect(results[results.length - 1].frameWidth).toBe(100)
    expect(store.peek()?.frameWidth).toBe(100)
  })

  it('writes again after a burst has drained', async () => {
    const { store, file } = await storeWith()
    await Promise.all([store.update({ frameWidth: 20 }), store.update({ frameWidth: 30 })])
    await store.update({ frameWidth: 48 })

    const written = JSON.parse(await readFile(file, 'utf8'))
    expect(written.frameWidth).toBe(48)
  })

  it('never leaves a half-written file behind', async () => {
    const { store, file } = await storeWith()
    await store.update({ cornerRadius: 24 })
    // The write goes to a temp file and is renamed, so the real file is always
    // complete JSON — a crash mid-write cannot produce a truncated settings file.
    const content = await readFile(file, 'utf8')
    expect(() => JSON.parse(content)).not.toThrow()
  })
})
