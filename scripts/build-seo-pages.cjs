/**
 * Builds the search-optimised pages from `scripts/seo-pages.cjs`.
 *
 * Each page is written twice: `site/<slug>/index.html` in Russian and `site/en/<slug>/index.html`
 * in English. Both come from the same template and the same data, so the two languages cannot
 * drift apart — which is the failure mode of the landing page's translation table, where the
 * Russian document is edited and the table quietly stops matching.
 *
 * The markup reuses the landing page's own classes — `.wrap`, `.section`, `.hero`, `.feature-grid`,
 * `.feature`, `.pitch__list`, `.shot`, `.shot-caption`, `.faq`, `.cta`, `.footer` — so these pages
 * are the same design rather than a second one to maintain. Only the long-form prose and the
 * cross-links need rules of their own, and those live in `styles.css` under a marked block.
 *
 * Usage: node scripts/build-seo-pages.cjs
 */

const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { PAGES } = require('./seo-pages.cjs')

const ROOT = path.join(__dirname, '..')
const SITE = path.join(ROOT, 'site')
const ORIGIN = 'https://flushot.ink'
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version

/**
 * Icons on the site's own 24-unit grid, as inline path data.
 *
 * Kept in the builder rather than in the content file because they are decoration, not copy: the
 * content file holds what each block says, and this holds how a feature card is drawn.
 */
const ICONS = {
  cursor: '<path d="M5 3l6 17 2.2-6.8L20 11z"/>',
  screen: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8"/><path d="M12 16v4"/>',
  frame: '<rect x="3" y="3" width="18" height="18" rx="4"/><rect x="7.5" y="7.5" width="9" height="9" rx="1.5"/>',
  pen: '<path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14.5 6.5l3 3"/>',
  text: '<path d="M5 6h14"/><path d="M12 6v13"/><path d="M9 19h6"/>',
  keys: '<rect x="2" y="6" width="20" height="12" rx="2.5"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  arrow: '<path d="M4 20l13-8"/><path d="M13 8l4 4-4 4"/>',
  blur: '<circle cx="9" cy="9" r="3"/><circle cx="15.5" cy="14" r="3"/><path d="M3.5 3.5l17 17"/>',
  shield: '<path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z"/>'
}

/**
 * Real dimensions of every screenshot, read from the files.
 *
 * Taken from disk rather than from a table: the declared width and height have to match the picture
 * exactly, both so the layout does not jump as it loads and so `verify-site.cjs` can hold the two
 * together. A hand-written table is a table that goes stale the next time an asset is regenerated —
 * which had already happened once.
 */
function pictureSize(name, lang) {
  const file = path.join(SITE, lang === 'en' ? 'assets/en' : 'assets', `${name}.png`)
  const buffer = fs.readFileSync(file)
  // PNG stores its dimensions in the IHDR chunk, bytes 16..23. Reading them here keeps the builder
  // free of an image library for one number.
  if (buffer.toString('latin1', 12, 16) !== 'IHDR') throw new Error(`${file} is not a PNG`)
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)]
}

/** Escape a string for an HTML attribute. */
function attr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Escape a string for use as element text. */
function text(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Fill `{version}`-style placeholders. */
function fill(value) {
  return value.replace(/\{version\}/g, VERSION)
}

/**
 * The `<picture>` block for one screenshot.
 *
 * Both formats are offered and the fallback declares the file's real dimensions: without them
 * the page jumps as the image arrives, which on a text page is the difference between reading
 * and being interrupted.
 */
function picture(name, alt, prefix, lang, eager) {
  const size = pictureSize(name, lang)
  const folder = lang === 'en' ? `${prefix}assets/en/` : `${prefix}assets/`
  const loading = eager ? ' fetchpriority="high"' : ' loading="lazy"'
  const indent = '              '
  return [
    '<picture>',
    `${indent}<source srcset="${folder}${name}.webp" type="image/webp">`,
    `${indent}<img src="${folder}${name}.png" width="${size[0]}" height="${size[1]}"`,
    `${indent}     alt="${attr(alt)}"${loading} decoding="async">`,
    `${indent.slice(2)}</picture>`
  ].join('\n')
}

/** One block of the page body. */
function renderBlock(block, page, lang, prefix, index) {
  const pick = (value) => (typeof value === 'string' ? value : value[lang])
  const headingId = `${page.slug}-${index}`

  if (block.type === 'features') {
    const cards = block.items
      .map(
        (item) => `            <article class="feature">
              <span class="feature__mark" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${ICONS[item.icon] || ICONS.frame}</svg>
              </span>
              <h3 class="feature__name">${text(pick(item.name))}</h3>
              <p class="feature__text">${text(pick(item.text))}</p>
              ${item.tag ? `<p class="feature__tag">${text(pick(item.tag))}</p>` : ''}
            </article>`
      )
      .join('\n')
    // A seven-item grid in three columns leaves two empty cells, and this design draws borders
    // per cell — an empty last row shows as a hole. Seven items therefore go in two columns.
    return `      <section class="section" aria-labelledby="${headingId}">
        <div class="wrap">
          <div class="section-head">
            <h2 class="section-title" id="${headingId}">${text(pick(block.title))}</h2>
            ${block.lead ? `<p class="section-lead">${text(pick(block.lead))}</p>` : ''}
          </div>
          <div class="feature-grid${block.items.length % 3 === 0 ? '' : ' feature-grid--loose'}">
${cards}
          </div>
        </div>
      </section>`
  }

  if (block.type === 'steps') {
    const steps = block.items
      .map(
        (item, position) => `            <li class="pitch__item">
              <span class="pitch__num" aria-hidden="true">${position + 1}</span>
              <span class="seo-step">
                <h3 class="seo-step__name">${text(pick(item.name))}</h3>
                <span class="seo-step__text">${text(pick(item.text))}</span>
              </span>
            </li>`
      )
      .join('\n')
    return `      <section class="section" aria-labelledby="${headingId}">
        <div class="wrap">
          <div class="section-head">
            <h2 class="section-title" id="${headingId}">${text(pick(block.title))}</h2>
            ${block.lead ? `<p class="section-lead">${text(pick(block.lead))}</p>` : ''}
          </div>
          <ol class="pitch__list seo-steps">
${steps}
          </ol>
        </div>
      </section>`
  }

  if (block.type === 'figure') {
    const [naturalWidth] = pictureSize(block.image, lang)
    const shownWidth = Math.min(880, Math.round(naturalWidth / 2))
    return `      <section class="section">
        <div class="wrap">
          <figure class="seo-figure" style="max-width: ${shownWidth}px">
            <div class="shot">
${picture(block.image, pick(block.alt), prefix, lang, false)}
            </div>
            <figcaption class="shot-caption">${text(pick(block.caption))}</figcaption>
          </figure>
        </div>
      </section>`
  }

  if (block.type === 'prose') {
    const paragraphs = block.paragraphs.map((paragraph) => `            <p>${text(pick(paragraph))}</p>`).join('\n')
    return `      <section class="section" aria-labelledby="${headingId}">
        <div class="wrap">
          <div class="seo-prose">
            <h2 class="section-title" id="${headingId}">${text(pick(block.title))}</h2>
${paragraphs}
          </div>
        </div>
      </section>`
  }

  if (block.type === 'faq') {
    const entries = block.items
      .map(
        (item) => `            <details>
              <summary>${text(pick(item.q))}</summary>
              <p>${text(pick(item.a))}</p>
            </details>`
      )
      .join('\n')
    return `      <section class="section" aria-labelledby="${headingId}">
        <div class="wrap">
          <div class="section-head">
            <h2 class="section-title" id="${headingId}">${text(pick(block.title))}</h2>
          </div>
          <div class="faq">
${entries}
          </div>
${renderRelated(page, lang, prefix)}
        </div>
      </section>`
  }

  throw new Error(`unknown block type "${block.type}"`)
}

/**
 * Links to the other pages and back to the landing page.
 *
 * Every page links to every other one, which is what stops these being five islands that only
 * the sitemap knows about: a crawler that enters on one page can reach all of them and the main
 * page without going through an index nobody visits.
 */
function renderRelated(page, lang, prefix) {
  const isEnglish = lang === 'en'
  const href = (other) => (isEnglish ? `${prefix}en/${other.slug}/` : `${prefix}${other.slug}/`)

  // One link per other page, named by the question that page answers rather than by its title: a
  // reader who has just finished this page is looking for the next *question*, and repeating the
  // titles would read as a table of contents of the site instead of a way onward.
  const others = PAGES.filter((candidate) => candidate.slug !== page.slug)
    .map((other) => ({ href: href(other), label: other.alsoAbout[lang] }))
    .concat([{ href: isEnglish ? `${prefix}en/` : prefix, label: isEnglish ? 'everything else, on the main page' : 'всё остальное — на главной' }])

  const links = others
    .map((item) => `<a class="seo-also__link" href="${item.href}">${text(item.label)}</a>`)
    .join('<span class="seo-also__sep" aria-hidden="true">·</span>')

  return `          <nav class="seo-also" aria-label="${attr(isEnglish ? 'More about Flushot' : 'Ещё про Flushot')}">
            <span class="seo-also__lead">${text(isEnglish ? 'Read next' : 'Читать дальше')}</span>
            ${links}
          </nav>`
}

/**
 * Structured data: what the program is, the questions on this page, and where the page sits.
 *
 * The FAQ block is what Yandex turns into an expandable answer, which is the reason these pages
 * carry a questions section at all. The breadcrumb is what makes the address show as a path
 * rather than a bare URL.
 */
function renderSchema(page, lang, canonical, homeUrl) {
  const pick = (value) => (typeof value === 'string' ? value : value[lang])
  const faq = page.blocks.find((block) => block.type === 'faq')

  const graph = [
    {
      '@type': 'SoftwareApplication',
      '@id': `${ORIGIN}/#software`,
      name: 'Flushot',
      applicationCategory: 'UtilitiesApplication',
      operatingSystem: 'Windows 10, Windows 11',
      softwareVersion: VERSION,
      description: page.description[lang],
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'RUB' },
      inLanguage: lang
    },
    {
      '@type': 'WebPage',
      '@id': canonical,
      url: canonical,
      name: page.title[lang],
      description: page.description[lang],
      inLanguage: lang,
      isPartOf: { '@id': `${ORIGIN}/#website` },
      primaryImageOfPage: `${ORIGIN}/og-image${lang === 'en' ? '-en' : ''}.png`
    },
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: lang === 'en' ? 'Home' : 'Главная', item: homeUrl },
        { '@type': 'ListItem', position: 2, name: pick(page.nav), item: canonical }
      ]
    }
  ]

  if (faq) {
    graph.push({
      '@type': 'FAQPage',
      '@id': `${canonical}#faq`,
      inLanguage: lang,
      mainEntity: faq.items.map((item) => ({
        '@type': 'Question',
        name: pick(item.q),
        acceptedAnswer: { '@type': 'Answer', text: pick(item.a) }
      }))
    })
  }

  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }, null, 2)
}

/** One whole page, in one language. */
function renderPage(page, lang) {
  const isEnglish = lang === 'en'
  // A Russian page sits one directory deep, the English one two, so the site root is one or two
  // `..` away and every local reference has to climb exactly that far.
  const prefix = isEnglish ? '../../' : '../'
  const canonical = isEnglish ? `${ORIGIN}/en/${page.slug}/` : `${ORIGIN}/${page.slug}/`
  const altUrl = isEnglish ? `${ORIGIN}/${page.slug}/` : `${ORIGIN}/en/${page.slug}/`
  const homeUrl = isEnglish ? `${ORIGIN}/en/` : `${ORIGIN}/`
  const homeHref = isEnglish ? `${prefix}en/` : prefix
  const switchHref = isEnglish ? `${prefix}${page.slug}/` : `${prefix}en/${page.slug}/`
  const ogImage = `${ORIGIN}/og-image${isEnglish ? '-en' : ''}.png`
  const downloadHref = `${prefix}${isEnglish ? 'en/' : ''}#download`
  const faqHref = `${prefix}${isEnglish ? 'en/' : ''}#faq`
  const featuresHref = `${prefix}${isEnglish ? 'en/' : ''}#features`

  const pick = (value) => (typeof value === 'string' ? value : value[lang])

  const navLinks = isEnglish
    ? [
        ['Features', featuresHref],
        ['How it works', `${prefix}en/#how`],
        ['Downloads', downloadHref],
        ['Questions', faqHref]
      ]
    : [
        ['Возможности', featuresHref],
        ['Как работает', `${prefix}#how`],
        ['Скачать', downloadHref],
        ['Вопросы', faqHref]
      ]

  const copy = {
    skip: isEnglish ? 'Skip to content' : 'Перейти к содержимому',
    brandHome: isEnglish ? 'Flushot — home' : 'Flushot — на главную',
    menu: isEnglish ? 'Menu' : 'Меню',
    mainNav: isEnglish ? 'Main navigation' : 'Основная навигация',
    theme: isEnglish ? 'Switch to the light theme' : 'Переключить на светлую тему',
    heroNote1: isEnglish ? 'No ads and no telemetry ·' : 'Без рекламы и телеметрии ·',
    heroNote2: isEnglish ? 'the installer updates itself' : 'установщик обновляется сам',
    heroSecondary: isEnglish ? 'All features' : 'Все возможности',
    download: isEnglish ? 'Download for Windows' : 'Скачать для Windows',
    downloadShort: isEnglish ? 'Download' : 'Скачать',
    ctaTitle: isEnglish ? 'Try it on a single screenshot' : 'Попробуйте на одном скриншоте',
    ctaSub: isEnglish
      ? 'If you do not like it, removing it is as easy as unzipping it.'
      : 'Если не понравится — удалить так же просто, как распаковать.',
    ctaDownload: isEnglish ? `Download Flushot ${VERSION}` : `Скачать Flushot ${VERSION}`,
    ctaSecondary: isEnglish ? 'Questions first' : 'Сначала вопросы',
    ctaMeta: isEnglish ? '105 MB · no sign-up · no analytics' : '105 МБ · без регистрации · без аналитики',
    footerNav: isEnglish ? 'Footer navigation' : 'Навигация в подвале',
    footerVersion: isEnglish ? `Version ${VERSION} · © 2026 Flushot` : `Версия ${VERSION} · © 2026 Flushot`,
    privacy: isEnglish ? 'Privacy' : 'Приватность',
    switchLabel: isEnglish ? 'Русская версия' : 'English version',
    switchLang: isEnglish ? 'ru' : 'en',
    switchText: isEnglish ? 'RU' : 'EN',
    home: isEnglish ? 'Home' : 'Главная'
  }

  const body = page.blocks.map((block, index) => renderBlock(block, page, lang, prefix, index + 1)).join('\n\n')

  const footerPages = PAGES.map(
    (other) => `      <a href="${isEnglish ? `${prefix}en/${other.slug}/` : `${prefix}${other.slug}/`}">${text(other.nav[lang])}</a>`
  ).join('\n')

  return `<!DOCTYPE html>
<html lang="${lang}" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${text(page.title[lang])}</title>
<meta name="description" content="${attr(page.description[lang])}">
<meta name="theme-color" content="#fafafa" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#09090b" media="(prefers-color-scheme: dark)">
<meta name="color-scheme" content="dark light">
<link rel="canonical" href="${canonical}">
<link rel="alternate" hreflang="ru" href="${isEnglish ? altUrl : canonical}">
<link rel="alternate" hreflang="en" href="${isEnglish ? canonical : altUrl}">
<link rel="alternate" hreflang="x-default" href="${isEnglish ? altUrl : canonical}">

<meta property="og:type" content="article">
<meta property="og:site_name" content="Flushot">
<meta property="og:url" content="${canonical}">
<meta property="og:title" content="${attr(page.ogTitle[lang])}">
<meta property="og:description" content="${attr(page.description[lang])}">
<meta property="og:image" content="${ogImage}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:locale" content="${isEnglish ? 'en_GB' : 'ru_RU'}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${attr(page.ogTitle[lang])}">
<meta name="twitter:description" content="${attr(page.description[lang])}">
<meta name="twitter:image" content="${ogImage}">

<link rel="icon" href="${prefix}favicon.svg" type="image/svg+xml">
<link rel="icon" href="${prefix}favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="${prefix}apple-touch-icon.png">
<link rel="manifest" href="${prefix}site.webmanifest">
<link rel="stylesheet" href="${prefix}fonts.css">
<link rel="stylesheet" href="${prefix}styles.css">

<script>
  // Before the first paint, so the page does not flash light on a dark desktop.
  (function () {
    try {
      var saved = localStorage.getItem('flushot-theme');
      document.documentElement.dataset.theme =
        saved === 'dark' || saved === 'light' ? saved : 'dark';
    } catch (error) {
      document.documentElement.dataset.theme = 'dark';
    }
  })();
</script>
</head>
<body>
<a class="skip" href="#main">${copy.skip}</a>

<header class="header">
  <div class="nav-inner">
    <a class="brand" href="${homeHref}" aria-label="${attr(copy.brandHome)}">
      <img class="brand__mark" src="${prefix}favicon.svg" width="200" height="200" alt="" aria-hidden="true">
      <span class="brand__name">Flushot</span>
      <span class="brand__ver">${VERSION}</span>
    </a>

    <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="nav" aria-label="${attr(copy.menu)}">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <path d="M4 7h16M4 12h16M4 17h16"/>
      </svg>
    </button>

    <div class="nav-right" id="nav">
      <nav class="nav-links" aria-label="${attr(copy.mainNav)}">
${navLinks.map(([label, href]) => `        <a class="nav-link" href="${href}">${text(label)}</a>`).join('\n')}
      </nav>
      <a class="lang-switch" href="${switchHref}" hreflang="${copy.switchLang}" lang="${copy.switchLang}" data-lang-switch
         aria-label="${attr(copy.switchLabel)}">${copy.switchText}</a>
      <button class="theme-toggle" type="button" data-theme-toggle aria-label="${attr(copy.theme)}">
        <svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4"/>
          <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>
        </svg>
        <svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>
        </svg>
      </button>
      <a class="btn btn--primary nav-cta" href="${downloadHref}">${text(copy.downloadShort)}</a>
    </div>
  </div>
  <span class="header__progress" data-progress aria-hidden="true"></span>
</header>

<main id="main">
  <section class="hero hero--seo" id="top">
    <div class="hero__grid" aria-hidden="true"></div>
    <div class="hero__glow" aria-hidden="true"></div>
    <div class="wrap hero__inner">
      <p class="eyebrow" data-rise style="--d: 0.05s">${text(fill(pick(page.eyebrow)))}</p>
      <h1 class="hero__title" data-rise style="--d: 0.1s">
        <span>${text(page.h1[lang])}</span>
      </h1>
      <p class="hero__sub" data-rise style="--d: 0.16s">${text(fill(pick(page.lead)))}</p>
      <div class="hero__actions" data-rise style="--d: 0.22s">
        <a class="btn btn--primary btn--lg" href="${downloadHref}">
          <svg class="btn__icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M4 20h16"/>
          </svg>
          ${text(copy.download)}
        </a>
        <a class="btn btn--ghost btn--lg" href="${featuresHref}">${text(copy.heroSecondary)}</a>
      </div>
      <p class="hero__note" data-rise style="--d: 0.26s">
        <span>${text(copy.heroNote1)}</span>
        <a href="${downloadHref}">${text(copy.heroNote2)}</a>
      </p>

      <figure class="hero__preview" data-rise style="--d: 0.3s">
        <div class="hero__frame">
${picture(page.heroImage, pick(page.heroAlt), prefix, lang, true)}
        </div>
      </figure>
    </div>
  </section>

${body}

  <section class="cta" aria-labelledby="${page.slug}-cta">
    <div class="wrap cta__inner">
      <h2 class="cta__title" id="${page.slug}-cta">${text(copy.ctaTitle)}</h2>
      <p class="cta__sub">${text(copy.ctaSub)}</p>
      <div class="cta__actions">
        <a class="btn btn--primary btn--lg" href="${downloadHref}">
          <svg class="btn__icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M4 20h16"/>
          </svg>
          ${text(copy.ctaDownload)}
        </a>
        <a class="btn btn--ghost btn--lg" href="${faqHref}">${text(copy.ctaSecondary)}</a>
      </div>
      <p class="cta__meta">${text(copy.ctaMeta)}</p>
    </div>
  </section>
</main>

<footer class="footer">
  <div class="footer__inner">
    <div class="footer__brand">
      <img class="brand__mark" src="${prefix}favicon.svg" width="200" height="200" alt="" aria-hidden="true">
      <span>${text(copy.footerVersion)}</span>
    </div>
    <nav class="footer__links" aria-label="${attr(copy.footerNav)}">
      <a href="${homeHref}">${text(copy.home)}</a>
${footerPages}
      <a href="${prefix}${isEnglish ? 'en/' : ''}privacy.html">${text(copy.privacy)}</a>
    </nav>
  </div>
</footer>

<script type="application/ld+json">
${renderSchema(page, lang, canonical, homeUrl)}
</script>

<script src="${prefix}app.js" defer></script>
<script src="${prefix}metrics.js" defer></script>
</body>
</html>
`
}

const written = []
for (const page of PAGES) {
  const russian = path.join(SITE, page.slug, 'index.html')
  const english = path.join(SITE, 'en', page.slug, 'index.html')
  fs.mkdirSync(path.dirname(russian), { recursive: true })
  fs.mkdirSync(path.dirname(english), { recursive: true })
  fs.writeFileSync(russian, renderPage(page, 'ru'), 'utf8')
  fs.writeFileSync(english, renderPage(page, 'en'), 'utf8')
  written.push(page.slug)
}

// The asset stamps belong in the same command: the pages just written carry none, and
// "generate, then forget to stamp" is a failure this project has already had once.
execFileSync(process.execPath, [path.join(__dirname, 'stamp-assets.cjs')], { cwd: ROOT, stdio: 'ignore' })

console.log(`built ${written.length * 2} pages: ${written.join(', ')}`)
