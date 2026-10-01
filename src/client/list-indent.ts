/**
 * Repair under-indented list continuations. Models often write
 *
 *     1. **Title**:
 *      $$B=\frac{\mu_0 I}{2\pi a}$$
 *      Derivation: …
 *     2. **Next**
 *
 * with the item's body indented by one space. CommonMark needs the body at the item's content
 * column (3 here), so the list ends after the first line, the body becomes loose paragraphs, and
 * `2.` — an ordered marker other than 1 cannot interrupt a paragraph — is swallowed as plain
 * text, leaving items that look different from their siblings.
 *
 * A non-blank line indented by more than zero but less than the outermost open item's content
 * column is moved to the content column of the latest item. Unindented lines (lazy
 * continuations, the text after the list) and properly indented ones are left alone; fenced code
 * moves together with its opening fence. Only line prefixes change, so a streamed reply still
 * only ever appends.
 */

const MARKER = /^([-*+]|\d{1,9}[.)])( {1,4})(?=\S)/
const FENCE = /^ *(`{3,}|~{3,})/
const ANY_ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)]) /m

export function normalizeListIndent(text: string): string {
  if (!ANY_ITEM.test(text)) return text
  const lines = text.split('\n')
  /** Content columns of the open list items, outermost first. */
  const open: number[] = []
  /** Inside a fenced block: its closing marker and the shift applied to its lines. */
  let fence: { marker: string, shift: number } | undefined
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n]!
    if (fence !== undefined) {
      if (fence.shift > 0 && line.trim() !== '') lines[n] = ' '.repeat(fence.shift) + line
      if (line.trim().startsWith(fence.marker)) fence = undefined
      continue
    }
    const body = line.trimStart()
    if (body === '') continue
    const indent = line.length - body.length
    const shift = open.length > 0 && indent > 0 && indent < open[0]! ? open.at(-1)! - indent : 0
    const column = indent + shift
    if (shift > 0) lines[n] = ' '.repeat(column) + body
    const opened = FENCE.exec(lines[n]!)
    if (opened !== null) {
      fence = { marker: opened[1]!.slice(0, 3), shift }
      continue
    }
    const item = MARKER.exec(body)
    // An item opens at the top level (indent ≤ 3) or nested inside an open item's body.
    if (item !== null && (column <= 3 || open.length > 0)) {
      while (open.length > 0 && open.at(-1)! > column) open.pop()
      open.push(column + item[1]!.length + item[2]!.length)
    } else if (indent === 0) {
      // Unindented text: a lazy continuation or the end of the list; nothing below needs repair.
      open.length = 0
    }
  }
  return lines.join('\n')
}
