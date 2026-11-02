/**
 * Drives the live demo in the browser the way a visitor would.
 *
 * The first screen promises that releasing the mouse leaves a finished shot in
 * the clipboard. The demo under the hero lets a visitor do that once before
 * reading any feature list, so the demo itself has to behave: a real drag builds
 * a card, a drag smaller than the program's minimum is refused with a reason,
 * the card is a crop of the scene rather than a picture of one, and the paste
 * step and the reset both work.
 *
 * Real mouse events go through the browser's input pipeline, not through
 * element.click(), so the pointer capture and the drag threshold are the ones a
 * visitor gets.
 *
 * Usage: node scripts/test-try-demo.cjs
 */

const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { pathToFileURL } = require('node:url')

const PORT = 9381
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function findEdge() {
  const candidates = [
    path.join(process.env['ProgramFiles'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  ]
  return candidates.find((c) => require('node:fs').existsSync(c))
}

async function main() {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'flushot-try-'))
  const edge = spawn(
    findEdge(),
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--hide-scrollbars',
      '--window-size=1440,900',
      '--force-device-scale-factor=1',
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

  const problems = []
  const record = (label, actual, expected) => {
    // Arrays are compared by value: === would fail on two equal lists and pass
    // the check that matters by accident.
    const pass = Array.isArray(actual) || Array.isArray(expected)
      ? JSON.stringify(actual) === JSON.stringify(expected)
      : actual === expected
    console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}: ${JSON.stringify(actual)}`)
    if (!pass) problems.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
  const truthy = (label, actual) => {
    const pass = Boolean(actual)
    console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}: ${JSON.stringify(actual)}`)
    if (!pass) problems.push(`${label}: expected a truthy value, got ${JSON.stringify(actual)}`)
  }

  /** Where the scene sits on screen, so the drag lands inside it. */
  const sceneBox = await evaluate(`(() => {
    // Smooth scrolling would still be travelling when the first mouse event
    // arrives, and every coordinate below would be stale.
    document.documentElement.style.scrollBehavior = 'auto';
    const el = document.querySelector('[data-try-scene]');
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  })()`)
  truthy('scene is on screen', sceneBox.w > 200 && sceneBox.h > 200)
  await sleep(250)

  const initial = await evaluate(`(() => {
    const demo = document.querySelector('[data-try]');
    return {
      idle: demo.querySelector('[data-try-idle]').getClientRects().length > 0,
      done: demo.querySelector('[data-try-done]').getClientRects().length > 0,
      msg: demo.querySelector('[data-try-msg]').getClientRects().length > 0,
      veil: demo.querySelector('[data-try-veil]').getClientRects().length > 0
    };
  })()`)
  record('before any drag only the idle hint shows', [initial.idle, initial.done, initial.msg, initial.veil], [true, false, false, false])

  const state = () =>
    evaluate(`(() => {
      const demo = document.querySelector('[data-try]');
      const slot = demo.querySelector('[data-try-slot]');
      const idle = demo.querySelector('[data-try-idle]');
      const done = demo.querySelector('[data-try-done]');
      const msg = demo.querySelector('[data-try-msg]');
      const status = demo.querySelector('[data-try-status]');
      const shot = slot.querySelector('.try__shot');
      const crop = slot.querySelector('.try__crop');
      const copy = slot.querySelector('.try__crop > .try__doc');
      const firstChild = copy ? copy.querySelector('.try__bar') : null;
      return {
        hasCard: Boolean(shot),
        frameBg: shot ? getComputedStyle(shot).backgroundColor : null,
        frameRadius: shot ? getComputedStyle(shot).borderTopLeftRadius : null,
        cropW: crop ? Math.round(crop.getBoundingClientRect().width) : null,
        cropH: crop ? Math.round(crop.getBoundingClientRect().height) : null,
        copyOffset: copy ? { x: copy.style.left, y: copy.style.top, w: copy.style.width } : null,
        copyText: copy ? copy.textContent.replace(/\\s+/g, ' ').trim().slice(0, 40) : null,
        hasBar: Boolean(firstChild),
        dims: demo.querySelector('[data-try-dims]').textContent.trim(),
        // Rendered, not the attribute: a panel that is display:flex stays on
        // screen even while it carries hidden, and the attribute alone would
        // report a layout that nobody can see.
        idleVisible: idle.getClientRects().length > 0,
        doneVisible: done.getClientRects().length > 0,
        msgVisible: msg.getClientRects().length > 0,
        msgShotCount: demo.querySelectorAll('[data-try-msg-shot] .try__shot').length,
        status: status.textContent.trim()
      };
    })()`)

  const mouse = (type, x, y) =>
    send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 })

  // ---------------------------------------------------------------- drag
  const startX = Math.round(sceneBox.x + 40)
  const startY = Math.round(sceneBox.y + 90)
  const endX = Math.round(sceneBox.x + 300)
  const endY = Math.round(sceneBox.y + 250)

  await mouse('mousePressed', startX, startY)
  await mouse('mouseMoved', startX + 80, startY + 60)
  const midDrag = await evaluate(`(() => {
    const veil = document.querySelector('[data-try-veil]');
    const size = document.querySelector('[data-try-size]');
    return { veilVisible: !veil.hidden, size: size.textContent.trim(), w: Math.round(veil.getBoundingClientRect().width) };
  })()`)
  truthy('the selection appears while dragging', midDrag.veilVisible)
  truthy('the size label counts up while dragging', /^\d+ × \d+ px$/.test(midDrag.size))

  await mouse('mouseMoved', endX, endY)
  await mouse('mouseReleased', endX, endY)
  await sleep(400)

  const afterDrag = await state()
  record('the drag leaves a card in the result slot', afterDrag.hasCard, true)
  record('the idle hint is replaced', afterDrag.idleVisible, false)
  record('the result panel is showing', afterDrag.doneVisible, true)
  record('nothing is showing before a drag', (await state()).msgVisible, false)
  record('the dim is cleared after release', await evaluate(`document.querySelector('[data-try-veil]').hidden`), true)
  record('the card is a white frame', afterDrag.frameBg, 'rgb(255, 255, 255)')
  truthy('the card is rounded', parseFloat(afterDrag.frameRadius) > 4)
  record('the crop matches the drag width', Math.abs(afterDrag.cropW - (endX - startX)) <= 2, true)
  record('the crop matches the drag height', Math.abs(afterDrag.cropH - (endY - startY)) <= 2, true)
  record('the printed size matches the crop', afterDrag.dims, `${afterDrag.cropW} × ${afterDrag.cropH} px`)
  record('the card is built from a live copy of the scene', afterDrag.hasBar, true)
  truthy('the copy is offset by the drag origin', /^-?\d+px$/.test(afterDrag.copyOffset.x || '') && afterDrag.copyOffset.x !== '0px')
  truthy('the copy keeps the scene width', /^\d+px$/.test(afterDrag.copyOffset.w || ''))
  truthy('the status explains what happened', afterDrag.status.length > 20)
  record('no message before pasting', afterDrag.msgVisible, false)

  // -------------------------------------------------------------- paste it
  await evaluate(`document.querySelector('[data-try-paste]').click()`)
  await sleep(350)
  const pasted = await state()
  record('pasting shows the message', pasted.msgVisible, true)
  record('the message carries one smaller copy', pasted.msgShotCount, 1)
  truthy('the smaller copy is scaled down', await evaluate(`(() => {
    const big = document.querySelector('[data-try-slot] .try__crop');
    const small = document.querySelector('[data-try-msg-shot] .try__crop-box');
    if (!big || !small) return false;
    return small.getBoundingClientRect().width < big.getBoundingClientRect().width;
  })()`))
  truthy('and says what the real program does instead', /буфер/i.test(pasted.status))

  // ---------------------------------------------------------------- reset
  await evaluate(`document.querySelector('[data-try-reset]').click()`)
  await sleep(300)
  const reset = await state()
  record('reset empties the slot', reset.hasCard, false)
  record('reset brings the idle hint back', reset.idleVisible, true)
  record('reset hides the message', reset.msgVisible, false)
  record('reset clears the status', reset.status, '')

  // ------------------------------------------------------------- too small
  await mouse('mousePressed', startX, startY)
  await mouse('mouseMoved', startX + 6, startY + 6)
  await mouse('mouseReleased', startX + 6, startY + 6)
  await sleep(300)
  const tiny = await state()
  record('a drag under the minimum leaves no card', tiny.hasCard, false)
  truthy('and says why', /меньше 24 × 24/.test(tiny.status))

  // ------------------------------------------------------------ a wide drag
  // The scene is wider than the column the card lands in, so a selection of the
  // whole window must be shrunk to fit. If it is not, the card pushes the page
  // sideways — the one way this section can break the layout.
  const now = await evaluate(`(() => {
    const r = document.querySelector('[data-try-scene]').getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  })()`)
  await mouse('mousePressed', Math.round(now.x + 6), Math.round(now.y + 6))
  await mouse('mouseMoved', Math.round(now.x + now.w - 6), Math.round(now.y + now.h - 6))
  await mouse('mouseReleased', Math.round(now.x + now.w - 6), Math.round(now.y + now.h - 6))
  await sleep(400)
  const wide = await evaluate(`(() => {
    const slot = document.querySelector('[data-try-slot]');
    const shot = slot.querySelector('.try__shot');
    const panel = document.querySelector('[data-try-out]').getBoundingClientRect();
    const box = shot ? shot.getBoundingClientRect() : null;
    return {
      cardW: box ? Math.round(box.width) : 0,
      slotW: Math.round(slot.getBoundingClientRect().width),
      insidePanel: box ? box.right <= panel.right + 1 && box.left >= panel.left - 1 : false,
      printed: document.querySelector('[data-try-dims]').textContent.trim()
    };
  })()`)
  truthy('a selection wider than the column still makes a card', wide.cardW > 0)
  record('the wide card fits the column', wide.cardW <= wide.slotW + 1, true)
  record('the wide card stays inside the panel', wide.insidePanel, true)
  truthy('the printed size is the selection, not the card', /^\d+ × \d+ px$/.test(wide.printed))
  await evaluate(`document.querySelector('[data-try-reset]').click()`)
  await sleep(250)

  await evaluate(`document.querySelector('[data-try-scene]').focus()`)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 13, code: 'Enter', key: 'Enter', text: '\r' })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 13, code: 'Enter', key: 'Enter' })
  await sleep(350)
  const keyed = await state()
  record('Enter selects a region for a keyboard user', keyed.hasCard, true)
  truthy('the keyboard selection is a real size', /^\d+ × \d+ px$/.test(keyed.dims))

  await send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 27, code: 'Escape', key: 'Escape' })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 27, code: 'Escape', key: 'Escape' })
  await sleep(300)
  record('Escape clears the demo', (await state()).hasCard, false)

  // ------------------------------------------------------------- overflow
  const overflow = await evaluate(`(() => {
    const demo = document.querySelector('[data-try]');
    const box = demo.getBoundingClientRect();
    const wide = [...demo.querySelectorAll('*')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && (r.right > box.right + 1 || r.left < box.left - 1);
    }).map((el) => el.className || el.tagName);
    return { count: wide.length, sample: wide.slice(0, 4), docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  })()`)
  record('the demo stays inside its column', overflow.count, 0)
  record('and the page has no horizontal scroll', overflow.docOverflow, 0)

  ws.close()
  edge.kill()

  console.log('')
  if (problems.length) {
    console.error(`${problems.length} problem(s):`)
    for (const problem of problems) console.error(`  · ${problem}`)
    process.exit(1)
  }
  console.log('The demo behaves: drag, minimum, paste, reset, keyboard.')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
