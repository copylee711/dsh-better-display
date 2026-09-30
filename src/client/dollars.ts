/**
 * Keep currency like `$2 / $10` out of inline math. Markstream pairs any two `$` on a line, so
 * prices turned into KaTeX. Apply Pandoc's `tex_math_dollars` rule instead: `$…$` is math only
 * when the opening `$` is followed by a non-space, the closing `$` is preceded by a non-space
 * and not followed by a digit. Every other lone `$` is escaped as `\$` (a literal dollar).
 * Code spans, fenced code, `$$` display math and already escaped `\$` are left alone.
 */

const FENCE = /^ {0,3}(`{3,}|~{3,})/

function isSpace(ch: string | undefined): boolean {
  return ch === undefined || /\s/.test(ch)
}

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= '0' && ch <= '9'
}

/** Index of a valid closing `$` for an opener at `open`, or -1. */
function closingDollar(line: string, open: number): number {
  for (let i = open + 1; i < line.length; i++) {
    const ch = line[i]
    if (ch === '\\') { i++; continue }
    if (ch === '`') return -1
    if (ch !== '$') continue
    if (line[i + 1] === '$') return -1
    if (!isSpace(line[i - 1]) && !isDigit(line[i + 1])) return i
  }
  return -1
}

function escapeLine(line: string): string {
  let out = ''
  let i = 0
  while (i < line.length) {
    const ch = line[i]!
    if (ch === '\\') { out += line.slice(i, i + 2); i += 2; continue }
    if (ch === '`') {
      const run = /^`+/.exec(line.slice(i))![0]
      const end = line.indexOf(run, i + run.length)
      const stop = end === -1 ? i + run.length : end + run.length
      out += line.slice(i, stop)
      i = stop
      continue
    }
    if (ch !== '$') { out += ch; i++; continue }
    if (line[i + 1] === '$') {
      const end = line.indexOf('$$', i + 2)
      const stop = end === -1 ? line.length : end + 2
      out += line.slice(i, stop)
      i = stop
      continue
    }
    const close = isSpace(line[i + 1]) ? -1 : closingDollar(line, i)
    if (close === -1) { out += '\\$'; i++; continue }
    out += line.slice(i, close + 1)
    i = close + 1
  }
  return out
}

/**
 * @param text - assistant Markdown.
 * @returns the same Markdown with non-math `$` escaped.
 */
export function escapeCurrencyDollars(text: string): string {
  if (!text.includes('$')) return text
  const lines = text.split('\n')
  let fence: string | undefined
  let display = false
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n]!
    if (fence !== undefined) {
      if (line.trimStart().startsWith(fence)) fence = undefined
      continue
    }
    const opened = FENCE.exec(line)
    if (opened) { fence = opened[1]!.slice(0, 3); continue }
    const trimmed = line.trim()
    if (display) {
      if (trimmed.endsWith('$$')) display = false
      continue
    }
    if (trimmed.startsWith('$$') && (trimmed === '$$' || !trimmed.slice(2).includes('$$'))) { display = true; continue }
    if (line.includes('$')) lines[n] = escapeLine(line)
  }
  return lines.join('\n')
}
