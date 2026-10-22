/**
 * The synthetic picture used by demo mode (`?demo=1`).
 *
 * Demo mode exists so the overlay UI can be rendered and screenshotted without
 * grabbing the real screen — for the self-test, and for the marketing shots.
 * That makes this picture a product artefact, not a test fixture: it ends up on
 * the landing page and in the README. An earlier version was a gradient with a
 * few grey bars, which read as a placeholder at a glance and made every
 * screenshot look unfinished.
 *
 * This version draws a plausible desktop: a document window with a sidebar, real
 * headings, a table and a chart. Everything is a fixed pixel grid at 1280 × 720
 * so the result is stable, and `scripts/verify-demo-scene.cjs` measures the
 * rendered text to prove nothing overlaps or spills out of its column.
 */

const W = 1280
const H = 720

/** A soft drop shadow from stacked translucent rects — no filters, so the SVG
 *  renders identically in an <img>, a canvas and a screenshot. */
function shadow(x: number, y: number, width: number, height: number, radius: number, layers = 8): string {
  let out = ''
  for (let i = layers; i >= 1; i--) {
    const spread = i * 6
    out += `<rect x="${x - spread}" y="${y - spread + i * 4}" width="${width + spread * 2}" height="${height + spread * 2}" rx="${radius + spread}" fill="#000" opacity="${(0.03 * (layers - i + 1)) / layers}"/>`
  }
  return out
}

const FONT = 'Segoe UI, SF Pro Text, -apple-system, Helvetica Neue, Arial, sans-serif'

/** One line of text. Kept as a helper so sizes and colours stay consistent. */
interface TextOptions {
  x: number
  y: number
  size: number
  weight?: number
  fill?: string
  anchor?: 'start' | 'middle' | 'end'
  content: string
  family?: string
}

function text({ x, y, size, weight = 400, fill = '#4b5563', anchor = 'start', content, family = FONT }: TextOptions): string {
  const anchorAttr = anchor === 'start' ? '' : ` text-anchor="${anchor}"`
  return `<text x="${x}" y="${y}" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${fill}"${anchorAttr}>${content}</text>`
}

/** A rounded bar standing in for a line of body text. Used only in the sidebar. */
function lineBar(x: number, y: number, width: number, height: number, fill: string, radius = 3): string {
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${fill}"/>`
}

const SIDEBAR_ITEMS = [
  { label: 'Обзор', icon: 'grid' },
  { label: 'Документы', icon: 'file' },
  { label: 'Отчёты', icon: 'chart', active: true },
  { label: 'Команда', icon: 'people' },
  { label: 'Клиенты', icon: 'user' },
  { label: 'Настройки', icon: 'gear' }
]

function sidebarIcon(kind: string, x: number, y: number, color: string): string {
  const c = color
  switch (kind) {
    case 'grid':
      return `<rect x="${x}" y="${y}" width="7" height="7" rx="1.5" fill="${c}"/><rect x="${x + 9}" y="${y}" width="7" height="7" rx="1.5" fill="${c}"/><rect x="${x}" y="${y + 9}" width="7" height="7" rx="1.5" fill="${c}"/><rect x="${x + 9}" y="${y + 9}" width="7" height="7" rx="1.5" fill="${c}"/>`
    case 'file':
      return `<path d="M${x + 2} ${y}h9l5 5v9a2 2 0 0 1-2 2H${x + 2}a2 2 0 0 1-2-2V${y + 2}a2 2 0 0 1 2-2z" fill="none" stroke="${c}" stroke-width="1.6"/><path d="M${x + 11} ${y}v5h5" fill="none" stroke="${c}" stroke-width="1.6"/>`
    case 'chart':
      return `<rect x="${x + 1}" y="${y + 8}" width="4" height="8" rx="1.5" fill="${c}"/><rect x="${x + 7}" y="${y + 4}" width="4" height="12" rx="1.5" fill="${c}"/><rect x="${x + 13}" y="${y}" width="4" height="16" rx="1.5" fill="${c}"/>`
    case 'people':
      return `<circle cx="${x + 6}" cy="${y + 5}" r="3.2" fill="none" stroke="${c}" stroke-width="1.6"/><path d="M${x} ${y + 16}c0-3.4 2.7-6 6-6s6 2.6 6 6" fill="none" stroke="${c}" stroke-width="1.6"/><circle cx="${x + 13}" cy="${y + 6}" r="2.4" fill="none" stroke="${c}" stroke-width="1.4"/>`
    case 'user':
      return `<circle cx="${x + 8}" cy="${y + 6}" r="3.4" fill="none" stroke="${c}" stroke-width="1.6"/><path d="M${x + 2} ${y + 17}c0-3.3 2.7-6 6-6s6 2.7 6 6" fill="none" stroke="${c}" stroke-width="1.6"/>`
    default:
      return `<circle cx="${x + 8}" cy="${y + 8}" r="3" fill="none" stroke="${c}" stroke-width="1.6"/><path d="M${x + 8} ${y + 1}v2M${x + 8} ${y + 13}v2M${x + 1} ${y + 8}h2M${x + 13} ${y + 8}h2" stroke="${c}" stroke-width="1.6" stroke-linecap="round"/>`
  }
}

const TABLE_ROWS = [
  { name: 'Выручка, млн ₽', plan: '42,0', fact: '45,8', delta: '+9 %', up: true },
  { name: 'Новые клиенты', plan: '120', fact: '134', delta: '+12 %', up: true },
  { name: 'Средний чек, ₽', plan: '18 400', fact: '17 900', delta: '−3 %', up: false },
  { name: 'Отток, %', plan: '3,0', fact: '2,1', delta: '−0,9', up: true }
]

const BARS = [
  { label: 'Q4', height: 46 },
  { label: 'Q1', height: 64 },
  { label: 'Q2', height: 72 },
  { label: 'Q3', height: 104 }
]

export function demoSceneSvg(): string {
  const winX = 80
  const winY = 44
  const winW = 1120
  const winH = 632
  const titleH = 44
  const sideW = 232
  const contentX = 344
  const contentRight = winX + winW - 40

  // Title bar
  let svg = ''
  svg += shadow(winX, winY, winW, winH, 14)
  svg += `<rect x="${winX}" y="${winY}" width="${winW}" height="${winH}" rx="14" fill="#ffffff"/>`
  // Clip the flat title bar to the rounded corners of the window.
  svg += `<path d="M${winX + 14} ${winY}h${winW - 28}a14 14 0 0 1 14 14v${titleH - 14}H${winX}v${14 - titleH}a14 14 0 0 1 14-14z" fill="#f7f8fa"/>`
  svg += `<rect x="${winX}" y="${winY + titleH}" width="${winW}" height="1" fill="#e7e9ee"/>`

  svg += `<circle cx="${winX + 26}" cy="${winY + 22}" r="6" fill="#ff5f57"/>`
  svg += `<circle cx="${winX + 46}" cy="${winY + 22}" r="6" fill="#febc2e"/>`
  svg += `<circle cx="${winX + 66}" cy="${winY + 22}" r="6" fill="#28c840"/>`
  svg += text({
    x: winX + winW / 2,
    y: winY + 27,
    size: 13,
    weight: 500,
    fill: '#6b7280',
    anchor: 'middle',
    content: 'Квартальный отчёт — Q3 2026'
  })

  // Sidebar
  svg += `<rect x="${winX}" y="${winY + titleH + 1}" width="${sideW}" height="${winH - titleH - 1}" fill="#fafbfc"/>`
  svg += `<rect x="${winX + sideW}" y="${winY + titleH + 1}" width="1" height="${winH - titleH - 1}" fill="#e7e9ee"/>`

  SIDEBAR_ITEMS.forEach((item, index) => {
    const top = winY + titleH + 24 + index * 44
    if (item.active) {
      svg += `<rect x="${winX + 12}" y="${top}" width="${sideW - 24}" height="36" rx="8" fill="#eaf1ff"/>`
    }
    const color = item.active ? '#2563eb' : '#8a93a3'
    svg += sidebarIcon(item.icon, winX + 26, top + 10, color)
    svg += text({
      x: winX + 54,
      y: top + 24,
      size: 13.5,
      weight: item.active ? 600 : 400,
      fill: item.active ? '#1d4ed8' : '#4b5563',
      content: item.label
    })
  })

  // A "workspace" block at the bottom of the sidebar, the way real apps do it.
  const boxY = winY + winH - 96
  svg += `<rect x="${winX + 12}" y="${boxY}" width="${sideW - 24}" height="76" rx="10" fill="#f1f3f7"/>`
  svg += `<circle cx="${winX + 34}" cy="${boxY + 26}" r="11" fill="#c7d2fe"/>`
  svg += text({
    x: winX + 34,
    y: boxY + 30,
    size: 10,
    weight: 700,
    fill: '#4338ca',
    anchor: 'middle',
    content: 'АС'
  })
  svg += text({ x: winX + 54, y: boxY + 22, size: 12, weight: 600, fill: '#374151', content: 'А. Смирнов' })
  svg += text({ x: winX + 54, y: boxY + 40, size: 11, fill: '#8a93a3', content: 'Аналитик' })
  svg += lineBar(winX + 24, boxY + 56, sideW - 48, 8, '#dde2ea', 4)

  // Main column
  svg += text({ x: contentX, y: winY + 108, size: 26, weight: 700, fill: '#111827', content: 'Квартальный отчёт' })
  svg += text({
    x: contentX,
    y: winY + 132,
    size: 12.5,
    fill: '#8a93a3',
    content: 'Июль — сентябрь 2026 · обновлено 12 октября'
  })

  const paragraph = [
    'Выручка выросла на 18 % относительно прошлого квартала. Рост дали',
    'новые клиенты в среднем сегменте: 134 договора вместо плановых 120.',
    'Отток снизился до 2,1 % — лучший показатель за год.'
  ]
  paragraph.forEach((line, index) => {
    svg += text({ x: contentX, y: winY + 166 + index * 22, size: 13, fill: '#4b5563', content: line })
  })

  // Buttons
  const btnY = winY + 232
  svg += `<rect x="${contentX}" y="${btnY}" width="132" height="34" rx="8" fill="#2563eb"/>`
  svg += text({
    x: contentX + 66,
    y: btnY + 22,
    size: 12.5,
    weight: 600,
    fill: '#ffffff',
    anchor: 'middle',
    content: 'Скачать PDF'
  })
  svg += `<rect x="${contentX + 144}" y="${btnY}" width="122" height="34" rx="8" fill="#ffffff" stroke="#d8dce4"/>`
  svg += text({
    x: contentX + 205,
    y: btnY + 22,
    size: 12.5,
    weight: 500,
    fill: '#374151',
    anchor: 'middle',
    content: 'Поделиться'
  })

  // Chart card on the right of the header area
  const chartX = 848
  const chartY = winY + 92
  const chartW = contentRight - chartX
  const chartH = 188
  svg += `<rect x="${chartX}" y="${chartY}" width="${chartW}" height="${chartH}" rx="12" fill="#fbfcfe" stroke="#e7e9ee"/>`
  svg += text({ x: chartX + 18, y: chartY + 28, size: 12.5, weight: 600, fill: '#374151', content: 'Выручка по кварталам' })
  svg += text({ x: chartX + chartW - 18, y: chartY + 28, size: 12, fill: '#8a93a3', anchor: 'end', content: 'млн ₽' })

  const barBase = chartY + chartH - 34
  const barW = 34
  const gap = Math.floor((chartW - 36 - BARS.length * barW) / (BARS.length - 1))
  BARS.forEach((bar, index) => {
    const x = chartX + 18 + index * (barW + gap)
    const barH = bar.height
    const top = barBase - barH
    const fill = index === BARS.length - 1 ? '#2563eb' : '#c7d7f5'
    svg += `<rect x="${x}" y="${top}" width="${barW}" height="${barH}" rx="5" fill="${fill}"/>`
    svg += text({ x: x + barW / 2, y: barBase + 16, size: 11, fill: '#8a93a3', anchor: 'middle', content: bar.label })
  })

  // Table
  const tableY = winY + 316
  const colName = contentX
  const colPlan = 700
  const colFact = 850
  const colDelta = contentRight

  svg += text({ x: colName, y: tableY, size: 11.5, weight: 600, fill: '#8a93a3', content: 'ПОКАЗАТЕЛЬ' })
  svg += text({ x: colPlan, y: tableY, size: 11.5, weight: 600, fill: '#8a93a3', anchor: 'end', content: 'ПЛАН' })
  svg += text({ x: colFact, y: tableY, size: 11.5, weight: 600, fill: '#8a93a3', anchor: 'end', content: 'ФАКТ' })
  svg += text({ x: colDelta, y: tableY, size: 11.5, weight: 600, fill: '#8a93a3', anchor: 'end', content: 'Δ' })
  svg += `<rect x="${contentX}" y="${tableY + 10}" width="${contentRight - contentX}" height="1" fill="#e7e9ee"/>`

  TABLE_ROWS.forEach((row, index) => {
    const y = tableY + 40 + index * 38
    if (index > 0) {
      svg += `<rect x="${contentX}" y="${y - 25}" width="${contentRight - contentX}" height="1" fill="#f0f2f6"/>`
    }
    svg += text({ x: colName, y, size: 13, fill: '#374151', content: row.name })
    svg += text({ x: colPlan, y, size: 13, fill: '#6b7280', anchor: 'end', content: row.plan })
    svg += text({ x: colFact, y, size: 13, weight: 600, fill: '#111827', anchor: 'end', content: row.fact })
    svg += text({
      x: colDelta,
      y,
      size: 12.5,
      weight: 600,
      fill: row.up ? '#12805c' : '#b3261e',
      anchor: 'end',
      content: row.delta
    })
  })

  // Status bar
  const statusY = winY + winH - 34
  svg += `<rect x="${winX + 1}" y="${statusY}" width="${winW - 2}" height="33" fill="#fafbfc"/>`
  svg += `<path d="M${winX + 1} ${statusY + 33}h${winW - 2}v-14a14 14 0 0 0-14-14H${winX + 15}a14 14 0 0 0-14 14z" fill="#fafbfc"/>`
  svg += `<rect x="${winX + 1}" y="${statusY}" width="${winW - 2}" height="1" fill="#e7e9ee"/>`
  svg += text({ x: contentX, y: statusY + 21, size: 11.5, fill: '#8a93a3', content: 'Все изменения сохранены' })
  svg += circleAvatar(winX + winW - 120, statusY + 17, '#c7d2fe', '#4338ca', 'АС', 11)
  svg += circleAvatar(winX + winW - 98, statusY + 17, '#bbf7d0', '#15803d', 'МК', 11)
  svg += text({ x: winX + winW - 80, y: statusY + 21, size: 11.5, fill: '#8a93a3', content: '+3' })

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
  <linearGradient id="wall" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#1b2436"/>
    <stop offset="0.5" stop-color="#243049"/>
    <stop offset="1" stop-color="#161d2b"/>
  </linearGradient>
  <radialGradient id="glowA" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0" stop-color="#3b82f6" stop-opacity="0.35"/>
    <stop offset="1" stop-color="#3b82f6" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="glowB" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0" stop-color="#8b5cf6" stop-opacity="0.3"/>
    <stop offset="1" stop-color="#8b5cf6" stop-opacity="0"/>
  </radialGradient>
</defs>
<rect width="${W}" height="${H}" fill="url(#wall)"/>
<circle cx="1080" cy="80" r="420" fill="url(#glowA)"/>
<circle cx="180" cy="660" r="380" fill="url(#glowB)"/>
${svg}
</svg>`
}

/** Small round avatar with initials. */
function circleAvatar(cx: number, cy: number, background: string, color: string, initials: string, r: number): string {
  return (
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${background}"/>` +
    `<text x="${cx}" y="${cy + 3.5}" font-family="${FONT}" font-size="8" font-weight="700" fill="${color}" text-anchor="middle">${initials}</text>`
  )
}

/** Ready-to-use `data:` URL for an `<img src>`. */
export function demoSceneUrl(): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(demoSceneSvg())}`
}
