/**
 * Turn a selection in the transcript back into Markdown. `Selection.toString()` flattens KaTeX
 * into its MathML text plus glyph spans (`μ0 4π μ0​ ​`), drops emphasis, lists and tables, and
 * cannot carry pictures; this walks the selected DOM instead: formulas come back as `$TeX$` from
 * KaTeX's TeX annotation, structure as Markdown, and pictures are collected separately so they
 * can be attached as images.
 */
import { partialTex } from './partial-tex.ts'

/** Transcript rows a quote may come from (assistant replies and the user's own messages). */
export const MESSAGE_ROW = '[data-chat-flow-kind="assistant-step"], [data-chat-flow-kind="assistant"], [data-chat-flow-kind="user"]'
/** Never quote out of editors, controls, hidden parts or tool output. */
const BLOCKED = 'input, textarea, button, [contenteditable]:not([contenteditable="false"]), [hidden], [data-turn-process-inline]'
/** Decoration that must not leak into a quote. */
const SKIPPED = 'button, svg, style, script, .katex-html, .sr-only, [aria-hidden="true"]:not(.katex), .dsh-better-display__code-header, .table-node__resize-handle'

export interface QuotedImage {
  /** Absolute URL the picture is shown from. */
  src: string
  alt: string
}

export interface SelectionQuote {
  markdown: string
  images: QuotedImage[]
}

function elementOf(node: Node | null): Element | null {
  return node === null ? null : node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement
}

/** The message row holding the whole range, or null when the range is not quotable. */
export function quotableRow(range: Range, target?: EventTarget | null): Element | null {
  const start = elementOf(range.startContainer)
  const end = elementOf(range.endContainer)
  const row = start?.closest(MESSAGE_ROW) ?? null
  if (row === null || end?.closest(MESSAGE_ROW) !== row) return null
  if (target instanceof Node && elementOf(target)?.closest(MESSAGE_ROW) !== row) return null
  if (start?.closest(BLOCKED) || end?.closest(BLOCKED)) return null
  return row
}

/** Grow the range so formulas cut by its ends are quoted whole. */
function wholeFormulas(range: Range): Range {
  const expanded = range.cloneRange()
  // The display wrapper first: a range inside a block formula must keep it so the quote stays `$$…$$`.
  const formula = (node: Node) => {
    const element = elementOf(node)
    return element?.closest('.katex-display') ?? element?.closest('.katex') ?? null
  }
  const first = formula(range.startContainer)
  const last = formula(range.endContainer)
  if (first) expanded.setStartBefore(first)
  if (last) expanded.setEndAfter(last)
  return expanded
}

/** Set on a formula cut by the selection: the TeX of just its selected part. */
const PART_TEX = 'data-better-display-part-tex'

function texOf(element: Element): string {
  const part = element.getAttribute(PART_TEX)
  if (part !== null) return part
  return element.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim() ?? element.textContent ?? ''
}

interface Walk {
  images: QuotedImage[]
}

const BLOCK = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'FIGURE', 'DETAILS', 'SUMMARY'])

function children(node: Node, walk: Walk): string {
  let out = ''
  node.childNodes.forEach(child => { out += serialize(child, walk) })
  return out
}

function block(text: string): string {
  const body = text.trim()
  return body === '' ? '' : `\n\n${body}\n\n`
}

function prefixLines(text: string, first: string, rest: string): string {
  return text.split('\n').map((line, index) => (index === 0 ? first : line === '' ? rest.trimEnd() : rest) + line).join('\n')
}

function listItem(item: Element, marker: string, walk: Walk): string {
  const body = children(item, walk).replace(/\n{3,}/g, '\n\n').trim()
  return prefixLines(body, marker, ' '.repeat(marker.length))
}

function list(element: Element, walk: Walk): string {
  const ordered = element.tagName === 'OL'
  let counter = Number(element.getAttribute('start') ?? 1)
  const items: string[] = []
  element.childNodes.forEach(child => {
    if (!(child instanceof Element) || child.tagName !== 'LI') return
    const value = Number(child.getAttribute('value') ?? Number.NaN)
    if (Number.isFinite(value)) counter = value
    items.push(listItem(child, ordered ? `${String(counter)}. ` : '- ', walk))
    counter++
  })
  return block(items.join('\n'))
}

function cell(element: Element, walk: Walk): string {
  return children(element, walk).replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').trim()
}

function table(element: Element, walk: Walk): string {
  const rows = [...element.querySelectorAll('tr')].map(row => [...row.children].filter(child => child.tagName === 'TD' || child.tagName === 'TH').map(child => cell(child, walk)))
  if (rows.length === 0) return ''
  const width = Math.max(...rows.map(row => row.length))
  const line = (row: string[]) => `| ${Array.from({ length: width }, (_, index) => row[index] ?? '').join(' | ')} |`
  return block([line(rows[0]!), `|${' --- |'.repeat(width)}`, ...rows.slice(1).map(line)].join('\n'))
}

/** Fenced block; the language comes from better-display's code header around `source`. */
function codeBlock(text: string, source: Element): string {
  const code = text.replace(/\n+$/, '')
  const container = source.closest('.dsh-better-display__code')
  const language = container?.querySelector('.dsh-better-display__code-lang')?.textContent?.trim().toLowerCase() ?? ''
  const longest = Math.max(2, ...(code.match(/`+/g) ?? []).map(run => run.length))
  const fence = '`'.repeat(longest + 1)
  return block(`${fence}${language}\n${code}\n${fence}`)
}

function wrap(text: string, mark: string): string {
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!
  return match[2] === '' ? text : `${match[1]!}${mark}${match[2]!}${mark}${match[3]!}`
}

function serialize(node: Node, walk: Walk): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? ''
    return text.replace(/\s*\n\s*/g, ' ')
  }
  if (!(node instanceof Element)) return node.nodeType === Node.DOCUMENT_FRAGMENT_NODE ? children(node, walk) : ''
  if (node.classList.contains('katex-display') || node.classList.contains('math-block')) {
    const katex = node.classList.contains('katex') ? node : node.querySelector('.katex')
    return katex === null ? '' : block(`$$\n${texOf(katex)}\n$$`)
  }
  if (node.classList.contains('katex')) {
    return node.closest('.katex-display') !== null || node.parentElement?.closest('.katex-display') ? block(`$$\n${texOf(node)}\n$$`) : `$${texOf(node)}$`
  }
  if (node.matches(SKIPPED)) return ''
  const tag = node.tagName
  if (tag === 'IMG') {
    const image = node as HTMLImageElement
    const alt = image.alt.trim()
    const src = image.currentSrc || image.src
    if (src === '') return alt
    walk.images.push({ src, alt })
    // The caption, when selected too, is quoted as its own text; the picture then needs no alt.
    // (Its siblings: the figure itself is not cloned when the selection lies inside it.)
    const captioned = [...(image.parentNode?.childNodes ?? [])].some(sibling => sibling instanceof Element && sibling.classList.contains('dsh-better-display__caption'))
    // Kept as a Markdown image so the quote card shows it in place (sending swaps in a label).
    return `![${captioned ? '' : alt.replace(/[[\]]/g, '')}](${src.replace(/[ ()]/g, encodeURIComponent)})`
  }
  // A picture's caption (selected as ordinary text): its own line under the picture.
  if (node.classList.contains('dsh-better-display__caption')) return block(children(node, walk))
  if (tag === 'BR') return '\n'
  if (tag === 'HR') return block('---')
  if (/^H[1-6]$/.test(tag)) return block(`${'#'.repeat(Number(tag[1]))} ${children(node, walk).trim()}`)
  if (tag === 'UL' || tag === 'OL') return list(node, walk)
  // A selection cut inside a list yields bare items: keep them one list, not loose paragraphs.
  if (tag === 'LI') return `
${listItem(node, node.parentElement?.tagName === 'OL' ? `${node.getAttribute('value') ?? '1'}. ` : '- ', walk)}
`
  if (tag === 'TABLE') return table(node, walk)
  if (tag === 'PRE') return codeBlock(node.textContent ?? '', node)
  if (tag === 'BLOCKQUOTE') return block(prefixLines(children(node, walk).replace(/\n{3,}/g, '\n\n').trim(), '> ', '> '))
  if (tag === 'CODE') return `\`${node.textContent ?? ''}\``
  if (tag === 'STRONG' || tag === 'B') return wrap(children(node, walk), '**')
  if (tag === 'EM' || tag === 'I') return wrap(children(node, walk), '*')
  if (tag === 'DEL' || tag === 'S') return wrap(children(node, walk), '~~')
  if (tag === 'A') {
    const text = children(node, walk)
    const href = node.getAttribute('href') ?? ''
    return /^https?:\/\//i.test(href) && text.trim() !== '' ? `[${text.trim()}](${href})` : text
  }
  const inner = children(node, walk)
  return BLOCK.has(tag) ? block(inner) : inner
}

function tidy(markdown: string): string {
  return markdown.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** Markdown and pictures of a selection range (a formula cut by the range: just its selected part). */
export function selectionToMarkdown(range: Range): SelectionQuote {
  // Formulas cut by the selection are quoted as just their selected part (partial-tex.ts).
  const cut: Element[] = []
  for (const node of [range.startContainer, range.endContainer]) {
    const katex = elementOf(node)?.closest('.katex')
    if (katex === null || katex === undefined || cut.includes(katex)) continue
    const part = partialTex(katex, range)
    if (part === undefined) continue
    katex.setAttribute(PART_TEX, part)
    cut.push(katex)
  }
  try {
    return quoteOf(range)
  } finally {
    for (const katex of cut) katex.removeAttribute(PART_TEX)
  }
}

function quoteOf(range: Range): SelectionQuote {
  const expanded = wholeFormulas(range)
  const walk: Walk = { images: [] }
  const ancestor = elementOf(expanded.commonAncestorContainer)
  const pre = ancestor?.closest('pre')
  // A selection inside one code block keeps its text verbatim.
  if (pre) return { markdown: codeBlock(expanded.toString(), pre).trim(), images: [] }
  const inlineCode = ancestor?.closest('code')
  if (inlineCode) return { markdown: `\`${expanded.toString()}\``, images: [] }
  const markdown = tidy(serialize(expanded.cloneContents(), walk))
  return { markdown, images: walk.images }
}

/** Markdown of one whole element (a picture, a message part). */
export function elementToMarkdown(element: Element): SelectionQuote {
  const walk: Walk = { images: [] }
  return { markdown: tidy(serialize(element.cloneNode(true), walk)), images: walk.images }
}
