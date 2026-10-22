import { describe, expect, it } from 'vitest'
import {
  lineBox,
  looksLikeText,
  majorityScript,
  mergeReadings,
  noiseShare,
  overlapRatio,
  reliabilityScore,
  repairBackslashWords,
  resultScore,
  scriptOf,
  scriptShare,
  scriptWordFixes,
  tailWords,
  textScore,
  voteWords,
  withTail
} from '../src/main/ocr/merge'
import type { OcrRawResult } from '../src/main/ocr/worker'
import type { OcrLine } from '../src/shared/types'

/**
 * These are the tests that matter for accuracy: they run without Windows, without
 * the engine, and they encode the behaviour measured on real screenshots.
 */

/** A line with one word box, so the merge has geometry to work with. */
function line(text: string, x = 0, y = 0, width = 300, height = 20): OcrLine {
  return { text, words: [{ text, x, y, width, height }] }
}

function reading(lang: string, lines: OcrLine[]): OcrRawResult {
  return { lang, lines }
}

describe('scriptOf', () => {
  it('knows which languages are written in Cyrillic', () => {
    expect(scriptOf('ru')).toBe('cyrillic')
    expect(scriptOf('ru-RU')).toBe('cyrillic')
    expect(scriptOf('uk-UA')).toBe('cyrillic')
    expect(scriptOf('bg')).toBe('cyrillic')
  })

  it('treats everything else as its own script', () => {
    expect(scriptOf('en-US')).toBe('latin')
    expect(scriptOf('de')).toBe('latin')
    expect(scriptOf('zh-Hans')).toBe('han')
    expect(scriptOf('ja')).toBe('han')
    expect(scriptOf('ko')).toBe('hangul')
    expect(scriptOf('ar-SA')).toBe('arabic')
  })
})

describe('textScore', () => {
  it('scores real text of its own script high', () => {
    expect(textScore('Квартальный отчёт', 'cyrillic')).toBe(1)
    expect(textScore('Quarterly report', 'latin')).toBe(1)
  })

  it('marks down the lookalike output a wrong-language engine produces', () => {
    // Exact strings the English engine returned for a Russian screen
    // (`.tmp/ocr-bench.cjs`). The signature is capital density: these run at
    // 47–70 % capitals, while real prose runs at a few percent.
    expect(textScore('KBaPTanbHbli OT"äT', 'latin')).toBeLessThan(0.6)
    expect(textScore('oooPMnEHVIE', 'latin')).toBeLessThan(0.6)
  })

  it('does not catch every lookalike, and says so', () => {
    // Honest limit, measured: "Bblpyvxa Bblpocna Ha" is only 14 % capitals and
    // scores as plausible. It is harmless because a losing engine's line is only
    // ever *added* where the winner found nothing, never used to replace one.
    expect(textScore('Bblpyvxa Bblpocna Ha 18 %', 'latin')).toBeGreaterThan(0.8)
    expect(textScore('HaapoVIKM npmnoxeHv•1R', 'latin')).toBeLessThan(0.8)
  })

  it('does not punish legitimate mixed text', () => {
    // Real Russian UI text with a Latin shortcut in it: the Cyrillic engine read
    // this correctly and must not be marked down for it.
    expect(textScore('Горячая клавиша: Ctrl+Shift+S', 'cyrillic')).toBeGreaterThan(0.8)
    expect(textScore('Скопировать в буфер: Ctrl+C', 'cyrillic')).toBeGreaterThan(0.8)
  })

  it('does not punish acronyms or camelCase', () => {
    // Both of these used to score as garbage: counting capitals without skipping
    // all-caps words made "PNG" 100 % capitals, and counting case changes made
    // "getPath" look as irregular as a misread.
    expect(textScore('PNG JPEG API JSON', 'latin')).toBe(1)
    expect(textScore('app.getPath("userData")', 'latin')).toBe(1)
    expect(textScore('electron-builder --win nsis portable', 'latin')).toBe(1)
  })

  it('scores an empty line as zero', () => {
    expect(textScore('', 'latin')).toBe(0)
    expect(textScore('123 456', 'latin')).toBe(0)
  })
})

describe('resultScore', () => {
  it('rates a reading in the right script above lookalikes', () => {
    const russian = reading('ru', [line('Квартальный отчёт'), line('Выручка выросла на 18 %')])
    const english = reading('en-US', [line('KBaPTanbHbli OT"äT'), line('Bblpyvxa Bblpocna Ha 18 %')])
    expect(resultScore(russian)).toBeGreaterThan(resultScore(english))
  })

  it('rates English text the other way round', () => {
    const english = reading('en-US', [line('Quarterly report'), line('Revenue grew by 18%')])
    const russian = reading('ru', [line('Q.uarterly report'), line('Revenue grew by 18%')])
    expect(resultScore(english)).toBeGreaterThanOrEqual(resultScore(russian))
  })

  it('scores an empty reading as zero, not as perfect', () => {
    expect(resultScore(reading('ru', []))).toBe(0)
    expect(resultScore(reading('ru', [line('')]))).toBe(0)
  })

  it('cannot tell a split picture apart — the reason ranking moved to lines', () => {
    // Each engine is perfect on half the picture. The whole-reading score is nearly
    // equal by construction, so it has no way to prefer either — which is exactly
    // why the merge stopped asking this question and started asking it per line.
    const russian = reading('ru', [line('Настройки приложения'), line('App1ication settings')])
    const english = reading('en-US', [line('HacTpoVIKM npnnoxeHL'), line('Application settings')])
    expect(Math.abs(resultScore(russian) - resultScore(english))).toBeLessThan(0.25)
  })
})

describe('looksLikeText', () => {
  it('accepts a line the losing engine saw and the winner did not', () => {
    // The real case: the Russian engine dropped this line entirely.
    expect(looksLikeText('app.getPath("userData")', 'latin')).toBe(true)
  })

  it('rejects lookalike output with heavy capital churn', () => {
    expect(looksLikeText('KBaPTanbHbli', 'latin')).toBe(false)
  })

  it('rejects a word that mixes two scripts', () => {
    expect(looksLikeText('nрmoжeHv', 'latin')).toBe(false)
  })

  it('rejects something too short to judge', () => {
    expect(looksLikeText('ab', 'latin')).toBe(false)
    expect(looksLikeText('--', 'latin')).toBe(false)
  })
})

describe('line geometry', () => {
  it('takes the union of the word boxes', () => {
    const box = lineBox({
      text: 'two words',
      words: [
        { text: 'two', x: 10, y: 5, width: 30, height: 12 },
        { text: 'words', x: 50, y: 6, width: 40, height: 12 }
      ]
    })
    expect(box).toEqual({ x: 10, y: 5, width: 80, height: 13 })
  })

  it('returns null when there is no usable box', () => {
    expect(lineBox({ text: 'x', words: [] })).toBeNull()
    expect(lineBox({ text: 'x', words: [{ text: 'x', x: 0, y: 0, width: 0, height: 0 }] })).toBeNull()
  })

  it('measures overlap, not distance', () => {
    const a = { x: 0, y: 0, width: 100, height: 20 }
    expect(overlapRatio(a, a)).toBe(1)
    expect(overlapRatio(a, { x: 0, y: 100, width: 100, height: 20 })).toBe(0)
    // A line on the same row, shifted: still the same line.
    expect(overlapRatio(a, { x: 10, y: 2, width: 100, height: 20 })).toBeGreaterThan(0.6)
  })
})

/**
 * A line whose words have their own boxes, laid out left to right.
 *
 * The word-level rules work on boxes, so a line made of one big box cannot exercise
 * them at all — which is exactly how a broken word swap passed the first time.
 */
function words(text: string, x = 0, y = 0, wordWidth = 60, gap = 8): OcrLine {
  const parts = text.split(' ').filter(Boolean)
  return {
    text,
    words: parts.map((part, index) => ({
      text: part,
      x: x + index * (wordWidth + gap),
      y,
      width: wordWidth,
      height: 18
    }))
  }
}

describe('noiseShare', () => {
  it('catches a digit fused into a word', () => {
    // Measured: the English engine reading Russian at 16 px produced these.
    expect(noiseShare('Haapov7Kb4 npnnoxeHL,1A')).toBeGreaterThan(0.5)
    expect(noiseShare('nanKa coxpaHeHL,1A CHVIMKOB')).toBeGreaterThan(0)
  })

  it('leaves real words alone', () => {
    expect(noiseShare('Настройки приложения')).toBe(0)
    expect(noiseShare('The global shortcut is Ctrl+Shift+S by default')).toBe(0)
    expect(noiseShare('')).toBe(0)
  })

  it('counts fused technical tokens, but costs every engine the same', () => {
    // `win64` really does fuse a digit into a word, and pretending otherwise would
    // be a lie. What matters is that every engine returns it identically, so the
    // penalty is identical and the ranking between engines does not move — which is
    // the only thing this score is used for.
    expect(noiseShare('win64 utf8')).toBe(1)
    expect(noiseShare('Node.js 22.17.0')).toBe(0)

    // The cost falls on the reading that contains it, whichever engine produced it,
    // and it never makes a noisy reading score above a clean one from the same engine.
    const clean = reading('ru', [line('Сборка приложения')])
    const noisy = reading('ru', [line('Сборка npnnoxeHL,1A')])
    expect(resultScore(noisy)).toBeLessThan(resultScore(clean))
  })

  it('ignores punctuation that legitimately hugs a number', () => {
    expect(noiseShare('Выручка выросла на 18 %')).toBe(0)
    expect(noiseShare('quality 92 percent')).toBe(0)
  })
})

describe('scriptShare and majorityScript', () => {
  it('measures the share of one alphabet', () => {
    expect(scriptShare('Настройки приложения', 'cyrillic')).toBe(1)
    expect(scriptShare('Hello world', 'latin')).toBe(1)
    expect(scriptShare('Горячая клавиша: Ctrl+Shift+S', 'cyrillic')).toBeGreaterThan(0.4)
    expect(scriptShare('', 'latin')).toBe(0)
  })

  it('names the script of a single word', () => {
    expect(majorityScript('portable')).toBe('latin')
    expect(majorityScript('приложения')).toBe('cyrillic')
    expect(majorityScript('12345')).toBeNull()
    expect(majorityScript('')).toBeNull()
  })

  it('tells a mixed line from a single-script one', () => {
    // 51 % Latin: genuinely mixed, and must not be handed to the English engine.
    expect(scriptShare('Папка по умолчанию: app.getPath("userData")', 'latin')).toBeLessThan(0.85)
    // 89 % Latin: an English sentence the Russian engine mangled one word of.
    expect(scriptShare('маке sure the folder exists and is writable', 'latin')).toBeGreaterThan(0.85)
  })
})

describe('scriptWordFixes', () => {
  it('takes a word from the engine that reads its alphabet', () => {
    // Measured: the Russian engine read portable as "portabIe".
    const base = words('Сборка: electron-builder --win nsis portabIe')
    const other = words('C60pKa: electron-builder --win nsis portable')
    const fixes = scriptWordFixes(base, other, 'latin')
    expect(fixes.map((fix) => fix.text)).toContain('portable')
  })

  it('keeps the base alphabet on a line it reads well', () => {
    const base = words('Настройки приложения')
    const other = words('HaapoVIKM npmnoxeHv')
    expect(scriptWordFixes(base, other, 'latin')).toEqual([])
  })

  it('fixes a stray lookalike word on an otherwise English line', () => {
    // Measured: "маке sure the folder exists and is writable".
    const base = words('маке sure the folder exists and is writable')
    const other = words('Make sure the folder exists and is writable')
    const fixes = scriptWordFixes(base, other, 'latin')
    expect(fixes.map((fix) => fix.text)).toEqual(['Make'])
  })

  it('refuses a replacement that invents digits', () => {
    // "Версия" -> "BepcL,1A" is lookalike output, not a correction.
    const base = words('Версия Node.js 22.17.0 npm 10.9.2')
    const other = words('BepcL,1A Node.js 22.17.0 npm 10.9.2')
    const fixes = scriptWordFixes(base, other, 'latin')
    expect(fixes.map((fix) => fix.text)).not.toContain('BepcL,1A')
  })

  it('does nothing without boxes to match', () => {
    expect(scriptWordFixes({ text: 'x', words: [] }, words('y'), 'latin')).toEqual([])
  })
})

describe('tailWords', () => {
  it('takes the tail a line stopped before', () => {
    // Measured: the Russian engine returned only the first half of a line
    // whose Latin tail it could not read at all.
    const base = words('Папка по умолчанию:', 0, 0, 60, 8)
    const other = words('Папка по умолчанию: app.getPath("userData")', 0, 0, 60, 8)
    const tail = tailWords(base, other)
    expect(tail).toBe('app.getPath("userData")')
  })

  it('returns nothing when the other reading is not longer', () => {
    const base = words('Настройки приложения', 0, 0, 60, 8)
    const other = words('Настройки приложения', 0, 0, 60, 8)
    expect(tailWords(base, other)).toBeNull()
  })

  it('returns nothing for a line on a different row', () => {
    const base = words('Папка', 0, 0, 60, 8)
    const other = words('Папка продолжение', 0, 200, 60, 8)
    expect(tailWords(base, other)).toBeNull()
  })

  it('does not duplicate a tail the base already has', () => {
    const base = words('Папка по умолчанию: app.getPath', 0, 0, 60, 8)
    const other = words('Папка по умолчанию: app.getPath', 0, 0, 60, 8)
    expect(tailWords(base, other)).toBeNull()
  })

  it('takes a path tail, which is a word in two alphabets', () => {
    // `Изображения\Flushot` is the shape a folder path takes in a Russian interface.
    // The mixed-alphabet guard used to reject it as garbage, which threw away a
    // correct tail; a path is exactly the case where one word legitimately spans two
    // alphabets, so the guard now exempts words that contain a separator.
    const base = words('Папка для сохранения снимков:')
    const other = words('Папка для сохранения снимков: Изображения\\Flushot')
    expect(tailWords(base, other)).toBe('Изображения\\Flushot')
  })

  it('still rejects a tail that mixes alphabets without a separator', () => {
    // The exemption is for paths only. A word that fuses Cyrillic and Latin with no
    // separator is the signature of a wrong-engine reading, not of a path.
    const base = words('Папка:')
    const other = words('Папка: ИзобрaженияFlushot')
    expect(tailWords(base, other)).toBeNull()
  })
})

describe('repairBackslashWords', () => {
  it('takes each half of a path from whichever reading spelled it cleanly', () => {
    // This is the case that no single engine on this machine can get right, measured
    // over a grid of enlargements and preparations (`.tmp/ocr-tail-grid.cjs`): the
    // Russian engine returns `Изображения\Яи4-к` — Cyrillic half perfect, Latin half
    // replaced by lookalikes — and the English engine returns `V1306paxeHMR\Flushot`,
    // the exact mirror image. Both halves are recoverable, from different readings.
    const cyrillic = line('Изображения\\Яи4-к')
    const latin = line('V1306paxeHMR\\Flushot')
    const repaired = repairBackslashWords(cyrillic, [latin])
    expect(repaired.text).toBe('Изображения\\Flushot')
  })

  it('works in the other direction, and for a Latin folder', () => {
    // The rule is symmetrical on purpose: it repairs `Пользователи\Public` as readily
    // as `Users\Пётр`, without being told which language the line is in.
    const mixed = line('Users\\Пётp')
    const other = line('Users\\Пётр')
    expect(repairBackslashWords(mixed, [other]).text).toBe('Users\\Пётр')
  })

  it('leaves a word without a separator alone', () => {
    const base = line('Настройки приложения')
    const other = line('Настройки приложений')
    expect(repairBackslashWords(base, [other]).text).toBe('Настройки приложения')
  })

  it('keeps the original when no other reading has a path', () => {
    const base = line('Папка\\Flushot')
    const other = line('Папка')
    expect(repairBackslashWords(base, [other]).text).toBe('Папка\\Flushot')
  })

  it('prefers a half made of letters over one with digits pushed into it', () => {
    // `Яи4-к` is what the Russian engine produces for `Flushot`; `Flushot` is what the
    // English one produces. The choice is made on the letters, not on the engine.
    const base = line('Изображения\\Яи4-к')
    const other = line('Изображения\\Flushot')
    expect(repairBackslashWords(base, [other]).text).toBe('Изображения\\Flushot')
    // And the reverse: given the bad half second, the clean half still wins.
    const clean = line('Изображения\\Flushot')
    const noisy = line('Изображения\\Яи4-к')
    expect(repairBackslashWords(clean, [noisy]).text).toBe('Изображения\\Flushot')
  })
})

describe('voteWords', () => {
  it('takes the spelling the readings agree on', () => {
    // Measured on real screenshots: the base reading had `Iines` where the others had
    // `lines`, and `Iength` for `length`. Voting fixes exactly this class of error.
    //
    // Two other readings, not one: a single dissenter is a tie, and a tie keeps the
    // base. In the real pipeline there are six readings of every line — two engines,
    // three preparations each — so a spelling the others agree on is not a tie there.
    const base = words('expect outcome Iines Iength toBeGreaterThan')
    const other = words('expect outcome lines length toBeGreaterThan')
    const voted = voteWords(base, 1, [
      { line: other, score: 1 },
      { line: other, score: 1 }
    ])
    expect(voted.text).toContain('lines')
    expect(voted.text).toContain('length')
    expect(voted.text).not.toContain('Iines')
  })

  it('never compares words across alphabets', () => {
    // The Russian engine reading an English code line returns lookalike Cyrillic for
    // every word, and it appears once per preparation — so an unguarded vote let
    // garbage outvote the correct spelling two to one. Measured: that version made the
    // error rate twice as bad, 3.5 % to 7.2 %.
    const base = words('const settings await store')
    const cyrillic = words('сопзт 5еттing5 ашайт 5тоге')
    const voted = voteWords(base, 1, [{ line: cyrillic, score: 1 }])
    expect(voted.text).toBe('const settings await store')
  })

  it('does not let a word gain a digit it did not have', () => {
    const base = words('npm 10.9.2')
    const other = words('npm1 10.9.2')
    const voted = voteWords(base, 1, [{ line: other, score: 1 }])
    expect(voted.text).toBe('npm 10.9.2')
  })

  it('needs more than a tie to overrule the winning reading', () => {
    // The base won the line, so one dissenter is not enough: it takes a weighted
    // majority. Two readings of equal weight against one is a tie, and a tie keeps the
    // base.
    const base = words('Flushot reads text')
    const other = words('F1ushot reads text')
    expect(voteWords(base, 1, [{ line: other, score: 1 }]).text).toBe('Flushot reads text')
  })
})

describe('withTail', () => {
  it('appends only what starts beyond the line it is appended to', () => {
    const base = words('Папка:')
    const other = words('Папка: Изображения\\Flushot')
    expect(withTail(base, other).text).toBe('Папка: Изображения\\Flushot')
  })

  it('leaves the line alone when there is nothing beyond it', () => {
    const base = words('Настройки приложения')
    const other = words('Настройки приложения')
    expect(withTail(base, other).text).toBe('Настройки приложения')
  })
})

describe('reliabilityScore', () => {
  it('is more forgiving than the ranking score about noise', () => {
    // The two numbers exist because they answer different questions: this one asks
    // "can this engine be asked about the rest", not "is this reading the best".
    const noisy = reading('en-US', [
      line('Haapov7Kb4 npnnoxeHL,1A'),
      line('nanKa coxpaHeHL,1A CHVIMKOB')
    ])
    expect(reliabilityScore(noisy)).toBeGreaterThan(resultScore(noisy))
  })

  it('is zero for a reading with no letters', () => {
    expect(reliabilityScore(reading('ru', [line('123 456')]))).toBe(0)
  })
})

describe('mergeReadings, line by line', () => {
  /**
   * The case that forced the redesign, with the real measured readings.
   *
   * Consolas at 16 px: each engine is right about half the picture. The Russian one
   * reads every Cyrillic line perfectly and turns "Application settings" into
   * "App1ication settings"; the English one is the exact mirror. Whole-picture
   * ranking has to pick one and lose half the text — which is what it did, at 40 %
   * character error, until the merge started deciding per line.
   */
  const russian = reading('ru', [
    words('Настройки приложения', 0, 0),
    words('App1ication settings', 0, 40),
    words('Сборка: electron-builder', 0, 80)
  ])
  const english = reading('en-US', [
    words('HacTpoVIKM npnnoxeHL', 0, 0),
    words('Application settings', 0, 40),
    words('C60pKa: electron-builder', 0, 80)
  ])

  it('takes each line from the engine that read it right', () => {
    const merged = mergeReadings([russian, english], 'ru')
    expect(merged.lines.map((entry) => entry.text)).toEqual([
      'Настройки приложения',
      'Application settings',
      'Сборка: electron-builder'
    ])
  })

  it('names both engines as contributors', () => {
    const merged = mergeReadings([russian, english], 'ru')
    expect(merged.contributors.sort()).toEqual(['en-US', 'ru'])
    // Each engine won at least one line, so neither can be called the base.
    expect(['ru', 'en-US']).toContain(merged.primary)
  })

  it('still lets one engine win when it is simply better', () => {
    const good = reading('ru', [words('Квартальный отчёт', 0, 0), words('Выручка 18 %', 0, 40)])
    const bad = reading('en-US', [words('KBaPTanbHbli OT"äT', 0, 0), words('Bblpyvxa 18 %', 0, 40)])
    const merged = mergeReadings([good, bad], 'ru')
    expect(merged.lines.map((entry) => entry.text)).toEqual(['Квартальный отчёт', 'Выручка 18 %'])
    expect(merged.primary).toBe('ru')
  })

  it('keeps reading order when one line was split in two boxes', () => {
    // Both engines split this line, and the right-hand half sits 3 px higher, so
    // ordering on y alone put "= await store.load()" before "const settings".
    const left = words('const settings', 0, 1563, 90)
    const right = words('= await store.load()', 110, 1560, 150)
    const merged = mergeReadings([reading('ru', [right, left])], 'ru')
    expect(merged.lines.map((entry) => entry.text)).toEqual(['const settings', '= await store.load()'])
  })

  it('prefers a substantially longer reading on a tie', () => {
    // The Russian engine dropped the whole middle of this line and still scored 1.00
    // on what was left, tying with the complete English reading.
    const short = reading('ru', [words('await ccmpressionLeveI: 1 })', 0, 0, 60)])
    const full = reading('en-US', [words('await sharp(buffer).png({ compressionLevel: 1 })', 0, 0, 60)])
    const merged = mergeReadings([short, full], 'ru')
    expect(merged.lines[0].text).toBe('await sharp(buffer).png({ compressionLevel: 1 })')
  })

  it('does not prefer a barely longer reading', () => {
    // One stray glyph is not a dropped chunk, and swapping on it would be noise.
    const a = reading('ru', [words('Готово к работе', 0, 0, 60)])
    const b = reading('en-US', [words('Готово к работе!', 0, 0, 60)])
    const merged = mergeReadings([a, b], 'ru')
    expect(merged.lines[0].text).toBe('Готово к работе')
  })
})

describe('mergeReadings', () => {
  it('adds a line the winning engine dropped, in the right place', () => {
    // Measured behaviour: the Russian engine read this mixed screen but silently
    // omitted the English code line, which the English engine got exactly right.
    const russian = reading('ru', [
      line('Настройки приложения', 0, 0),
      line('Папка для сохранения снимков', 0, 40),
      line('electron-builder --win nsis portable', 0, 60)
    ])
    const english = reading('en-US', [
      line('HaapoVIKM npmnoxeHv•1R', 0, 0),
      line('app.getPath("userData")', 0, 20),
      line('nanKa coxpaHeHVIR CHMMKOB', 0, 40)
    ])

    const merged = mergeReadings([english, russian], 'ru')
    expect(merged.primary).toBe('ru')
    expect(merged.contributors).toContain('en-US')
    expect(merged.lines.map((entry) => entry.text)).toEqual([
      'Настройки приложения',
      'app.getPath("userData")',
      'Папка для сохранения снимков',
      'electron-builder --win nsis portable'
    ])
  })

  it('never lets a losing engine replace a line the winner already read', () => {
    const russian = reading('ru', [line('Квартальный отчёт', 0, 0)])
    const english = reading('en-US', [line('KBaPTanbHbli OT"äT', 0, 0)])
    const merged = mergeReadings([english, russian], 'ru')
    expect(merged.lines).toHaveLength(1)
    expect(merged.lines[0].text).toBe('Квартальный отчёт')
    expect(merged.contributors).toEqual(['ru'])
  })

  it('ignores an engine that read the picture badly when adding lines', () => {
    const good = reading('ru', [line('Квартальный отчёт', 0, 0)])
    const bad = reading('en-US', [line('KBaPTanbHbli OT"äT', 0, 0), line('Bblpyvxa', 0, 40)])
    const merged = mergeReadings([good, bad], 'ru')
    expect(merged.lines).toHaveLength(1)
  })

  it('keeps one engine alone when it is the only one', () => {
    const merged = mergeReadings([reading('en-US', [line('Hello world')])])
    expect(merged.primary).toBe('en-US')
    expect(merged.lines[0].text).toBe('Hello world')
  })

  it('survives an engine that found nothing', () => {
    const merged = mergeReadings([reading('ru', []), reading('en-US', [line('Hello world')])], 'ru')
    expect(merged.primary).toBe('en-US')
    expect(merged.lines).toHaveLength(1)
  })

  it('returns nothing when every engine found nothing', () => {
    const merged = mergeReadings([reading('ru', []), reading('en-US', [])])
    expect(merged).toEqual({ lines: [], primary: null, contributors: [] })
  })

  it('breaks a tie the way the user expects', () => {
    // Two engines, identical scores: the language Windows picked for the user wins.
    const russian = reading('ru', [line('Test')])
    const english = reading('en-US', [line('Test')])
    expect(mergeReadings([english, russian], 'ru').primary).toBe('ru')
    expect(mergeReadings([russian, english], 'en-US').primary).toBe('en-US')
  })
})
