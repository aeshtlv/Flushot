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

  /* The same grid the hero uses — minor and major lines, masked towards the
     edges. Kept in step with --grid-line / --grid-major in site/styles.css: a
     preview card that is dimmer than the page it advertises looks like an old
     screenshot of it. The mask is wider than the hero's because this card is
     mostly empty space, and a grid that fades out by the middle would leave the
     lower half flat. */
  .grid {
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(to right, rgba(255,255,255,.22) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(255,255,255,.22) 1px, transparent 1px),
      linear-gradient(to right, rgba(255,255,255,.11) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(255,255,255,.11) 1px, transparent 1px);
    background-size: 240px 240px, 240px 240px, 48px 48px, 48px 48px;
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
      <span class="ver">2.2.8</span>
    </div>
  </div>

  <h1 class="title">Скриншот,<br>готовый<br>к публикации</h1>
  <p class="sub">Рамка, тень и скругления — сразу. Windows 10 и 11, бесплатно.</p>

  <div class="foot">
    <span>PNG</span><span class="dot"></span><span>JPEG</span><span class="dot"></span><span>без потерь</span>
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
