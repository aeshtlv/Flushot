/**
 * Renders the 1200×630 link preview (`og-image.png`) from the live design.
 *
 * It is built in a browser rather than with sharp text drawing so that it uses
 * the same Inter and JetBrains Mono faces, the same colours and the same
 * hairline borders as the page — a preview card that does not look like the
 * site is worse than no preview card.
 *
 * Usage: node scripts/make-og-image.cjs
 */

const path = require('node:path')
const fs = require('node:fs/promises')
const { readFileSync } = require('node:fs')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { pathToFileURL } = require('node:url')
const sharp = require('sharp')

const PORT = 9445
const ROOT = path.join(__dirname, '..')
const OUT = path.join(ROOT, 'site', 'og-image.png')
const SMM = path.join(ROOT, 'smm', '02-превью-ссылки-1200x630.png')
const TMP = path.join(ROOT, '.tmp')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * The logo, inlined into the card.
 *
 * Read from `logo/logo.svg` rather than drawn again here: a preview card carrying a
 * different mark than the site it advertises is worse than no card. Inlined, not
 * linked, because the page is loaded from `file://` and an inlined SVG cannot be
 * blocked by a local-file policy or arrive late.
 */
const LOGO_SVG = readFileSync(path.join(ROOT, 'logo', 'logo.svg'), 'utf8').trim()

function logoMark(px) {
  return LOGO_SVG.replace(/<svg\b([^>]*)>/, (match, attrs) => {
    const cleaned = attrs.replace(/\s(?:width|height)="[^"]*"/g, '')
    return `<svg${cleaned} class="mark" width="${px}" height="${px}">`
  })
}

const PAGE = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="../site/fonts.css">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }

  html, body { width: 1200px; height: 630px; overflow: hidden; }

  body {
    background: #09090b;
    color: #fafafa;
    font-family: 'Inter', system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
    position: relative;
  }

  /* The same mesh the hero uses, drawn the same way: one tile with both lines in
     it, so no pixel is composited twice. Two gradient layers — the obvious way
     to write a grid — make every intersection twice as bright as the lines that
     form it, and a heavier line every fifth one reads as a stray bright streak
     rather than as a rhythm. Coarser than the page (60 px instead of 48) because
     the card is shown at roughly half size, where a finer mesh turns to mush. */
  .grid {
    position: absolute;
    inset: 0;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='60'%3E%3Cpath d='M0 .5H60M.5 1V60' stroke='%23fff' stroke-opacity='.14' fill='none'/%3E%3C/svg%3E");
    background-size: 60px 60px;
    -webkit-mask-image: radial-gradient(ellipse 88% 82% at 50% 6%, #000 46%, transparent 100%);
    mask-image: radial-gradient(ellipse 88% 82% at 50% 6%, #000 46%, transparent 100%);
  }

  /* The same accent halo the hero paints behind its grid. */
  .glow {
    position: absolute;
    top: -320px;
    left: 50%;
    width: 900px;
    height: 700px;
    margin-left: -450px;
    background: radial-gradient(closest-side, rgba(107,141,255,.15), transparent);
  }

  .inner { position: relative; padding: 52px 64px; height: 100%; display: flex; flex-direction: column; }

  .top { display: flex; align-items: center; justify-content: space-between; }

  .brand { display: flex; align-items: center; gap: 11px; }

  .mark {
    /* The logo brings its own dark tile, so this only places it. */
    display: block;
    flex: none;
  }

  .mark svg { display: block; }

  .name { font-size: 19px; font-weight: 600; letter-spacing: -0.02em; }

  .ver {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px; letter-spacing: .06em; color: #71717a;
    border: 1px solid rgba(255,255,255,.1);
    border-radius: 999px; padding: 4px 9px;
  }

  .title {
    margin-top: 30px;
    font-size: 50px;
    font-weight: 500;
    line-height: 1.06;
    letter-spacing: -0.035em;
    max-width: 540px;
  }

  .sub { margin-top: 15px; font-size: 16px; line-height: 1.5; color: #a1a1aa; max-width: 560px; }

  /* One framed screenshot, fully inside the card. A bleed off the right edge
     reads as a crop error at 1200×630, and a full-bleed white frame on a
     near-black card is a glare. */
  .shot {
    position: absolute;
    right: 56px;
    top: 148px;
    width: 470px;
    border-radius: 8px;
    overflow: hidden;
    box-shadow:
      0 32px 64px -16px rgba(0,0,0,.85),
      0 8px 20px -8px rgba(0,0,0,.7),
      0 0 0 1px rgba(255,255,255,.1);
  }

  .shot img { display: block; width: 100%; }

  .shot__cap {
    position: absolute;
    right: 56px;
    top: 528px;
    width: 470px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    letter-spacing: .04em;
    color: #71717a;
  }

  .foot {
    margin-top: auto;
    display: flex; align-items: center; gap: 10px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px; color: #71717a;
  }

  .dot { width: 3px; height: 3px; border-radius: 50%; background: #3f3f46; }
</style>
</head>
<body>
<div class="glow"></div>
<div class="grid"></div>
<div class="inner">
  <div class="top">
    <div class="brand">
      <span class="mark">${logoMark(30)}</span>
      <span class="name">Flushot</span>
      <span class="ver">2.3.0</span>
    </div>
  </div>

  <h1 class="title">Снимок экрана,<br>готовый<br>к вставке</h1>
  <p class="sub">Отпустили кнопку мыши — карточка уже в буфере, с рамкой, тенью и скруглениями. Windows 10 и 11, бесплатно.</p>

  <div class="foot">
    <span>PNG без потерь</span><span class="dot"></span><span>пометки</span><span class="dot"></span><span>распознавание текста</span>
  </div>
</div>

<div class="shot"><img src="../site/assets/hero.png" alt=""></div>
<div class="shot__cap"><span>screenshot_2026-10-17_14-30-25.png</span><span>PNG · 1640×957</span></div>
</body>
</html>
`

async function main() {
  await fs.mkdir(TMP, { recursive: true })
  const htmlPath = path.join(TMP, 'og.html')
  await fs.writeFile(htmlPath, PAGE, 'utf8')

  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'flushot-og-'))
  const edge = spawn(
    path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--hide-scrollbars',
      '--force-device-scale-factor=2',
      'about:blank'
    ],
    { stdio: 'ignore' }
  )

  try {
    for (let attempt = 0; attempt < 150; attempt += 1) {
      try {
        if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break
      } catch {
        /* not up yet */
      }
      await sleep(120)
    }

    const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
    const target = targets.find((entry) => entry.type === 'page')
    const ws = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true })
      ws.addEventListener('error', reject, { once: true })
    })

    let nextId = 1
    const pending = new Map()
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      const waiter = pending.get(message.id)
      if (!waiter) return
      pending.delete(message.id)
      if (message.error) waiter.reject(new Error(message.error.message))
      else waiter.resolve(message.result)
    })
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = nextId
        nextId += 1
        pending.set(id, { resolve, reject })
        ws.send(JSON.stringify({ id, method, params }))
      })

    await send('Page.enable')
    await send('Runtime.enable')
    await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 630, deviceScaleFactor: 2, mobile: false })
    await send('Page.navigate', { url: pathToFileURL(htmlPath).href })
    await sleep(1200)
    await send('Runtime.evaluate', { expression: 'document.fonts.ready', awaitPromise: true })
    await sleep(300)

    // Measure before capturing. The card is 1200 × 630 and shown small in every
    // place it appears, so a word that runs out of the block or slides under the
    // screenshot is invisible here and obvious in a timeline.
    //
    // The measurement is of the glyphs, not of the blocks: `getClientRects()` on a
    // Range returns the box each line of text actually paints, and a block whose
    // `line-height` is tighter than its font (the title is 1.06) reports a
    // smaller content box than the letters it draws. Sizing against the block
    // would have flagged a 4 px "overflow" that no one can see, and missed a real
    // collision between two blocks.
    const measure = await send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const painted = (selector) => {
          const element = document.querySelector(selector)
          if (!element) return null
          const range = document.createRange()
          range.selectNodeContents(element)
          const rects = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0)
          if (rects.length === 0) return null
          return {
            selector,
            left: Math.min(...rects.map((r) => r.left)),
            right: Math.max(...rects.map((r) => r.right)),
            top: Math.min(...rects.map((r) => r.top)),
            bottom: Math.max(...rects.map((r) => r.bottom)),
            // One box per line: the footer is a row of spans, so counting rects
            // would report its pieces rather than the lines it occupies.
            lines: new Set(rects.map((r) => Math.round(r.top))).size,
            clipped: element.scrollWidth - element.clientWidth
          }
        }
        const box = (selector) => {
          const element = document.querySelector(selector)
          if (!element) return null
          const rect = element.getBoundingClientRect()
          return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
        }
        const inner = box('.inner')
        const pad = 52
        const shot = box('.shot')
        const cap = box('.shot__cap')
        // The title and the lede wrap, so their lines are what must stay inside;
        // the footer is one row of spans, so its block box is the honest measure.
        const pieces = [...['.title', '.sub'].map(painted), box('.foot') && { selector: '.foot', lines: 1, clipped: 0, ...box('.foot') }].filter(Boolean)
        const problems = []
        const observed = []
        for (const piece of pieces) {
          observed.push(piece.selector + ': ' + piece.lines + ' lines, ends at y=' + Math.round(piece.bottom))
          if (piece.left < pad - 1 || piece.right > inner.right - pad + 1) {
            problems.push(piece.selector + ' leaves the padded area horizontally')
          }
          if (piece.top < pad - 1 || piece.bottom > 630 - pad + 1) {
            problems.push(piece.selector + ' leaves the padded area vertically')
          }
          if (piece.clipped > 1) problems.push(piece.selector + ' is clipped horizontally by ' + piece.clipped + 'px')
          for (const obstacle of [shot, cap]) {
            if (!obstacle) continue
            if (piece.right > obstacle.left + 1 && piece.bottom > obstacle.top + 1 && piece.top < obstacle.bottom - 1) {
              problems.push(piece.selector + ' runs into ' + (obstacle === shot ? 'the screenshot' : 'its caption'))
            }
          }
        }
        return { problems, observed }
      })()`
    })
    const { problems, observed } = measure.result.value
    if (problems.length > 0) {
      throw new Error('the card does not fit:\n  ' + problems.join('\n  '))
    }

    const shot = await send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: 0, y: 0, width: 1200, height: 630, scale: 1 }
    })
    const raw = Buffer.from(shot.data, 'base64')
    ws.close()

    // 2× for crisp text, then down to the exact size social platforms expect.
    const png = await sharp(raw).resize(1200, 630, { fit: 'cover' }).png({ compressionLevel: 9 }).toBuffer()
    await fs.writeFile(OUT, png)
    await fs.mkdir(path.dirname(SMM), { recursive: true })
    await fs.writeFile(SMM, png)

    const meta = await sharp(png).metadata()
    console.log(`og-image.png  ${meta.width}×${meta.height}  ${(png.length / 1024).toFixed(0)} KB`)
    console.log(`  text measured: ${observed.join(' · ')}`)
    console.log(`copied to smm/02-превью-ссылки-1200x630.png`)
  } finally {
    edge.kill()
    await fs.rm(profile, { recursive: true, force: true }).catch(() => {})
  }
}

main().catch((error) => {
  console.error('FAILED', error)
  process.exit(1)
})
