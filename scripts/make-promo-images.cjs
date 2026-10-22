/**
 * Builds the promotional images in `smm/`.
 *
 * Everything is drawn as SVG and rasterised with sharp, so the result is
 * deterministic and can be regenerated after a copy change. No private desktop
 * content is used: the "screenshot" inside the cards is a drawn mock window, so
 * the material is safe to publish.
 *
 * Text is measured, not estimated: SVG cannot wrap, and an average-glyph guess
 * was off by enough to push a caption past the card edge. Every line is rendered
 * once on a scratch canvas to get its real width, then laid out and verified.
 *
 * Usage: node scripts/make-promo-images.cjs
 */

const path = require('node:path')
const fs = require('node:fs/promises')
const { readFileSync } = require('node:fs')
const sharp = require('sharp')

const OUT = path.join(__dirname, '..', 'smm')
const FONT = 'Segoe UI'

/**
 * The logo, read out of `logo/logo.svg` — the file the owner supplied.
 *
 * Parsed rather than redrawn so a logo change cannot leave the promo images
 * showing the previous mark. The patterns are strict on purpose: if the file's
 * structure changes, this throws instead of quietly drawing something wrong.
 */
const LOGO_SOURCE = readFileSync(path.join(__dirname, '..', 'logo', 'logo.svg'), 'utf8')
const LOGO_VIEWBOX = Number(/viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(LOGO_SOURCE)?.[1])
const LOGO_TILE = (() => {
  const match = /<rect width="([\d.]+)" height="([\d.]+)" rx="([\d.]+)" fill="(#[0-9A-Fa-f]{3,8})"/.exec(LOGO_SOURCE)
  if (!match) throw new Error('logo.svg: no rounded tile rect')
  return { width: Number(match[1]), height: Number(match[2]), radius: Number(match[3]), fill: match[4] }
})()
const LOGO_INK = (() => {
  const match = /<g fill="(#[0-9A-Fa-f]{3,8})"/.exec(LOGO_SOURCE)
  if (!match) throw new Error('logo.svg: no ink group')
  return match[1]
})()
const LOGO_SHAPES = [...LOGO_SOURCE.matchAll(/\sd="([^"]+)"/g)].map((match) => match[1])
if (LOGO_SHAPES.length === 0) throw new Error('logo.svg: no shapes')

const C = {
  bg1: '#0A0F1C',
  bg2: '#16203A',
  ink: '#FFFFFF',
  muted: '#9AA9C2',
  faint: '#7C8AA3',
  accent: '#0A84FF',
  violet: '#5E5CE6',
  red: '#FF453A',
  green: '#30D158'
}

function esc(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ---------------------------------------------------------------- measurement

const measureCache = new Map()

/** Real rendered width of a string, in pixels. */
async function measureText(text, size, weight = 400) {
  const key = `${size}|${weight}|${text}`
  const cached = measureCache.get(key)
  if (cached !== undefined) return cached

  const scratchW = Math.ceil(text.length * size * 1.2) + 200
  const scratchH = Math.ceil(size * 2.4)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${scratchW}" height="${scratchH}">
    <text x="40" y="${Math.ceil(size * 1.5)}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="#ffffff">${esc(text)}</text>
  </svg>`
  const { data, info } = await sharp(Buffer.from(svg))
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  let minX = Infinity
  let maxX = -1
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 3
      if (data[i] > 40 || data[i + 1] > 40 || data[i + 2] > 40) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
      }
    }
  }
  const width = maxX >= minX ? maxX - minX + 1 : 0
  measureCache.set(key, width)
  return width
}

/** Greedy wrap using measured widths, so no line can exceed `maxWidth`. */
async function wrapText(text, size, weight, maxWidth) {
  const words = String(text).split(/\s+/)
  const lines = []
  let current = ''
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    const width = await measureText(candidate, size, weight)
    if (width > maxWidth && current) {
      lines.push(current)
      current = word
    } else {
      current = candidate
    }
  }
  if (current) lines.push(current)
  return lines
}

// ------------------------------------------------------------------ primitives

/**
 * A wrapped text block.
 *
 * Registers the exact rectangle the glyphs may occupy, so the verification pass
 * can prove both "it rendered" and "it stayed inside".
 */
async function textBlock(zones, options) {
  const {
    x,
    y,
    size,
    weight = 400,
    fill = C.ink,
    lineHeight = 1.2,
    text,
    maxWidth = 0,
    name = 'text'
  } = options
  const lines = maxWidth ? await wrapText(text, size, weight, maxWidth) : [text]
  const svg = lines
    .map(
      (line, index) =>
        `<text x="${x}" y="${Math.round(y + index * size * lineHeight)}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}">${esc(line)}</text>`
    )
    .join('\n')

  let widest = 0
  for (const line of lines) widest = Math.max(widest, await measureText(line, size, weight))

  const lastBaseline = y + (lines.length - 1) * size * lineHeight
  // The zone is the space the block is *allowed* to use, not the width measured a
  // moment ago: measuring and rendering differ by a pixel of antialiasing, and a
  // check that trips on that is noise. With a maxWidth the limit is the contract,
  // so overflowing it is what the verification pass should catch.
  const allowed = maxWidth || Math.ceil(widest)
  zones.push({
    name,
    left: Math.round(x - 4),
    top: Math.round(y - size * 0.82),
    width: Math.ceil(allowed) + 8,
    height: Math.ceil(size * 0.82 + size * 0.24 + (lines.length - 1) * size * lineHeight) + 4
  })
  return { svg, lines, bottom: lastBaseline, width: widest }
}

function background(w, h) {
  return `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.55" y2="1">
      <stop offset="0" stop-color="${C.bg1}"/>
      <stop offset="1" stop-color="${C.bg2}"/>
    </linearGradient>
    <radialGradient id="glowA" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${C.accent}" stop-opacity="0.40"/>
      <stop offset="1" stop-color="${C.accent}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glowB" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${C.violet}" stop-opacity="0.38"/>
      <stop offset="1" stop-color="${C.violet}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="pill" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${C.accent}"/>
      <stop offset="1" stop-color="${C.violet}"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  <circle cx="${Math.round(w * 0.84)}" cy="${Math.round(h * 0.06)}" r="${Math.round(Math.max(w, h) * 0.44)}" fill="url(#glowA)"/>
  <circle cx="${Math.round(w * 0.06)}" cy="${Math.round(h * 0.96)}" r="${Math.round(Math.max(w, h) * 0.4)}" fill="url(#glowB)"/>`
}

/**
 * The mark, drawn at `size` with its top-left corner at (x, y).
 *
 * Emitted as a scaled group so the geometry stays in the logo's own 200-unit
 * coordinates: the same numbers as `logo/logo.svg`, which is where they come from.
 */
function markSvg(x, y, size) {
  const scale = size / LOGO_VIEWBOX
  return `
  <g transform="translate(${x} ${y}) scale(${scale})">
    <rect width="${LOGO_TILE.width}" height="${LOGO_TILE.height}" rx="${LOGO_TILE.radius}" fill="${LOGO_TILE.fill}"/>
    <g fill="${LOGO_INK}">${LOGO_SHAPES.map((shape) => `<path d="${shape}"/>`).join('')}</g>
  </g>`
}

function logo(x, y, size, withWordmark = true) {
  const wordSize = Math.round(size * 0.62)
  const svg = `${markSvg(x, y, size)}${
    withWordmark
      ? `\n  <text x="${x + size + Math.round(size * 0.34)}" y="${y + size * 0.71}" font-family="${FONT}" font-size="${wordSize}" font-weight="700" fill="#FFFFFF">Flushot</text>`
      : ''
  }`
  return { svg }
}

async function pill({ x, y, width, height, text, size = 26 }) {
  const textWidth = await measureText(text, size, 600)
  return {
    svg: `
  <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${height / 2}" fill="url(#pill)"/>
  <text x="${Math.round(x + (width - textWidth) / 2)}" y="${Math.round(y + height / 2 + size * 0.36)}" font-family="${FONT}" font-size="${size}" font-weight="600" fill="#FFFFFF">${esc(text)}</text>`,
    textWidth
  }
}

async function chip({ x, y, text, size = 24, height = 44 }) {
  const textWidth = await measureText(text, size, 600)
  const width = Math.round(textWidth + size * 1.7)
  return {
    svg: `
  <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${height / 2}" fill="#FFFFFF" opacity="0.07"/>
  <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${height / 2}" fill="none" stroke="#FFFFFF" stroke-opacity="0.16"/>
  <text x="${Math.round(x + (width - textWidth) / 2)}" y="${Math.round(y + height / 2 + size * 0.35)}" font-family="${FONT}" font-size="${size}" font-weight="600" fill="${C.ink}">${esc(text)}</text>`,
    width
  }
}

/** Soft shadow from stacked translucent rects — no SVG filters, which vary by build. */
function shadow({ x, y, width, height, radius, layers = 6 }) {
  let svg = ''
  for (let i = layers; i >= 1; i--) {
    const spread = i * 7
    svg += `<rect x="${x - spread}" y="${y - spread + i * 5}" width="${width + spread * 2}" height="${height + spread * 2}" rx="${radius + spread}" fill="#000000" opacity="0.05"/>\n`
  }
  return svg
}

/**
 * Height of a mock window for a given width — kept as a formula so a card can be
 * sized to the space that is actually left instead of guessing.
 */
function mockHeight(width, frame, aspect = 0.615) {
  return Math.round((width - frame * 2) * aspect) + frame * 2
}

/** Largest width whose mock window still fits in `available` height. */
function fitMockWidth(available, frame, maxWidth) {
  const raw = Math.round((available - frame * 2) / 0.615 + frame * 2)
  return Math.min(maxWidth, Math.max(240, raw))
}

/**
 * Size a mock window so it fills the vertical space between `top` and `bottom`.
 *
 * Cards are read top to bottom, so a 300 px hole under the picture looks like a
 * mistake. Filling the gap — up to `maxWidth` — keeps the composition even
 * without hard-coding a size per card.
 */
function fillMock({ top, bottom, frame, maxWidth, centreX }) {
  const width = fitMockWidth(bottom - top, frame, maxWidth)
  const height = mockHeight(width, frame)
  return { x: Math.round(centreX - width / 2), y: top, width, height }
}

/**
 * Fill a band exactly: the width is fixed by the layout, so the aspect ratio is
 * derived from the space instead of the other way round. Without this a capped
 * width leaves a hole under a portrait card.
 */
function bandMock({ top, bottom, frame, width, centreX }) {
  const innerW = width - frame * 2
  const innerH = Math.max(120, bottom - top - frame * 2)
  return {
    x: Math.round(centreX - width / 2),
    y: top,
    width,
    height: innerH + frame * 2,
    aspect: innerH / innerW
  }
}

/** A mock application window, drawn rather than captured. */
function mockWindow({ x, y, width, frame = 22, radius = 18, aspect = 0.615 }) {
  const innerW = width - frame * 2
  const innerH = Math.round(innerW * aspect)
  const totalH = innerH + frame * 2
  const bar = Math.max(20, Math.round(innerH * 0.072))
  const sideW = Math.round(innerW * 0.235)
  const pad = Math.round(innerW * 0.035)
  const contentX = x + frame + sideW + pad
  const contentW = innerW - sideW - pad * 2
  const top = y + frame

  let svg = shadow({ x, y, width, height: totalH, radius })
  svg += `<rect x="${x}" y="${y}" width="${width}" height="${totalH}" rx="${radius}" fill="#FFFFFF"/>\n`
  svg += `<rect x="${x + frame}" y="${top}" width="${innerW}" height="${innerH}" rx="${Math.max(2, radius - 6)}" fill="#F7F8FB"/>\n`
  svg += `<rect x="${x + frame}" y="${top}" width="${innerW}" height="${bar}" rx="${Math.max(2, radius - 6)}" fill="#ECEEF4"/>\n`
  svg += `<rect x="${x + frame}" y="${top + bar - 8}" width="${innerW}" height="8" fill="#ECEEF4"/>\n`
  const dot = Math.max(3, Math.round(bar * 0.17))
  const dotY = top + Math.round(bar / 2)
  ;['#FF5F57', '#FEBC2E', '#28C840'].forEach((color, index) => {
    svg += `<circle cx="${x + frame + Math.round(bar * 0.42) + index * dot * 3.1}" cy="${dotY}" r="${dot}" fill="${color}"/>\n`
  })

  const sideX = x + frame
  const sideY = top + bar
  const sideH = innerH - bar
  svg += `<rect x="${sideX}" y="${sideY}" width="${sideW}" height="${sideH}" fill="#FBFBFD"/>\n`
  const rowH = Math.max(6, Math.round(sideH * 0.075))
  for (let i = 0; i < 5; i++) {
    const rowY = sideY + Math.round(sideH * 0.1) + i * Math.round(rowH * 2.4)
    const rowW = Math.round(sideW * (i === 0 ? 0.62 : 0.54))
    svg += `<rect x="${sideX + Math.round(sideW * 0.14)}" y="${rowY}" width="${rowW}" height="${rowH}" rx="${rowH / 2}" fill="${i === 0 ? C.accent : '#E3E6EE'}"${i === 0 ? ' opacity="0.9"' : ''}/>\n`
  }

  let cursor = top + bar + Math.round(innerH * 0.075)
  const headingH = Math.max(7, Math.round(innerH * 0.05))
  svg += `<rect x="${contentX}" y="${cursor}" width="${Math.round(contentW * 0.46)}" height="${headingH}" rx="${headingH / 2}" fill="#20242E"/>\n`
  cursor += headingH + Math.round(innerH * 0.06)
  const lineH = Math.max(5, Math.round(innerH * 0.028))
  for (const factor of [0.82, 0.74, 0.66]) {
    svg += `<rect x="${contentX}" y="${cursor}" width="${Math.round(contentW * factor)}" height="${lineH}" rx="${lineH / 2}" fill="#D7DBE5"/>\n`
    cursor += lineH + Math.round(innerH * 0.035)
  }

  // The row the line tool exists for: highlighted, with an accent underline.
  const rowTop = cursor + Math.round(innerH * 0.03)
  const rowH2 = Math.round(innerH * 0.13)
  svg += `<rect x="${contentX - Math.round(pad * 0.4)}" y="${rowTop}" width="${contentW + Math.round(pad * 0.8)}" height="${rowH2}" rx="${Math.round(rowH2 * 0.28)}" fill="${C.accent}" opacity="0.10"/>\n`
  svg += `<rect x="${contentX}" y="${rowTop + Math.round(rowH2 * 0.3)}" width="${Math.round(contentW * 0.52)}" height="${lineH}" rx="${lineH / 2}" fill="#B9C0CE"/>\n`
  svg += `<rect x="${contentX}" y="${rowTop + rowH2 - Math.round(rowH2 * 0.26)}" width="${Math.round(contentW * 0.62)}" height="${Math.max(3, Math.round(rowH2 * 0.1))}" rx="2" fill="${C.red}"/>\n`

  const blockY = top + bar + Math.round(innerH * 0.075)
  const blockW = Math.round(contentW * 0.26)
  svg += `<rect x="${contentX + contentW - blockW}" y="${blockY}" width="${blockW}" height="${Math.round(innerH * 0.22)}" rx="${Math.round(innerH * 0.03)}" fill="${C.accent}" opacity="0.13"/>\n`
  svg += `<rect x="${contentX + contentW - blockW}" y="${blockY + Math.round(innerH * 0.26)}" width="${blockW}" height="${Math.round(innerH * 0.16)}" rx="${Math.round(innerH * 0.03)}" fill="${C.green}" opacity="0.16"/>\n`

  return { svg, height: totalH }
}

function document({ w, h, body }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
${background(w, h)}
${body}
</svg>`
}

// --------------------------------------------------------------------- layouts

/** 1080 × 1080 — the main feed card. */
async function squareCard() {
  const zones = []
  const rects = []
  const blocks = []
  const w = 1080
  const h = 1080
  let body = ''

  body += logo(72, 64, 58).svg
  blocks.push({ name: 'logo', top: 64, bottom: 122 })

  const head = await textBlock(zones, {
    x: 72,
    y: 240,
    size: 74,
    weight: 700,
    lineHeight: 1.16,
    maxWidth: 936,
    text: 'Скриншот за секунду — и сразу красиво',
    name: 'headline'
  })
  body += head.svg
  blocks.push({ name: 'headline', top: 240 - 74, bottom: head.bottom + 14 })

  const sub = await textBlock(zones, {
    x: 72,
    y: head.bottom + 66,
    size: 30,
    fill: C.muted,
    lineHeight: 1.4,
    maxWidth: 900,
    text: 'Flushot: выделил область, добавил пометки, отправил. Без фотошопа и вставки в Word.',
    name: 'subtitle'
  })
  body += sub.svg
  blocks.push({ name: 'subtitle', top: sub.bottom - 30 * 1.4 * (sub.lines.length - 1) - 30, bottom: sub.bottom + 8 })

  // Footer is placed from the bottom edge; the card gets whatever is left.
  const buttonY = h - 150
  const cardTop = sub.bottom + 58
  const available = buttonY - 40 - cardTop
  const frame = 20
  const cardW = fitMockWidth(available, frame, 780)
  const card = mockWindow({ x: Math.round((w - cardW) / 2), y: cardTop, width: cardW, frame })
  body += card.svg
  rects.push({ name: 'card', left: Math.round((w - cardW) / 2), top: cardTop, width: cardW, height: card.height })
  blocks.push({ name: 'card', top: cardTop, bottom: cardTop + card.height })

  const button = await pill({ x: 72, y: buttonY, width: 300, height: 68, text: 'Бесплатно', size: 27 })
  body += button.svg
  const note = await textBlock(zones, {
    x: 404,
    y: buttonY + 45,
    size: 24,
    fill: C.faint,
    text: 'Windows 10 и 11 · без установки',
    name: 'note'
  })
  body += note.svg
  blocks.push({ name: 'footer', top: buttonY, bottom: buttonY + 68 })

  return { name: '01-квадрат-1080.png', svg: document({ w, h, body }), zones, rects, blocks, w, h }
}

/** 1200 × 630 — link preview in Telegram, VK, X and Slack. */
async function linkPreview() {
  const zones = []
  const rects = []
  const blocks = []
  const w = 1200
  const h = 630
  let body = ''

  body += logo(56, 46, 46).svg
  blocks.push({ name: 'logo', top: 46, bottom: 92, left: 56, width: 160 })

  const head = await textBlock(zones, {
    x: 56,
    y: 236,
    size: 56,
    weight: 700,
    lineHeight: 1.16,
    maxWidth: 540,
    text: 'Скриншоты, которые не стыдно отправить',
    name: 'headline'
  })
  body += head.svg
  blocks.push({ name: 'headline', top: 236 - 56, bottom: head.bottom + 12, left: 56, width: 540 })

  const sub = await textBlock(zones, {
    x: 56,
    y: head.bottom + 56,
    size: 24,
    fill: C.muted,
    lineHeight: 1.42,
    maxWidth: 530,
    text: 'Рамка, тень и пометки в один клик. Ровная линия и снимок всего экрана одной клавишей.',
    name: 'subtitle'
  })
  body += sub.svg
  blocks.push({ name: 'subtitle', top: sub.bottom - 24 * 1.42 * (sub.lines.length - 1) - 24, bottom: sub.bottom + 6, left: 56, width: 530 })

  const button = await pill({ x: 56, y: h - 108, width: 268, height: 58, text: 'Скачать бесплатно', size: 23 })
  body += button.svg
  blocks.push({ name: 'cta', top: h - 108, bottom: h - 50 })

  const cardW = fitMockWidth(h - 140, 16, 520)
  const cardX = w - 56 - cardW
  const card = mockWindow({ x: cardX, y: 70, width: cardW, frame: 16 })
  body += card.svg
  rects.push({ name: 'card', left: cardX, top: 70, width: cardW, height: card.height })
  blocks.push({ name: 'card', top: 70, bottom: 70 + card.height, left: cardX, width: cardW })

  return { name: '02-превью-ссылки-1200x630.png', svg: document({ w, h, body }), zones, rects, blocks, w, h }
}

/** 1920 × 1080 — wide banner for headers and video thumbnails. */
async function wideBanner() {
  const zones = []
  const rects = []
  const blocks = []
  const w = 1920
  const h = 1080
  let body = ''

  body += logo(96, 80, 68).svg
  blocks.push({ name: 'logo', top: 80, bottom: 148, left: 96, width: 190 })

  const head = await textBlock(zones, {
    x: 96,
    y: 320,
    size: 92,
    weight: 700,
    lineHeight: 1.12,
    maxWidth: 840,
    text: 'Снимок экрана с рамкой и пометками',
    name: 'headline'
  })
  body += head.svg
  blocks.push({ name: 'headline', top: 320 - 92, bottom: head.bottom + 16, left: 96, width: 840 })

  const sub = await textBlock(zones, {
    x: 96,
    y: head.bottom + 84,
    size: 32,
    fill: C.muted,
    lineHeight: 1.42,
    maxWidth: 800,
    text: 'Выделил, подчеркнул, отправил. Одна горячая клавиша — и готовый файл уже в папке.',
    name: 'subtitle'
  })
  body += sub.svg
  blocks.push({ name: 'subtitle', top: sub.bottom - 32 * 1.42 * (sub.lines.length - 1) - 32, bottom: sub.bottom + 8, left: 96, width: 800 })

  let chipX = 96
  for (const label of ['Ровная линия с Shift', 'Снимок всего экрана', 'PNG · JPEG · WebP']) {
    const item = await chip({ x: chipX, y: sub.bottom + 62, text: label, size: 25, height: 56 })
    body += item.svg
    chipX += item.width + 16
  }
  blocks.push({ name: 'chips', top: sub.bottom + 62, bottom: sub.bottom + 118, left: 96, width: chipX - 96 })

  const cardW = fitMockWidth(h - 300, 22, 830)
  const cardX = w - 96 - cardW
  const card = mockWindow({ x: cardX, y: 250, width: cardW, frame: 22 })
  body += card.svg
  rects.push({ name: 'card', left: cardX, top: 250, width: cardW, height: card.height })
  blocks.push({ name: 'card', top: 250, bottom: 250 + card.height, left: cardX, width: cardW })

  const button = await pill({ x: 96, y: h - 190, width: 340, height: 76, text: 'Скачать бесплатно', size: 28 })
  body += button.svg
  blocks.push({ name: 'cta', top: h - 190, bottom: h - 114 })

  return { name: '03-широкий-1920x1080.png', svg: document({ w, h, body }), zones, rects, blocks, w, h }
}

/** 1080 × 1350 — the line tool, shown as an underlined row. */
async function lineFeature() {
  const zones = []
  const rects = []
  const blocks = []
  const w = 1080
  const h = 1350
  let body = ''

  body += logo(72, 68, 54).svg
  blocks.push({ name: 'logo', top: 68, bottom: 122 })

  const head = await textBlock(zones, {
    x: 72,
    y: 244,
    size: 64,
    weight: 700,
    lineHeight: 1.16,
    maxWidth: 930,
    text: 'Подчеркнуть строку — ровно, а не «на глазок»',
    name: 'headline'
  })
  body += head.svg
  blocks.push({ name: 'headline', top: 244 - 64, bottom: head.bottom + 14 })

  const sub = await textBlock(zones, {
    x: 72,
    y: head.bottom + 62,
    size: 28,
    fill: C.muted,
    lineHeight: 1.42,
    maxWidth: 900,
    text: 'Инструмент «Линия» с зажатым Shift прилипает к 0, 45 или 90 градусам. Рука больше не уводит подчёркивание на пару градусов.',
    name: 'subtitle'
  })
  body += sub.svg
  blocks.push({ name: 'subtitle', top: sub.bottom - 28 * 1.42 * (sub.lines.length - 1) - 28, bottom: sub.bottom + 8 })

  // The card fills everything between the copy and the footer.
  const ctaHeight = 76
  const ctaY = h - 96 - ctaHeight
  const cardTop = sub.bottom + 70
  const cardBottom = ctaY - 128
  const box = fillMock({ top: cardTop, bottom: cardBottom, frame: 0, maxWidth: 864, centreX: w / 2 })
  const cardX = box.x
  const cardW = box.width
  const cardY = box.y
  const cardH = Math.min(cardBottom - cardTop, Math.round(cardW * 0.525))

  body += shadow({ x: cardX, y: cardY, width: cardW, height: cardH, radius: 24 })
  body += `<rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="24" fill="#FFFFFF"/>\n`
  rects.push({ name: 'card', left: cardX, top: cardY, width: cardW, height: cardH })
  blocks.push({ name: 'card', top: cardY, bottom: cardY + cardH })

  const pad = 56
  const textX = cardX + pad
  const innerW = cardW - pad * 2
  const rowGap = Math.round((cardH - 210) / 4)
  const rows = [
    { factor: 0.74, color: '#C9CFDA' },
    { factor: 0.66, color: '#C9CFDA' },
    { factor: 0.7, color: '#20242E', underline: true },
    { factor: 0.58, color: '#C9CFDA' }
  ]
  rows.forEach((row, index) => {
    const rowW = Math.round(innerW * row.factor)
    const rowY = cardY + 78 + index * rowGap
    body += `<rect x="${textX}" y="${rowY}" width="${rowW}" height="16" rx="8" fill="${row.color}"/>\n`
    if (row.underline) {
      body += `<rect x="${textX - 8}" y="${rowY + 30}" width="${rowW + 26}" height="7" rx="3.5" fill="${C.red}"/>\n`
    }
  })

  const keyY = cardY + cardH - 104
  body += `<rect x="${textX}" y="${keyY}" width="150" height="58" rx="12" fill="#F1F3F8"/>\n`
  body += `<rect x="${textX}" y="${keyY}" width="150" height="58" rx="12" fill="none" stroke="#D3D9E4"/>\n`
  body += `<text x="${textX + 75}" y="${keyY + 39}" font-family="${FONT}" font-size="26" font-weight="600" fill="#4A5568" text-anchor="middle">Shift</text>\n`
  body += `<text x="${textX + 176}" y="${keyY + 39}" font-family="${FONT}" font-size="24" fill="#8A94A6">+ тянуть мышью</text>\n`

  const foot = await textBlock(zones, {
    x: 72,
    y: cardY + cardH + 56,
    size: 25,
    fill: C.faint,
    maxWidth: 936,
    text: 'Ещё: стрелка, рамка, карандаш, текст, нумерованные шаги и размытие',
    name: 'footnote'
  })
  body += foot.svg
  blocks.push({ name: 'footnote', top: cardY + cardH + 30, bottom: foot.bottom + 8 })

  const button = await pill({ x: 72, y: ctaY, width: 340, height: ctaHeight, text: 'Скачать бесплатно', size: 27 })
  body += button.svg
  blocks.push({ name: 'cta', top: ctaY, bottom: ctaY + ctaHeight })

  return { name: '04-линия-1080x1350.png', svg: document({ w, h, body }), zones, rects, blocks, w, h }
}

/** 1080 × 1920 — story / reel cover. */
async function storyCard() {
  const zones = []
  const rects = []
  const blocks = []
  const w = 1080
  const h = 1920
  let body = ''

  body += logo(88, 132, 72).svg
  blocks.push({ name: 'logo', top: 132, bottom: 204 })

  const head = await textBlock(zones, {
    x: 88,
    y: 470,
    size: 92,
    weight: 700,
    lineHeight: 1.14,
    maxWidth: 904,
    text: 'Скриншот, который выглядит дорого',
    name: 'headline'
  })
  body += head.svg
  blocks.push({ name: 'headline', top: 470 - 92, bottom: head.bottom + 18 })

  const sub = await textBlock(zones, {
    x: 88,
    y: head.bottom + 84,
    size: 32,
    fill: C.muted,
    lineHeight: 1.44,
    maxWidth: 900,
    text: 'Flushot ставит рамку, тень и скругляет углы. Остаётся выделить область и нажать Enter.',
    name: 'subtitle'
  })
  body += sub.svg
  blocks.push({ name: 'subtitle', top: sub.bottom - 32 * 1.44 * (sub.lines.length - 1) - 32, bottom: sub.bottom + 10 })

  const buttonY = h - 268
  const cardTop = sub.bottom + 96
  const cardBottom = buttonY - 84
  const frame = 20
  const box = bandMock({ top: cardTop, bottom: cardBottom, frame, width: 880, centreX: w / 2 })
  const card = mockWindow({ x: box.x, y: box.y, width: box.width, frame, aspect: box.aspect })
  body += card.svg
  rects.push({ name: 'card', left: box.x, top: box.y, width: box.width, height: card.height })
  blocks.push({ name: 'card', top: box.y, bottom: box.y + card.height })

  const button = await pill({ x: 88, y: buttonY, width: 400, height: 92, text: 'Скачать', size: 34 })
  body += button.svg
  blocks.push({ name: 'cta', top: buttonY, bottom: buttonY + 92 })

  const note = await textBlock(zones, {
    x: 88,
    y: buttonY + 148,
    size: 28,
    fill: C.faint,
    text: 'Бесплатно · Windows 10 и 11',
    name: 'note'
  })
  body += note.svg
  blocks.push({ name: 'note', top: buttonY + 148 - 28, bottom: buttonY + 148 + 12 })

  return { name: '05-сторис-1080x1920.png', svg: document({ w, h, body }), zones, rects, blocks, w, h }
}

/** 512 × 512 — avatar for the account itself. */
function avatar() {
  const size = 512
  // The avatar is the logo, full bleed. It used to be a gradient tile with a lens
  // drawn on top, which was a second, unrelated drawing: the profile picture and the
  // app icon looked like two different products.
  const body = markSvg(0, 0, size)
  return { name: '06-аватар-512.png', svg: document({ w: size, h: size, body }), zones: [], rects: [], blocks: [], w: size, h: size }
}

// ---------------------------------------------------------------- verification

/** Painted-pixel bbox inside a region. */
async function inkBox(file, region) {
  const left = Math.max(0, Math.round(region.left))
  const top = Math.max(0, Math.round(region.top))
  const width = Math.round(region.width)
  const height = Math.round(region.height)
  const { data, info } = await sharp(file)
    .extract({ left, top, width, height })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  let minX = Infinity
  let minY = Infinity
  let maxX = -1
  let maxY = -1
  let painted = 0
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 3
      const brightness = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
      if (brightness > 95) {
        painted++
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  return { painted, minX, minY, maxX, maxY, width: info.width, height: info.height }
}

function overlaps(a, b) {
  return a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height
}

async function main() {
  await fs.mkdir(OUT, { recursive: true })
  const cards = [
    await squareCard(),
    await linkPreview(),
    await wideBanner(),
    await lineFeature(),
    await storyCard(),
    avatar()
  ]

  const problems = []
  for (const card of cards) {
    const file = path.join(OUT, card.name)
    // Flatten to three channels: the background already covers every pixel, so
    // alpha carries no information, and some platforms mis-handle it on upload.
    await sharp(Buffer.from(card.svg)).flatten({ background: C.bg1 }).png({ compressionLevel: 9 }).toFile(file)
    const meta = await sharp(file).metadata()
    const stat = await fs.stat(file)

    for (const zone of card.zones) {
      if (zone.left < 0 || zone.top < 0 || zone.left + zone.width > card.w || zone.top + zone.height > card.h) {
        problems.push(`${card.name}: "${zone.name}" sticks out of the canvas`)
        continue
      }
      for (const rect of card.rects) {
        if (overlaps(zone, rect)) problems.push(`${card.name}: "${zone.name}" overlaps ${rect.name}`)
      }
      const box = await inkBox(file, zone)
      if (box.painted < 40) {
        problems.push(`${card.name}: "${zone.name}" is empty`)
        continue
      }
      if (box.maxX >= box.width - 1) {
        problems.push(
          `${card.name}: "${zone.name}" is clipped on the right (zone ${zone.left}+${zone.width}, ink maxX ${box.maxX}/${box.width})`
        )
      }
      if (box.maxY >= box.height - 1) problems.push(`${card.name}: "${zone.name}" is clipped at the bottom`)
      if (box.minY <= 0) problems.push(`${card.name}: "${zone.name}" is clipped at the top`)
    }

    // Nothing may touch the outermost 12 px: that is where platform crops bite.
    const band = 12
    for (const region of [
      { left: 0, top: 0, width: card.w, height: band },
      { left: 0, top: card.h - band, width: card.w, height: band },
      { left: 0, top: 0, width: band, height: card.h },
      { left: card.w - band, top: 0, width: band, height: card.h }
    ]) {
      const box = await inkBox(file, region)
      if (box.painted > 0) problems.push(`${card.name}: content inside the ${band}px safe border`)
    }

    // Vertical rhythm: no hole in the middle, no cramped or bottomless edges.
    if (card.blocks && card.blocks.length > 1) {
      const sorted = [...card.blocks].sort((a, b) => a.top - b.top)
      const first = sorted[0]
      const last = sorted[sorted.length - 1]
      if (first.top < 32) problems.push(`${card.name}: "${first.name}" starts too close to the top (${first.top}px)`)
      if (card.h - last.bottom < 32) problems.push(`${card.name}: only ${card.h - last.bottom}px under "${last.name}"`)
      // Only blocks that share horizontal space can collide or leave a hole
      // between them; a card on the right and copy on the left are independent.
      const extent = (block) => ({ left: block.left ?? 0, right: (block.left ?? 0) + (block.width ?? card.w) })
      for (let i = 1; i < sorted.length; i++) {
        const previous = sorted[i - 1]
        const current = sorted[i]
        const a = extent(previous)
        const b = extent(current)
        if (a.right <= b.left || b.right <= a.left) continue
        const gap = current.top - previous.bottom
        if (gap < 0) problems.push(`${card.name}: "${previous.name}" runs into "${current.name}" by ${-gap}px`)
        else if (gap > 260) problems.push(`${card.name}: ${gap}px hole between "${previous.name}" and "${current.name}"`)
      }
    }

    console.log(
      `${card.name.padEnd(34)} ${meta.width}×${meta.height}  ${(stat.size / 1024).toFixed(0)} KB  zones=${card.zones.length}`
    )
  }

  if (problems.length > 0) {
    console.error('\nPROBLEMS:')
    for (const problem of problems) console.error(' -', problem)
    process.exitCode = 1
  } else {
    console.log('\nAll text zones rendered, fit their boxes, and avoid the cards.')
  }
}

main().catch((error) => {
  console.error('FAILED', error)
  process.exit(1)
})
