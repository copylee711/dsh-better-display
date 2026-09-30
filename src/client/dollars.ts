/**
 * Keep currency like `$2 / $10` out of inline math. Markstream pairs any two `$` on a line, so
 * prices turned into KaTeX. Apply Pandoc's `tex_math_dollars` rule instead: `$…$` is math only
 * when the opening `$` is followed by a non-space, the closing `$` is preceded by a non-space
 * and not followed by a digit. Every other lone `$` is escaped as `\$` (a literal dollar).
 * Code spans, fenced code, `$$` display math and already escaped `\$` are left alone.
 *
 * Inside math, a Markdown-escaped asterisk (`x^\*`, written to dodge emphasis) is turned back
 * into `*`: KaTeX has no `\*` command and would render it as a red error.
 */

const FENCE = /^ {0,3}(`{3,}|~{3,})/

function isSpace(ch: string | undefined): boolean {
  return ch === undefined || /\s/.test(ch)
}

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= '0' && ch <= '9'
}

/**
 * Index of a valid closing `$` for an opener at `open`, -1 when there is none, or -2 when the
 * answer depends on a character not received yet (`tail` line ending right after a `$`).
 */
function closingDollar(line: string, open: number, tail = false): number {
  for (let i = open + 1; i < line.length; i++) {
    const ch = line[i]
    if (ch === '\\') { i++; continue }
    if (ch === '`') return -1
    if (ch !== '$') continue
    if (tail && i === line.length - 1) return -2
    if (line[i + 1] === '$') return -1
    if (!isSpace(line[i - 1]) && !isDigit(line[i + 1])) return i
  }
  return -1
}

const ESCAPED_ASTERISK = /(^|[^\\])\\\*/g

/** Undo Markdown-style `\*` inside TeX. */
function fixMath(tex: string): string {
  return tex.includes('\\*') ? tex.replace(ESCAPED_ASTERISK, '$1*').replace(ESCAPED_ASTERISK, '$1*') : tex
}

/** Drop a trailing unpaired backslash: the escape it starts is not known yet. */
function withoutDanglingEscape(text: string): string {
  const run = /\\+$/.exec(text)?.[0].length ?? 0
  return run % 2 === 1 ? text.slice(0, -1) : text
}

/**
 * Rewrite one line. `tail` marks the still-growing last line of a streamed reply: there a
 * construct whose meaning depends on text not yet received (an opening `$` without a closer, an
 * unclosed code span before a `$`) cuts the line short instead of being guessed, so every later
 * update only appends to what was already shown.
 */
function escapeLine(line: string, tail: boolean): string {
  let out = ''
  let i = 0
  while (i < line.length) {
    const ch = line[i]!
    if (ch === '\\') { out += line.slice(i, i + 2); i += 2; continue }
    if (ch === '`') {
      const run = /^`+/.exec(line.slice(i))![0]
      const end = line.indexOf(run, i + run.length)
      if (end === -1 && tail && line.includes('$', i)) return out
      const stop = end === -1 ? i + run.length : end + run.length
      out += line.slice(i, stop)
      i = stop
      continue
    }
    if (ch !== '$') { out += ch; i++; continue }
    if (line[i + 1] === '$') {
      const end = line.indexOf('$$', i + 2)
      const stop = end === -1 ? line.length : end + 2
      out += fixMath(line.slice(i, stop))
      i = stop
      continue
    }
    const close = isSpace(line[i + 1]) && !(tail && i + 1 >= line.length) ? -1 : closingDollar(line, i, tail)
    if (close === -2) return out
    if (close === -1) {
      if (tail) return out
      out += '\\$'
      i++
      continue
    }
    out += fixMath(line.slice(i, close + 1))
    i = close + 1
  }
  return out
}

/**
 * @param text - assistant Markdown.
 * @param streaming - whether `text` is a growing prefix of the reply; the undecided end of the
 *   last line is then held back so that successive results only ever append.
 * @returns the same Markdown with non-math `$` escaped.
 */
export function escapeCurrencyDollars(text: string, streaming = false): string {
  if (!text.includes('$')) return text
  const lines = text.split('\n')
  const last = lines.length - 1
  let fence: string | undefined
  let display = false
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n]!
    const tail = streaming && n === last
    if (fence !== undefined) {
      if (line.trimStart().startsWith(fence)) fence = undefined
      continue
    }
    const opened = FENCE.exec(line)
    if (opened) { fence = opened[1]!.slice(0, 3); continue }
    const trimmed = line.trim()
    if (display) {
      lines[n] = fixMath(tail ? withoutDanglingEscape(line) : line)
      if (trimmed.endsWith('$$')) display = false
      continue
    }
    if (trimmed.startsWith('$$') && (trimmed === '$$' || !trimmed.slice(2).includes('$$'))) {
      lines[n] = fixMath(tail ? withoutDanglingEscape(line) : line)
      display = true
      continue
    }
    if (line.includes('$')) lines[n] = escapeLine(tail ? withoutDanglingEscape(line) : line, tail)
  }
  return lines.join('\n')
}
