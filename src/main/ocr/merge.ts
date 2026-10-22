/**
 * Choosing between several engines' readings of the same picture.
 *
 * Why this exists: one engine reads one script well and mangles the other. A
 * Windows OCR engine for Russian, handed English text, does not fail — it returns
 * Latin lookalikes ("HaapoVIKM npmnoxeHv"), and the English engine handed Russian
 * returns the same kind of thing. A real screen has both, so no single engine can
 * be right about a whole screenshot.
 *
 * Measured on this machine (`.tmp/ocr-bench*.cjs`), character error rate on a
 * 900 px picture of known text:
 *
 * | text     | ru engine | en-US engine | best of both |
 * |----------|-----------|--------------|--------------|
 * | Russian  | 2.3 %     | 83.7 %       | 2.3 %        |
 * | English  | 13.5 %    | 0.0 %        | 0.0 %        |
 * | mixed    | 17.1 %    | 45.0 %       | **2.3 %**    |
 *
 * The mixed row is the point: the Russian engine silently *dropped* the line
 * `app.getPath("userData")` — it does not report an error, the line is simply
 * gone — while the English engine read that line perfectly and mangled the rest.
 * Taking the union of the two readings, line by line, recovers both halves.
 *
 * The strategy is to decide **line by line**, not picture by picture. An earlier
 * version scored each engine's whole reading and kept the best as a base, only
 * asking the others about lines it had missed. That is wrong for the most ordinary
 * case there is: a screen with a Russian heading and an English log. Measured across
 * 14 font and size combinations, whole-picture ranking left 11.80 % of characters
 * wrong, and the failure was systematic — no single engine is the best one for a
 * picture written in two scripts.
 *
 * Per line, the evidence is much stronger, and it took a new signal to get there:
 *
 * 1. Group every engine's lines into the lines of the picture, by geometry.
 * 2. Pick the best reading of each line by `lineScore` — capitals, script leakage
 *    and, decisively, `noiseShare`.
 * 3. Use the losing readings for that same line as evidence about it: complete a
 *    tail it stopped before, and take the words in the script it was not trained on.
 *
 * The same benchmark puts that at 5.74 %. What is left is mostly the engines' own
 * floor: at 11 px both of them read "Папка" as "Палка", and agreement on a wrong
 * reading is not something a merge can detect.
 */

import type { OcrLine, OcrWord } from '../../shared/types'
import type { OcrRawResult } from './worker'

export interface OcrBox {
  x: number
  y: number
  width: number
  height: number
}

/** A line is added where the base has nothing only if it looks like text. */
const ADD_MIN_SCORE = 0.75
/**
 * How far behind the winner an engine may be and still be asked about the rest.
 *
 * Measured on the two cases that pull in opposite directions: the English engine on
 * a Russian screen trails by 0.16 and holds the line the Russian engine dropped, so
 * it must be asked; an engine returning lookalike nonsense trails by 0.33 and has
 * nothing worth adding.
 */
const ADD_MAX_RELIABILITY_GAP = 0.25
/** Boxes must overlap this much to count as the same line. */
const SAME_LINE_IOU = 0.15
/** Above this share of one script, a line belongs to that script's engine. */
const OVERWHELMING_SHARE = 0.85
/** Below this share, a line is mixed on purpose and cannot be leakage. */
const LEAKAGE_MIN_SHARE = 0.7
/** Two boxes this close vertically are on the same row. */
const ROW_TOLERANCE = 6

/** The script an engine is trained on. */
export type OcrScript = 'latin' | 'cyrillic' | 'han' | 'hangul' | 'arabic' | 'hebrew' | 'greek' | 'thai'

const CYRILLIC_LANGUAGES = new Set(['ru', 'uk', 'bg', 'sr', 'mk', 'be', 'kk', 'ky', 'tg', 'mn'])
const SCRIPT_BY_LANGUAGE: Record<string, OcrScript> = {
  zh: 'han',
  ja: 'han',
  ko: 'hangul',
  ar: 'arabic',
  fa: 'arabic',
  ur: 'arabic',
  he: 'hebrew',
  el: 'greek',
  th: 'thai'
}

const LETTER: Record<OcrScript, RegExp> = {
  latin: /\p{Script=Latin}/u,
  cyrillic: /\p{Script=Cyrillic}/u,
  han: /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u,
  hangul: /\p{Script=Hangul}/u,
  arabic: /\p{Script=Arabic}/u,
  hebrew: /\p{Script=Hebrew}/u,
  greek: /\p{Script=Greek}/u,
  thai: /\p{Script=Thai}/u
}

/** The two scripts whose lookalike confusion this merge is built around. */
const LATIN = /\p{Script=Latin}/u
const CYRILLIC = /\p{Script=Cyrillic}/u

/** Which script a language tag is written in, e.g. `ru-RU` → cyrillic. */
export function scriptOf(language: string): OcrScript {
  const base = language.toLowerCase().split(/[-_]/)[0]
  if (CYRILLIC_LANGUAGES.has(base)) return 'cyrillic'
  return SCRIPT_BY_LANGUAGE[base] ?? 'latin'
}

const isLetter = (char: string): boolean => /\p{L}/u.test(char)

/**
 * What share of a line's letters are in the given script.
 *
 * Needed to tell a line that is *one* script from a line that is genuinely mixed.
 * Half a dozen decisions above hinge on that difference, and "more than half" is
 * not enough: a mixed line often tips one way by a letter or two.
 */
export function scriptShare(text: string, script: OcrScript): number {
  let total = 0
  let own = 0
  for (const char of text) {
    if (!isLetter(char)) continue
    total++
    if (LETTER[script].test(char)) own++
  }
  return total > 0 ? own / total : 0
}

/**
 * Which script a single word is mostly written in, or null when it has no letters.
 *
 * Word-level, not line-level: a line like "Горячая клавиша: Ctrl+Shift+S" is mostly
 * Cyrillic while `Ctrl+Shift+S` inside it is entirely Latin. Deciding per line
 * would call that token a mistake and try to replace it; deciding per word asks
 * the right engine for the right token.
 */
export function majorityScript(text: string): OcrScript | null {
  let latin = 0
  let cyrillic = 0
  for (const char of text) {
    if (!isLetter(char)) continue
    if (LATIN.test(char)) latin++
    else if (CYRILLIC.test(char)) cyrillic++
  }
  if (latin === 0 && cyrillic === 0) return null
  return cyrillic > latin ? 'cyrillic' : 'latin'
}

/** The box a line occupies, from the union of its word boxes. */
export function lineBox(line: OcrLine): OcrBox | null {
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (const word of line.words) {
    if (!(word.width > 0) || !(word.height > 0)) continue
    left = Math.min(left, word.x)
    top = Math.min(top, word.y)
    right = Math.max(right, word.x + word.width)
    bottom = Math.max(bottom, word.y + word.height)
  }
  if (!Number.isFinite(left) || right <= left || bottom <= top) return null
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/** Intersection over union of two boxes, 0 when they do not touch. */
export function overlapRatio(a: OcrBox, b: OcrBox): number {
  const left = Math.max(a.x, b.x)
  const top = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  if (right <= left || bottom <= top) return 0
  const intersection = (right - left) * (bottom - top)
  const union = a.width * a.height + b.width * b.height - intersection
  return union > 0 ? intersection / union : 0
}

/**
 * How plausible a piece of text is, judging by its capitals alone.
 *
 * Lookalike output is full of them: the English engine reading a Russian screen
 * produced text that is 47–70 % capitals ("KBaPTanbHbli", "nanKa coxpaHeHVIR
 * CHMMKOB"), while real prose runs at a few percent. Only the excess above a
 * quarter is penalised, so camelCase ("getPath", "userData") is untouched, and a
 * word that is *all* capitals is skipped rather than counted — otherwise a line of
 * acronyms ("PNG JPEG API JSON") would score as garbage. That mistake is why this
 * is measured in a test instead of assumed.
 *
 * A word that mixes scripts is also counted against the reading. Real text does
 * not do that; a misreading does — the Russian engine returned "Сору to
 * clipboard" for "Copy to clipboard", with Cyrillic С, о and р inside a Latin
 * word. This is what decides an otherwise perfect tie between two engines on an
 * English screenshot, where both would score 1.0 on capitals alone.
 */
export function capitalPlausibility(text: string): number {
  let letters = 0
  let capitals = 0
  let anyLetters = 0
  let words = 0
  let mixedWords = 0

  // A path is a sequence of names, and each name is a word. `Изображения\Flushot`
  // mixes two alphabets across the separator — that is what a folder path looks like
  // in a Russian interface — while neither half mixes anything. Scored as a single
  // word it came out at 0.0 and every path tail was thrown away as garbage; scored as
  // two, it comes out at 1.0, which is the honest answer.
  const tokens = text
    .split(/\s+/)
    .flatMap((word) => word.split(/[\\/]/))
    .filter(Boolean)

  for (const word of tokens) {
    let wordLetters = 0
    let wordCapitals = 0
    let latin = 0
    let cyrillic = 0
    for (const char of word) {
      if (!isLetter(char)) continue
      wordLetters++
      if (char !== char.toLowerCase() && char === char.toUpperCase()) wordCapitals++
      if (LATIN.test(char)) latin++
      else if (CYRILLIC.test(char)) cyrillic++
    }
    anyLetters += wordLetters
    if (wordLetters === 0) continue
    words++
    if (latin > 0 && cyrillic > 0) mixedWords++
    // An acronym carries no evidence either way.
    if (wordLetters >= 2 && wordCapitals === wordLetters) continue
    letters += wordLetters
    capitals += wordCapitals
  }

  if (anyLetters === 0) return 0

  const mixedPenalty = words > 0 ? mixedWords / words : 0
  // Nothing but acronyms: plausible, if uninformative.
  if (letters === 0) return Math.max(0, 1 - mixedPenalty)

  const capitalExcess = Math.max(0, capitals / letters - 0.25)
  return Math.max(0, 1 - 2 * capitalExcess - mixedPenalty)
}

/**
 * How much a piece of text looks like text in *this* script.
 *
 * Two signals, both checked against real screenshots:
 *
 * - **Capitals**, as above.
 * - **Script.** A Russian engine handed English does not fail, it returns Latin
 *   lookalikes; the fraction of letters in the engine's own script is therefore a
 *   near-binary indicator. It has to be near-binary because real text mixes
 *   scripts legitimately ("Горячая клавиша: Ctrl+Shift+S"), so a gradual penalty
 *   would punish the correct reading.
 *
 * Used to decide whether a line from a losing engine is worth adding. It is
 * deliberately *not* used to rank whole readings: a Russian engine reading an
 * English line correctly would be marked down for it, which is precisely the
 * mixed screenshot this merge exists for.
 */
export function textScore(text: string, script: OcrScript = 'latin'): number {
  let letters = 0
  let ownScript = 0
  let anyLetters = 0

  for (const word of text.split(/\s+/)) {
    for (const char of word) {
      if (!isLetter(char)) continue
      letters++
      anyLetters++
      if (LETTER[script].test(char)) ownScript++
    }
  }
  if (anyLetters === 0) return 0
  if (letters === 0) return 1

  const wrongScript = ownScript / letters < 0.2 ? 1 : 0
  return Math.max(0, capitalPlausibility(text) - wrongScript)
}

/**
 * How much of a line is written in a script the engine was *not* trained on.
 *
 * This is the signal that decides an otherwise perfect tie. On an English
 * screenshot, both engines returned three clean lines and scored the same on
 * capitals — but the Russian engine's version read "Copy" as "Сору", a Cyrillic
 * word in an otherwise Latin line. An engine whose target script is Cyrillic
 * produces such leakage when it is the wrong engine for the picture; when it is
 * the right one, the line's majority script *is* its own and nothing is counted.
 *
 * Asymmetric on purpose, and for a real reason: a Latin technical token inside
 * Russian text ("Горячая клавиша: Ctrl+Shift+S") is ordinary and must not be
 * penalised, while Cyrillic inside Latin text is nearly always a lookalike
 * substitution.
 *
 * Only a line that is *overwhelmingly* the other script can leak, and that limit was
 * measured rather than assumed. "Папка по умолчанию: app.getPath("userData")" is 53 %
 * Latin, so a plain majority test called the Russian engine's own correct Cyrillic
 * "leakage" and marked that line down to 0.53 — below the English engine's mangled
 * "nanKa no YMonuaHV1}o" at 0.75, which then won the line. A genuinely half-and-half
 * line says nothing about which engine is wrong, so it must not be penalised at all.
 */
export function scriptLeakage(text: string, script: OcrScript): number {
  let latin = 0
  let cyrillic = 0
  for (const char of text) {
    if (!isLetter(char)) continue
    if (LATIN.test(char)) latin++
    else if (CYRILLIC.test(char)) cyrillic++
  }
  const total = latin + cyrillic
  if (total === 0) return 0

  // Only lines whose majority is the other script can leak, and what leaks is
  // the engine's *own* script: Cyrillic letters appearing inside a Latin line.
  const majority = latin >= cyrillic ? 'latin' : 'cyrillic'
  if (majority === script) return 0

  const otherShare = majority === 'latin' ? latin / total : cyrillic / total
  if (otherShare < LEAKAGE_MIN_SHARE) return 0

  const leaked = script === 'cyrillic' ? cyrillic : latin
  return leaked / total
}

/**
 * How much of a line is made of tokens that no real text would contain.
 *
 * Capitals alone cannot tell a correct reading from lookalike output, and the
 * benchmark that proved it is worth recording. On a page of Russian UI text at
 * 16 px the English engine returned "Haapov7Kb4 npnnoxeHL,1A" — nearly all lower
 * case, so it scored 0.94 on capitals and *beat* the correct Russian reading by
 * 0.006. The whole picture came out in Latin gibberish.
 *
 * What that text does have is noise: `v7K`, `13b`, `1A`, `6p` — a digit and a
 * letter fused inside one word. Real words do not do that. Technical tokens that
 * do (`win64`, `utf8`) appear in every engine's reading identically, so they cost
 * both sides the same and change no decision.
 */
export function noiseShare(text: string): number {
  const tokens = text.split(/\s+/).filter((token) => token.length > 0)
  if (tokens.length === 0) return 0

  let noisy = 0
  for (const token of tokens) {
    // Strip the punctuation that legitimately hugs a word.
    const core = token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    if (core.length < 3) continue
    let fused = false
    for (let index = 1; index < core.length; index++) {
      const previous = core[index - 1]
      const current = core[index]
      const previousIsDigit = /\p{N}/u.test(previous)
      const currentIsDigit = /\p{N}/u.test(current)
      const previousIsLetter = isLetter(previous)
      const currentIsLetter = isLetter(current)
      if ((previousIsDigit && currentIsLetter) || (previousIsLetter && currentIsDigit)) {
        fused = true
        break
      }
    }
    if (fused) noisy++
  }

  return noisy / tokens.length
}

/**
 * How much a whole reading can be trusted *for what it did not find*.
 *
 * Deliberately excludes `noiseShare`, and that is the whole point of having a
 * second score. Noise is what makes ranking work — it is the signal that catches a
 * lower-case Latin impostor — but it also drags down an engine that was merely
 * handed the wrong language, and that engine is the only one holding the lines the
 * winner dropped. Ranking and "should I ask this engine for the rest" are two
 * different questions, so they get two different numbers.
 *
 * Measured: the English engine on a Russian screen scores 0.84 here but 0.67 with
 * noise, against the Russian engine's 1.00 — a 0.16 gap instead of 0.33. The gap
 * gate below only works with the first number.
 */
export function reliabilityScore(result: OcrRawResult): number {
  const script = scriptOf(result.lang)
  let weight = 0
  let total = 0
  for (const line of result.lines) {
    const letters = Array.from(line.text).filter(isLetter).length
    if (letters === 0) continue
    weight += letters
    const plausibility = Math.max(0, capitalPlausibility(line.text) - scriptLeakage(line.text, script))
    total += plausibility * letters
  }
  return weight > 0 ? total / weight : 0
}

/**
 * A whole engine's reading, weighted by how much text it found.
 *
 * No longer used to rank engines — the merge decides per line — but it is the number
 * the benchmarks quote and the one that shows *why* per-line ranking was needed: on
 * the Consolas 16 px page this says the two readings are near-equal, which is true
 * and useless, because each of them is right about a different half of the picture.
 * Expressed through `lineScore` so the two can never drift apart.
 */
export function resultScore(result: OcrRawResult): number {
  const script = scriptOf(result.lang)
  let weight = 0
  let total = 0
  for (const line of result.lines) {
    const letters = Array.from(line.text).filter(isLetter).length
    if (letters === 0) continue
    weight += letters
    total += lineScore(line, script) * letters
  }
  return weight > 0 ? total / weight : 0
}

/**
 * Whether a line from a losing engine is worth adding where the base is silent.
 *
 * Stricter than the whole-picture score: there is no second opinion on a line that
 * only one engine saw, so obvious nonsense is rejected outright.
 */
export function looksLikeText(text: string, script: OcrScript): boolean {
  const letters = Array.from(text).filter(isLetter)
  if (letters.length < 3) return false
  // Mixed Latin and Cyrillic inside one word is the signature of lookalike output.
  const words = text.split(/\s+/).filter(Boolean)
  for (const word of words) {
    const latin = /[A-Za-z]/.test(word)
    const cyrillic = /[А-Яа-яЁё]/.test(word)
    if (latin && cyrillic) return false
  }
  return textScore(text, script) >= ADD_MIN_SCORE
}

/**
 * Take the words the other engine owns the script for.
 *
 * An engine reads its own alphabet and guesses at the other. So on a Russian line
 * the Russian engine's Latin words are guesses: it read `portable` as `portabIe`
 * and `npm` as `прт`. The English engine had both right — it only mangled the
 * Cyrillic around them. Swapping word by word is therefore asking each engine the
 * one question it can answer.
 *
 * Two ways a word qualifies, and both were measured rather than guessed:
 *
 * 1. **The word is in the other engine's alphabet.** The base was guessing, so the
 *    engine that reads that alphabet is asked instead. `portabIe` → `portable`.
 * 2. **The word is in the base's alphabet but the line is not.** A line that is
 *    overwhelmingly one script is that script's engine's job even for the stray
 *    word: the Russian engine read "Make sure the folder…" as "маке sure the
 *    folder…", and the English engine had that line exactly right. Without this,
 *    a single lookalike word survives in an otherwise perfect line.
 *
 * Everything else is left alone — in particular the base's own words on lines the
 * base reads well, which is the common case and the one that must not regress.
 */
export function scriptWordFixes(base: OcrLine, other: OcrLine, otherScript: OcrScript): Array<{ index: number; text: string }> {
  if (base.words.length === 0 || other.words.length === 0) return []

  const lineScript = majorityScript(base.text)
  // A line that merely tips towards one script is genuinely mixed — "Папка по
  // умолчанию: app.getPath(\"userData\")" is 51 % Latin — and swapping its words
  // would replace correct Cyrillic with lookalike Latin. Only a line that is
  // overwhelmingly one script is that script's engine's business.
  const overwhelming = lineScript !== null && scriptShare(base.text, lineScript) >= OVERWHELMING_SHARE
  const fixes: Array<{ index: number; text: string }> = []

  for (let index = 0; index < base.words.length; index++) {
    const word = base.words[index]
    const own = majorityScript(word.text)
    if (!own) continue
    if (Array.from(word.text).filter(isLetter).length < 2) continue

    let best: OcrWord | null = null
    let bestOverlap = 0
    for (const candidate of other.words) {
      const ratio = overlapRatio(word, candidate)
      if (ratio > bestOverlap) {
        bestOverlap = ratio
        best = candidate
      }
    }
    if (!best || bestOverlap < 0.25) continue
    if (best.text === word.text) continue

    const candidateScript = majorityScript(best.text)
    if (!candidateScript) continue

    if (own === candidateScript) {
      // Same alphabet: only take it when the base is the one guessing.
      if (own !== otherScript) continue
    } else if (!overwhelming || candidateScript !== lineScript || own === lineScript) {
      continue
    }

    // A number never appears out of nowhere: a candidate carrying digits where the
    // base word had none is lookalike output ("Версия" → "BepcL,1A"), not a fix.
    const digits = (text: string): number => Array.from(text).filter((char) => /\p{N}/u.test(char)).length
    if (digits(best.text) > digits(word.text)) continue

    // A replacement has to be cleaner than what it replaces: this is a swap, not a
    // merge, so the evidence has to be one-sided.
    if (capitalPlausibility(best.text) < 0.7) continue
    if (noiseShare(best.text) > 0.2) continue
    if (best.text.split(/\s+/).some((part) => /[A-Za-z]/.test(part) && /[А-Яа-яЁё]/.test(part))) continue

    fixes.push({ index, text: best.text })
  }
  return fixes
}

/**
 * The spelling most readings agree on, word by word.
 *
 * Choosing a line by score is a decision about the *whole* line, and a line is not one
 * opinion. The winner is usually right about most of it and wrong about one word, and
 * the other readings are usually wrong about the rest and right about that word —
 * `Iines` against `lines`, `Iength` against `length`. Taking the majority spelling of
 * each word uses the agreement where it exists instead of discarding every losing
 * reading wholesale.
 *
 * Two things keep it from doing damage, and both were found by measuring rather than by
 * reasoning: an unguarded version made the error rate *twice as bad* (3.5 % → 7.2 %).
 *
 * 1. **A word is only voted on by readings in its own alphabet.** The Russian engine
 *    reading an English code line returns lookalike garbage for every word — and it
 *    appears twice, once per preparation, so garbage outvoted the correct spelling two
 *    to one. Words are not compared across alphabets at all now.
 * 2. **Votes are weighted by how well each reading did on that line.** A reading that
 *    scored 0.95 counts more than one that scored 0.6, so two mediocre dissenting
 *    readings do not outvote one good reading by sheer count.
 */
export function voteWords(
  base: OcrLine,
  baseScore: number,
  others: Array<{ line: OcrLine; score: number }>
): OcrLine {
  if (base.words.length === 0) return base
  const usable = others.filter((entry) => entry.line.words.length > 0)
  if (usable.length === 0) return base

  const digitsIn = (text: string): number => Array.from(text).filter((char) => /\p{N}/u.test(char)).length
  const baseWeight = Math.max(0.05, baseScore)
  let changed = false

  const words = base.words.map((word) => {
    const ownScript = majorityScript(word.text)
    if (!ownScript) return word

    const votes = new Map<string, number>([[word.text, baseWeight]])
    for (const entry of usable) {
      const match = closestWord(word, entry.line.words)
      if (!match) continue
      // Same alphabet only: a Cyrillic lookalike of a Latin word is not a spelling
      // disagreement, it is a different engine guessing outside its training.
      if (majorityScript(match.text) !== ownScript) continue
      const weight = Math.max(0.05, entry.score)
      votes.set(match.text, (votes.get(match.text) ?? 0) + weight)
    }

    let bestText = word.text
    let bestVotes = baseWeight
    for (const [text, count] of votes) {
      if (text === word.text) continue
      if (count > bestVotes) {
        bestVotes = count
        bestText = text
      }
    }
    if (bestText === word.text) return word
    // A strict margin, not a tie: the base won the line, so it takes more than an even
    // split to overturn one of its words.
    if (bestVotes < baseWeight * 1.2) return word

    // A replacement has to be plausible on its own before it is believed, and it may
    // not invent a number or a word that straddles two alphabets.
    if (Array.from(bestText).filter(isLetter).length === 0) return word
    if (digitsIn(bestText) > digitsIn(word.text)) return word
    if (noiseShare(bestText) > Math.max(0.05, noiseShare(word.text))) return word
    if (capitalPlausibility(bestText) < 0.7) return word
    if (bestText.split(/\s+/).some((part) => /[A-Za-z]/.test(part) && /[А-Яа-яЁё]/.test(part))) return word

    changed = true
    return { ...word, text: bestText }
  })

  if (!changed) return base
  return { text: words.map((word) => word.text).join(' '), words }
}

/**
 * A path written in two alphabets, repaired one side of the separator at a time.
 *
 * `Изображения\Flushot` is the shape Windows gives a folder path in a Russian
 * interface, and no single engine on this machine can spell it. Measured over a grid of
 * enlargements and preparations, the Russian engine returns `Изображения\Яи4-к` — the
 * Cyrillic half perfect, the Latin half replaced by Cyrillic lookalikes — while the
 * English engine returns `V1306paxeHMR\Flushot`, the exact mirror image. Both readings
 * are half right, and they are half right about different halves.
 *
 * So the two halves are chosen separately, and the choice is made on how cleanly a half
 * is spelled rather than on which engine said it: a run of letters with no digits pushed
 * into it beats `V1306paxeHMR`, and a run of Latin letters beats `Яи4-к`. That rule is
 * symmetrical, which matters — it repairs `Пользователи\Public` and `Users\Пётр`
 * equally, without being told which language the line is in.
 *
 * Only words that contain a path separator are touched, so nothing else in the picture
 * can be affected by it.
 */
export function repairBackslashWords(line: OcrLine, others: OcrLine[]): OcrLine {
  if (line.words.length === 0) return line
  const usable = others.filter((other) => other.words.length > 0)
  if (usable.length === 0) return line

  let changed = false
  const words = line.words.map((word) => {
    if (!/[\\/]/.test(word.text)) return word
    const parts = splitAtSeparator(word.text)
    if (!parts) return word

    // Every spelling of this word from the other readings, split the same way.
    const candidates: Array<[string, string, string]> = []
    for (const other of usable) {
      const match = closestWord(word, other.words)
      if (!match || !/[\\/]/.test(match.text)) continue
      const split = splitAtSeparator(match.text)
      if (split) candidates.push(split)
    }
    if (candidates.length === 0) return word

    const left = bestHalf([parts[0], ...candidates.map((pair) => pair[0])])
    const right = bestHalf([parts[1], ...candidates.map((pair) => pair[1])])
    const text = `${left}${parts[2]}${right}`
    if (text === word.text) return word
    changed = true
    return { ...word, text }
  })

  if (!changed) return line
  return { text: words.map((item) => item.text).join(' '), words }
}

/** `a\b` → `['a', 'b', '\']`; `null` when there is not exactly one separator. */
function splitAtSeparator(text: string): [string, string, string] | null {
  const matches = [...text.matchAll(/[\\/]/g)]
  if (matches.length !== 1) return null
  const index = matches[0].index ?? -1
  if (index <= 0 || index === text.length - 1) return null
  return [text.slice(0, index), text.slice(index + 1), text[index]]
}

/**
 * The cleanest spelling among several, or the first when they tie.
 *
 * "Clean" is a property of the letters, not of the engine: a half made only of letters
 * is better than one with digits pushed into it, a single alphabet is better than two,
 * and anything that is mostly punctuation is not a word at all.
 */
function bestHalf(halves: string[]): string {
  let best = halves[0]
  let bestScore = halfQuality(best)
  for (const half of halves.slice(1)) {
    const score = halfQuality(half)
    if (score > bestScore) {
      best = half
      bestScore = score
    }
  }
  return best
}

function halfQuality(text: string): number {
  const letters = Array.from(text).filter(isLetter)
  if (letters.length === 0) return -100

  let score = letters.length * 0.1
  const scripts = new Set(letters.map((char) => (LATIN.test(char) ? 'latin' : CYRILLIC.test(char) ? 'cyrillic' : 'other')))
  if (scripts.size === 1 && !scripts.has('other')) score += 3

  // A digit pressed between letters is the signature of a lookalike substitution:
  // `Яи4-к`, `V1306paxeHMR`. Real words in a path do contain digits, but not welded to
  // letters on both sides, which is what this counts.
  for (let index = 1; index < text.length - 1; index++) {
    if (!/\p{N}/u.test(text[index])) continue
    if (isLetter(text[index - 1]) && isLetter(text[index + 1])) score -= 3
  }
  // Hyphens and other punctuation inside a word are rare in a folder name.
  for (const char of text) if (!isLetter(char) && !/\p{N}/u.test(char) && char !== '.' && char !== '_') score -= 1.5

  return score
}

/** The word of another reading that sits where this one sits, if any. */
function closestWord(word: OcrWord, candidates: OcrWord[]): OcrWord | null {  let best: OcrWord | null = null
  let bestOverlap = 0
  for (const candidate of candidates) {
    const ratio = overlapRatio(word, candidate)
    if (ratio > bestOverlap) {
      bestOverlap = ratio
      best = candidate
    }
  }
  // Half the box: enough that it is the same word, loose enough for the two boxes to
  // have been measured at different enlargements.
  return bestOverlap >= 0.5 ? best : null
}

/**
 * The words another engine found to the right of where a line stopped.
 *
 * The Russian engine does not only drop whole lines: on a mixed line it stops at
 * the point where the script changes. "Папка по умолчанию: app.getPath("userData")"
 * came back as "Папка по умолчанию:" — the Latin tail was simply gone, again with
 * no error. The English engine had that tail exactly right. Nothing was added
 * before because a line is only added where the base is *silent*, and here the
 * base had spoken — just not to the end.
 *
 * Only the tail is taken, never the middle: appending is the one operation that
 * cannot reorder or corrupt what the base already read correctly.
 */
export function tailWords(base: OcrLine, other: OcrLine): string | null {
  const baseBox = lineBox(base)
  const otherBox = lineBox(other)
  if (!baseBox || !otherBox || other.words.length === 0) return null

  // Same line: the vertical centres must be close, and the ranges must meet.
  const baseCentre = baseBox.y + baseBox.height / 2
  const otherCentre = otherBox.y + otherBox.height / 2
  if (Math.abs(baseCentre - otherCentre) > Math.max(baseBox.height, otherBox.height)) return null
  if (otherBox.x + otherBox.width <= baseBox.x + baseBox.width) return null

  const baseRight = baseBox.x + baseBox.width
  // A word only counts as beyond the end if it starts after the base's right edge,
  // less a little slack for the box padding the engine reports.
  const slack = Math.max(2, baseBox.height * 0.4)
  const beyond = other.words.filter((word) => word.x >= baseRight - slack)
  if (beyond.length === 0) return null

  const text = beyond.map((word) => word.text).join(' ').trim()
  if (Array.from(text).filter(isLetter).length < 2) return null

  // The base may already end with this text; appending it again would duplicate.
  const baseText = base.text.trim().toLowerCase()
  if (baseText.endsWith(text.toLowerCase())) return null

  // Plausible on its own: no fused digits, no capitals storm, no mixed words — except
  // a path, where one word legitimately spans two alphabets because the folder name and
  // the file name are in different languages.
  if (capitalPlausibility(text) < 0.7) return null
  if (noiseShare(text) > 0.2) return null
  for (const word of text.split(/\s+/)) {
    if (/[\\/]/.test(word)) continue
    if (/[A-Za-z]/.test(word) && /[А-Яа-яЁё]/.test(word)) return null
  }

  return text
}

export interface MergedReading {
  lines: OcrLine[]
  /** Engine whose reading became the base, if any. */
  primary: string | null
  /** Every engine whose text ended up in the result. */
  contributors: string[]
}

/**
 * A line with the words another reading found beyond its right edge.
 *
 * Exported because the recovery is not always available at merge time: when the winner
 * dropped a tail because the word straddled two alphabets, `recognize.ts` re-reads that
 * part of the picture on its own and comes back with another reading of the same line.
 * It appends through here, so the decision about what counts as a trustworthy tail is
 * made in one place.
 *
 * Returns the line unchanged when the other reading has nothing to add.
 */
export function withTail(line: OcrLine, other: OcrLine, otherBox?: OcrBox): OcrLine {
  const tail = tailWords(line, other)
  if (!tail) return line

  const ownBox = lineBox(line)
  const height = otherBox?.height ?? lineBox(other)?.height ?? 0
  const slack = Math.max(2, height * 0.4)
  const beyond = other.words.filter((word) => word.x >= (ownBox?.x ?? 0) + (ownBox?.width ?? 0) - slack)
  return { text: `${line.text.trimEnd()} ${tail}`, words: [...line.words, ...beyond] }
}

/** How good one line looks, given the engine that produced it. */
export function lineScore(line: OcrLine, script: OcrScript): number {
  if (Array.from(line.text).filter(isLetter).length === 0) return 0
  return Math.max(0, capitalPlausibility(line.text) - scriptLeakage(line.text, script) - noiseShare(line.text))
}

interface Candidate {
  /** The language of the reading, e.g. `ru`. Decides its script and its ties. */
  engine: string
  /**
   * This reading's identity: language plus preparation.
   *
   * Two readings by the same language of two differently prepared copies are
   * separate opinions and must be able to meet in one group, so the group test uses
   * this and not `engine`.
   */
  key: string
  script: OcrScript
  line: OcrLine
  box: OcrBox
  score: number
  reliability: number
}

/** How a reading is identified: language plus the preparation that produced it. */
function readingKey(result: OcrRawResult): string {
  return result.variant ? `${result.lang}@${result.variant}` : result.lang
}

/**
 * Every line every engine produced, grouped into the lines of the picture.
 *
 * A group is one line of the original screenshot, holding one candidate per engine
 * that saw it. Grouping is geometric — boxes on the same row that overlap — because
 * the readings are about the same pixels; text similarity would be the wrong test,
 * since the whole reason there are several readings is that they disagree about the
 * text.
 */
function groupLines(results: OcrRawResult[], reliabilities: Map<string, number>): Candidate[][] {
  const candidates: Candidate[] = []
  for (const result of results) {
    const script = scriptOf(result.lang)
    const key = readingKey(result)
    const reliability = reliabilities.get(key) ?? 0
    for (const line of result.lines) {
      const box = lineBox(line)
      if (!box) continue
      candidates.push({ engine: result.lang, key, script, line, box, score: lineScore(line, script), reliability })
    }
  }
  // Top to bottom, then left to right, so groups form in reading order.
  candidates.sort((a, b) => a.box.y + a.box.height / 2 - (b.box.y + b.box.height / 2) || a.box.x - b.box.x)

  const groups: Candidate[][] = []
  for (const candidate of candidates) {
    let best: Candidate[] | null = null
    let bestOverlap = 0
    for (const group of groups) {
      // Two lines from the same reading are never the same line: an engine that
      // split one line in two would otherwise merge with itself and lose half.
      if (group.some((entry) => entry.key === candidate.key)) continue
      const overlap = overlapRatio(group[0].box, candidate.box)
      if (overlap > bestOverlap) {
        bestOverlap = overlap
        best = group
      }
    }
    if (best && bestOverlap >= SAME_LINE_IOU) best.push(candidate)
    else groups.push([candidate])
  }

  for (const group of groups) {
    group.sort((a, b) => b.score - a.score || b.reliability - a.reliability)
  }
  return groups
}

/**
 * Merge every engine's reading into one.
 *
 * Line by line, not picture by picture. The earlier design picked the engine that
 * read the *whole* picture best and only asked the others about lines it had missed
 * — and it was wrong in a way that cost 12 % of all characters, measured across 14
 * font and size combinations: a picture with two halves in different scripts has no
 * best engine. Consolas at 16 px came back with the Russian engine reading the
 * Cyrillic half perfectly and the English half as "App1ication settings", while the
 * English engine had the English half perfect and the Cyrillic as "HacTpoVIKM". Each
 * engine is right about half the picture, and no single winner exists.
 *
 * Judging a line at a time used to be unreliable, and that was true when the only
 * signal was capitals. It is not true with `noiseShare`: the impostor line
 * "HacTpoVIKM npnnoxeHL" carries fused digits and the real line "Настройки
 * приложения" carries none, so the per-line comparison is decisive where the
 * per-picture one was a coin toss.
 *
 * `preferred` breaks a tie between two equally good readings — it is the language
 * Windows itself picked for the user, so the tie goes the way the user expects.
 */
export function mergeReadings(results: OcrRawResult[], preferred?: string): MergedReading {
  const usable = results.filter((result) => result.lines.length > 0)
  if (usable.length === 0) return { lines: [], primary: null, contributors: [] }

  const reliabilities = new Map(usable.map((result) => [readingKey(result), reliabilityScore(result)]))
  const bestReliability = Math.max(...reliabilities.values())
  const groups = groupLines(usable, reliabilities)

  const contributors = new Set<string>()
  const winCount = new Map<string, number>()
  const output: Array<{ y: number; x: number; line: OcrLine }> = []

  for (const group of groups) {
    const ordered = [...group].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      // On a tie, a substantially longer reading wins: what engines get wrong most
      // often is not misreading a character but dropping a stretch of one. Measured
      // at 11 px, the Russian engine returned "await ccmpressionLeveI: 1 })" — the
      // whole `sharp(buffer).png({` gone — and scored a clean 1.00 on what was left,
      // tying with the English engine's complete line.
      //
      // "Substantially" is load-bearing, and its size was measured: sweeping the
      // threshold over all 14 captured cases gives 5.74 % mean at 55–60 % more
      // letters and 6.27 % at 70–80 %. A blanket longer-wins rule is worse still
      // (6.89 %), because an engine that splits a line into two boxes is longer
      // without being better. So: half again as long, plus a floor of four letters.
      const aLetters = Array.from(a.line.text).filter(isLetter).length
      const bLetters = Array.from(b.line.text).filter(isLetter).length
      const longer = Math.max(aLetters, bLetters)
      const shorter = Math.min(aLetters, bLetters)
      if (longer - shorter >= Math.max(4, shorter * 0.6)) return bLetters - aLetters
      if (preferred) {
        if (a.engine === preferred) return -1
        if (b.engine === preferred) return 1
      }
      return b.reliability - a.reliability
    })

    const winner = ordered[0]

    // A line only one engine saw: nothing contradicts it, so the engine's overall
    // quality is the only evidence there is, and a hopeless reading is not believed.
    //
    // Judged in the script the *line* is written in, not the engine's. The Russian
    // engine reading an English code line is not a mistake — a mixed screen is full
    // of them — and asking "is this line Cyrillic?" rejected `electron-builder --win
    // nsis portable` purely for being English.
    if (ordered.length === 1) {
      if (bestReliability - winner.reliability > ADD_MAX_RELIABILITY_GAP) continue
      const script = majorityScript(winner.line.text) ?? winner.script
      if (!looksLikeText(winner.line.text, script)) continue
    }

    let line: OcrLine = { text: winner.line.text, words: winner.line.words.map((word) => ({ ...word })) }

    // The other readings are still evidence about this one line. First the word-level
    // vote, which corrects spellings in place; then a tail it stopped before; then the
    // words of the script it was not trained on. Applied best-first, so the most
    // trustworthy correction lands first.
    line = voteWords(
      line,
      winner.score,
      ordered.slice(1).map((other) => ({ line: other.line, score: other.score }))
    )

    for (const other of ordered.slice(1)) {
      line = withTail(line, other.line, other.box)

      const fixes = scriptWordFixes(line, other.line, other.script)
      if (fixes.length > 0) {
        const words = line.words.map((word, index) => {
          const fix = fixes.find((entry) => entry.index === index)
          return fix ? { ...word, text: fix.text } : word
        })
        line = { text: words.map((word) => word.text).join(' '), words }
      }
    }

    // Last, because it is the only repair that builds a word no single reading contains:
    // a path whose two halves come from two different engines.
    line = repairBackslashWords(line, ordered.slice(1).map((other) => other.line))

    contributors.add(winner.engine)
    winCount.set(winner.engine, (winCount.get(winner.engine) ?? 0) + 1)
    output.push({ y: winner.box.y, x: winner.box.x, line })
  }

  // Reading order: top to bottom, then left to right. The horizontal tie-break is
  // not decoration — both engines split `const settings = await store.load()` into
  // two boxes 3 px apart vertically, and sorting on y alone put the right-hand half
  // first, turning a correct reading into scrambled code.
  output.sort((a, b) => {
    if (Math.abs(a.y - b.y) > ROW_TOLERANCE) return a.y - b.y
    return a.x - b.x
  })

  let primary: string | null = null
  let best = -1
  for (const [engine, count] of winCount) {
    if (count > best) {
      best = count
      primary = engine
    }
  }

  return { lines: output.map((entry) => entry.line), primary, contributors: [...contributors] }
}
