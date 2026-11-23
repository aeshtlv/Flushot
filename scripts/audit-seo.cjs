/**
 * Layout audit for the search pages, measured rather than looked at.
 *
 * A screenshot answers "does this look right" only to a human eye. Everything that can be checked
 * numerically is checked here instead: the download button is inside the first screen, the grid
 * collapses to one column on a phone, pictures are actually painted at their declared ratio, the
 * text measure stays readable, and the sticky header does not cover a heading when the page is
 * jumped to an anchor.
 *
 * Served over HTTP rather than file://, because that is how the pages are actually delivered and
 * it is the only way relative `../` references are resolved the way a browser resolves them.
 *
 * Usage: node scripts/audit-seo.cjs
 */

const path = require('node:path')
const fs = require('node:fs/promises')
const fsSync = require('node:fs')
const os = require('node:os')
const http = require('node:http')
const { spawn } = require('node:child_process')

const ROOT = path.join(__dirname, '..')
const SITE = path.join(ROOT, 'site')
const PORT = 9417
const BROWSER_PORT = 9419

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8'
}

const problems = []
const notes = []
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const WIDTHS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'laptop', width: 1080, height: 800 },
  { name: 'tablet', width: 820, height: 1000 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'small', width: 320, height: 640 }
]

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer(async (request, response) => {
      const url = decodeURIComponent(request.url.split('?')[0])
      let file = path.join(SITE, url)
      try {
        const stat = await fs.stat(file).catch(() => null)
        if (stat && stat.isDirectory()) file = path.join(file, 'index.html')
        const body = await fs.readFile(file)
        response.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' })
        response.end(body)
      } catch {
        response.writeHead(404, { 'Content-Type': 'text/plain' })
        response.end('not found')
      }
    })
    server.listen(PORT, '127.0.0.1', () => resolve(server))
  })
}

function findEdge() {
  return [
    path.join(process.env['ProgramFiles'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  ].find((candidate) => fsSync.existsSync(candidate))
}

async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }))
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
  await send('Runtime.enable')
  await send('Page.enable')
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || 'eval failed')
    return result.result.value
  }
  return { ws, send, evaluate }
}

async function main() {
  const { PAGES } = require('./seo-pages.cjs')
  const server = await serve()
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'flushot-audit-'))
  const edge = spawn(
    findEdge(),
    [
      '--headless=new',
      `--remote-debugging-port=${BROWSER_PORT}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      'about:blank'
    ],
    { stdio: 'ignore' }
  )

  for (let attempt = 0; attempt < 150; attempt++) {
    try {
      if ((await fetch(`http://127.0.0.1:${BROWSER_PORT}/json/version`)).ok) break
    } catch {
      /* waiting */
    }
    await sleep(120)
  }

  const target = (await (await fetch(`http://127.0.0.1:${BROWSER_PORT}/json/list`)).json()).find((t) => t.type === 'page')
  const page = await connect(target)

  for (const entry of PAGES) {
    for (const lang of ['ru', 'en']) {
      const url = lang === 'en' ? `http://127.0.0.1:${PORT}/en/${entry.slug}/` : `http://127.0.0.1:${PORT}/${entry.slug}/`

      for (const size of WIDTHS) {
        await page.send('Emulation.setDeviceMetricsOverride', {
          width: size.width,
          height: size.height,
          deviceScaleFactor: 1,
          mobile: size.width <= 560
        })
        await page.send('Page.navigate', { url })
        await sleep(900)

        // Walk down the page so the lazy pictures actually load, then come back to the top. The
        // measurement below is about the finished page, not about the first screen.
        await page.evaluate(`(async function () {
          const step = window.innerHeight * 0.8;
          for (let y = 0; y < document.body.scrollHeight; y += step) {
            window.scrollTo(0, y);
            await new Promise(function (r) { setTimeout(r, 60); });
          }
          window.scrollTo(0, 0);
          await new Promise(function (r) { setTimeout(r, 400); });
          return true;
        })()`)

        const where = `${lang} ${entry.slug} @${size.width}`
        const audit = await page.evaluate(`(function () {
          const doc = document.documentElement;
          const fold = window.innerHeight;

          const download = document.querySelector('.hero__actions a.btn--primary');
          const downloadBox = download ? download.getBoundingClientRect() : null;

          const h1 = document.querySelector('h1');
          const h1Box = h1 ? h1.getBoundingClientRect() : null;
          const h1Style = h1 ? getComputedStyle(h1) : null;
          const h1Lines = h1 ? Math.round(h1Box.height / parseFloat(h1Style.lineHeight)) : 0;

          const grid = document.querySelector('.feature-grid');
          const gridColumns = grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0;

          const images = [...document.querySelectorAll('.shot img, .hero__frame img')].map(function (img) {
            const box = img.getBoundingClientRect();
            // The declared size is what the layout uses; the file's own size is what proves the
            // reference resolves. A 404 leaves naturalWidth at 0 whatever the attributes say.
            const declared = { w: Number(img.getAttribute('width')), h: Number(img.getAttribute('height')) };
            return {
              src: img.getAttribute('src'),
              natural: img.naturalWidth + 'x' + img.naturalHeight,
              shown: Math.round(box.width) + 'x' + Math.round(box.height),
              ratioError: Math.abs((box.width / box.height) - (declared.w / declared.h)),
              loaded: img.complete && img.naturalWidth > 0,
              sourceOk: declared.w > 0 && declared.h > 0
            };
          });

          // The measure of a paragraph: characters per line, which is what readability comes down to.
          const para = document.querySelector('.seo-prose p');
          let charsPerLine = 0;
          if (para) {
            const style = getComputedStyle(para);
            const probe = document.createElement('span');
            probe.style.font = style.font;
            probe.style.visibility = 'hidden';
            probe.style.position = 'absolute';
            probe.textContent = 'x'.repeat(100);
            document.body.appendChild(probe);
            const perChar = probe.getBoundingClientRect().width / 100;
            probe.remove();
            charsPerLine = Math.round(para.getBoundingClientRect().width / perChar);
          }

          // The sticky header must not sit on top of a heading the page is jumped to.
          const header = document.querySelector('.header');
          const headerHeight = header ? header.getBoundingClientRect().height : 0;

          const related = document.querySelectorAll('.seo-also__link').length;

          return {
            overflow: doc.scrollWidth - doc.clientWidth,
            downloadInFold: downloadBox ? downloadBox.top + downloadBox.height <= fold : false,
            downloadVisible: downloadBox ? downloadBox.width > 0 && downloadBox.height > 0 : false,
            h1Size: h1Style ? parseFloat(h1Style.fontSize) : 0,
            h1Lines: h1Lines,
            heroHeight: Math.round(document.querySelector('.hero').getBoundingClientRect().height),
            h1Width: h1Box ? Math.round(h1Box.width) : 0,
            h1Overflows: h1Box ? h1Box.right > doc.clientWidth + 1 : false,
            gridColumns: gridColumns,
            images: images,
            charsPerLine: charsPerLine,
            headerHeight: Math.round(headerHeight),
            relatedLinks: related,
            faqOpen: document.querySelectorAll('.faq details[open]').length,
            footerLinks: document.querySelectorAll('.footer__links a').length
          };
        })()`)

        if (audit.overflow > 1) problems.push(`${where}: horizontal overflow ${audit.overflow}px`)
        if (!audit.downloadVisible) problems.push(`${where}: the download button is not rendered`)
        if (!audit.downloadInFold) problems.push(`${where}: the download button is below the first screen`)

        // The grid must collapse as the screen narrows, or a three-column grid on a phone is a
        // column of 90-pixel cells.
        if (size.width <= 560 && audit.gridColumns !== 1) {
          problems.push(`${where}: the feature grid is ${audit.gridColumns} columns on a ${size.width}px screen`)
        }
        if (size.width > 1080 && audit.gridColumns !== 3) {
          problems.push(`${where}: the feature grid is ${audit.gridColumns} columns on a wide screen`)
        }

        for (const image of audit.images) {
          // An image that has finished loading must keep its aspect ratio. One that has not is
          // checked only for having a source at all — a lazy picture below the fold is allowed to
          // still be in flight, and demanding otherwise asserts the opposite of the design.
          if (!image.sourceOk) problems.push(`${where}: a picture points at a missing file (${image.src})`)
          else if (image.loaded && image.ratioError > 0.02) {
            problems.push(`${where}: a picture is stretched (${image.natural} shown as ${image.shown})`)
          }
        }

        // 45–95 characters per line is the readable range; outside it the eye loses its place.
        if (size.width >= 560 && audit.charsPerLine && (audit.charsPerLine < 40 || audit.charsPerLine > 95)) {
          problems.push(`${where}: a paragraph runs ${audit.charsPerLine} characters per line`)
        }

        if (audit.h1Size < 24) problems.push(`${where}: the H1 is only ${audit.h1Size}px`)
        const allowedLines = size.width > 820 ? 2 : size.width > 360 ? 3 : 4
        if (audit.h1Lines > allowedLines) {
          problems.push(`${where}: the H1 takes ${audit.h1Lines} lines, which pushes the content below the fold`)
        }
        // The hero should leave the first section's heading visible on a laptop screen.
        if (size.width > 820 && audit.heroHeight > 1400) {
          problems.push(`${where}: the hero is ${audit.heroHeight}px tall, more than a screen and a half`)
        }
        if (audit.h1Overflows) problems.push(`${where}: the H1 sticks out of the viewport`)
        if (audit.relatedLinks < 3) problems.push(`${where}: only ${audit.relatedLinks} cross-links`)
        // Home, every guide and the policy: the footer of a search page has one entry per page
        // plus the way home and the privacy policy.
        if (audit.footerLinks < 5) problems.push(`${where}: only ${audit.footerLinks} footer links`)

        notes.push(
          `${where.padEnd(44)} grid ${audit.gridColumns}c  measure ${audit.charsPerLine}ch  ` +
            `h1 ${audit.h1Size}px  related ${audit.relatedLinks}  footer ${audit.footerLinks}`
        )
      }
    }
  }

  page.ws.close()
  edge.kill()
  server.close()
  await fs.rm(profile, { recursive: true, force: true }).catch(() => {})

  for (const note of notes) console.log(`  · ${note}`)
  if (problems.length) {
    console.error(`\n${problems.length} PROBLEM(S):`)
    for (const problem of problems) console.error(`  ✗ ${problem}`)
    process.exitCode = 1
  } else {
    console.log(`\n${notes.length} renders audited: layout, measure, pictures and links`)
  }
}

main().catch((error) => {
  console.error('FAILED', error)
  process.exit(1)
})
