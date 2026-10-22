/**
 * Drives the hotkey demo on the site the way a visitor would.
 *
 * The page claims the shortcuts can be changed. A claim like that is worth
 * exactly as much as the check behind it, so this clicks «Изменить», sends real
 * key presses through the browser's input pipeline and reads back what the chip
 * shows. It also checks the two things the copy promises: a combination already
 * taken by the other action is refused, and Escape cannot be assigned.
 *
 * Usage: node scripts/test-hotkey-demo.cjs
 */

const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { pathToFileURL } = require('node:url')

const PORT = 9377
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function findEdge() {
  const candidates = [
    path.join(process.env['ProgramFiles'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  ]
  return candidates.find((c) => require('node:fs').existsSync(c))
}

/** Windows virtual key codes for the keys we press. */
const VK = {
  Ctrl: 17,
  Shift: 16,
  Alt: 18,
  F1: 112,
  S: 83,
  K: 75,
  PrintScreen: 44,
  Escape: 27,
  Backspace: 8
}

async function main() {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'flushot-hk-'))
  const edge = spawn(
    findEdge(),
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--hide-scrollbars',
      '--window-size=1440,900',
      'about:blank'
    ],
    { stdio: 'ignore' }
  )

  let ready = false
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) {
        ready = true
        break
      }
    } catch {
      /* not up yet */
    }
    await sleep(120)
  }
  if (!ready) throw new Error('Edge did not start')

  const target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page')
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })

  let id = 1
  const pending = new Map()
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result)
  })
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const myId = id++
      pending.set(myId, { resolve, reject })
      ws.send(JSON.stringify({ id: myId, method, params }))
    })

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Input.setIgnoreInputEvents', { ignore: false })

  const url = pathToFileURL(path.join(process.cwd(), 'site', 'index.html')).href
  await send('Page.navigate', { url })
  await sleep(900)

  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || 'eval failed')
    return result.result.value
  }

  /** Press a combination: modifiers down, key down/up, modifiers up. */
  async function press(parts) {
    const modifiers = parts.filter((p) => ['Ctrl', 'Shift', 'Alt'].includes(p))
    const key = parts.find((p) => !['Ctrl', 'Shift', 'Alt'].includes(p))

    for (const modifier of modifiers) {
      await send('Input.dispatchKeyEvent', {
        type: 'rawKeyDown',
        windowsVirtualKeyCode: VK[modifier],
        code: modifier === 'Ctrl' ? 'ControlLeft' : modifier === 'Shift' ? 'ShiftLeft' : 'AltLeft',
        key: modifier,
        modifiers: modifiers.length ? 8 : 0
      })
    }

    const vk = VK[key] ?? key.charCodeAt(0)
    await send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      windowsVirtualKeyCode: vk,
      code: key.length === 1 ? `Key${key}` : key,
      key: key === 'Escape' ? 'Escape' : key === 'Backspace' ? 'Backspace' : key,
      text: key.length === 1 ? key.toLowerCase() : undefined,
      modifiers: (modifiers.includes('Ctrl') ? 2 : 0) | (modifiers.includes('Shift') ? 8 : 0) | (modifiers.includes('Alt') ? 1 : 0)
    })
    await send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      windowsVirtualKeyCode: vk,
      code: key.length === 1 ? `Key${key}` : key,
      key,
      modifiers: 0
    })

    for (const modifier of modifiers.slice().reverse()) {
      await send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        windowsVirtualKeyCode: VK[modifier],
        code: modifier === 'Ctrl' ? 'ControlLeft' : modifier === 'Shift' ? 'ShiftLeft' : 'AltLeft',
        key: modifier
      })
    }
    await sleep(220)
  }

  const chip = (field) =>
    evaluate(`(() => {
      const el = document.querySelector('.hotkey-keys[data-field="${field}"]');
      return el ? [...el.querySelectorAll('kbd')].map((k) => k.textContent).join('+') : null;
    })()`)

  const status = () =>
    evaluate(`(() => {
      const el = document.querySelector('.hotkeys__status');
      return el ? { text: el.textContent.trim(), tone: el.dataset.tone || '' } : null;
    })()`)

  const clickChange = (field) =>
    evaluate(`(() => {
      const b = document.querySelector('.hotkey-change[data-field="${field}"]');
      if (!b) return false;
      b.click();
      return b.textContent.trim();
    })()`)

  const problems = []
  const record = (label, actual, expected) => {
    const pass = actual === expected
    console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}: ${JSON.stringify(actual)}`)
    if (!pass) problems.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }

  console.log('Defaults')
  record('area chip', await chip('area'), 'Ctrl+Shift+S')
  record('full chip', await chip('full'), 'Ctrl+Shift+3')

  console.log('\nRebind the area shortcut to Ctrl+K')
  record('button enters capture mode', await clickChange('area'), 'Нажмите…')
  await press(['Ctrl', 'K'])
  record('area chip', await chip('area'), 'Ctrl+K')
  record('button leaves capture mode', await evaluate(`document.querySelector('.hotkey-change[data-field="area"]').textContent.trim()`), 'Изменить')
  const afterRebind = await status()
  record('status tone', afterRebind.tone, 'ok')

  console.log('\nA single key with no modifiers is allowed')
  await clickChange('full')
  await press(['F1'])
  record('full chip', await chip('full'), 'F1')

  console.log('\nThe two shortcuts cannot collide')
  await clickChange('full')
  await press(['Ctrl', 'K'])
  record('full chip unchanged', await chip('full'), 'F1')
  const conflict = await status()
  record('conflict is explained', conflict.tone, 'warn')
  record('conflict names the other action', conflict.text.includes('области'), true)
  await press(['Escape'])

  console.log('\nEscape cannot be assigned')
  await clickChange('full')
  await press(['Ctrl', 'Escape'])
  record('full chip unchanged', await chip('full'), 'F1')
  await press(['Escape'])

  console.log('\nBackspace restores the default')
  await clickChange('area')
  await press(['Backspace'])
  record('area chip', await chip('area'), 'Ctrl+Shift+S')
  record('restore tone', (await status()).tone, 'ok')

  console.log('\nEscape abandons a change in progress')
  await clickChange('area')
  await press(['Escape'])
  record('area chip still default', await chip('area'), 'Ctrl+Shift+S')
  record('capture mode ended', await evaluate(`document.querySelector('.hotkey-change[data-field="area"]').textContent.trim()`), 'Изменить')

  console.log('\nCtrl+Escape is refused with a reason')
  await clickChange('area')
  await press(['Ctrl', 'Escape'])
  const escapeRefusal = await status()
  record('escape tone', escapeRefusal.tone, 'warn')
  record('escape reason mentions Windows', escapeRefusal.text.includes('Windows'), true)
  record('still listening after the refusal', await evaluate(`document.querySelector('.hotkey-change[data-field="area"]').textContent.trim()`), 'Нажмите…')
  record('chip unchanged', await chip('area'), 'Ctrl+Shift+S')
  await press(['Escape'])
  record('bare Escape leaves capture mode', await evaluate(`document.querySelector('.hotkey-change[data-field="area"]').textContent.trim()`), 'Изменить')

  console.log('\nStatus colours meet WCAG AA')
  for (const theme of ['light', 'dark']) {
    await evaluate(`document.documentElement.dataset.theme = '${theme}'`)
    await sleep(120)
    const contrast = await evaluate(`(() => {
      const parse = (c) => c.match(/[\\d.]+/g).slice(0, 3).map(Number);
      const lum = (rgb) => {
        const [r, g, b] = rgb.map((v) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const el = document.querySelector('.hotkeys__status');
      const style = getComputedStyle(el);
      const fg = parse(style.color);
      // Walk up until a non-transparent background is found.
      let node = el, bg = null;
      while (node && !bg) {
        const c = getComputedStyle(node).backgroundColor;
        if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') bg = parse(c);
        node = node.parentElement;
      }
      const a = lum(fg), b = lum(bg || [255, 255, 255]);
      return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100;
    })()`)
    const ok = contrast >= 4.5
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${theme}: status text contrast ${contrast}:1`)
    if (!ok) problems.push(`${theme} status contrast ${contrast}:1 is below 4.5`)
  }

  ws.close()
  edge.kill()
  await fs.rm(profile, { recursive: true, force: true }).catch(() => {})

  if (problems.length) {
    console.error(`\n${problems.length} PROBLEM(S):`)
    for (const problem of problems) console.error(`  ✗ ${problem}`)
    process.exitCode = 1
  } else {
    console.log('\nHotkey demo behaves as advertised.')
  }
}

main().catch((error) => {
  console.error('FAILED', error)
  process.exit(1)
})
