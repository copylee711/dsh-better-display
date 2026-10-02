/**
 * Selecting formula blocks and pictures by touching them. Chromium places no caret in the empty
 * part of a centred KaTeX block or next to an inline figure, so a drag starting there selected
 * nothing, and a drag into one only took it once the pointer had crossed it. Here formula blocks
 * and figures are atoms: a drag that reaches one selects it whole, and a drag may start on the
 * blank space around one (the selection then grows from that block). Drags that start on text
 * stay native until they reach an atom; links, controls, code and dragging the picture itself
 * (which still attaches it) are left to the browser.
 */
import { MESSAGE_ROW } from './selection-markdown.ts'

/** Blocks selected whole as soon as a drag reaches them. */
const ATOMIC = '.katex-display, .math-block, .dsh-better-display__figure'
const NATIVE = 'img, a, button, input, textarea, select, [contenteditable]:not([contenteditable="false"]), pre, code, .dsh-better-display__code'

interface Point { node: Node, offset: number }

type CaretDocument = Document & {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node, offset: number } | null
  caretRangeFromPoint?: (x: number, y: number) => Range | null
}

function caretAt(x: number, y: number): Point | undefined {
  const doc = document as CaretDocument
  const position = doc.caretPositionFromPoint?.(x, y)
  if (position) return { node: position.offsetNode, offset: position.offset }
  const range = doc.caretRangeFromPoint?.(x, y)
  return range ? { node: range.startContainer, offset: range.startOffset } : undefined
}

function elementOf(node: Node): Element | null {
  return node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement
}

/** The outermost atom holding `element` inside `row` (a figure inside a formula block, etc.). */
function atomOf(element: Element | null | undefined, row: Element): Element | undefined {
  let atom: Element | undefined
  for (let current = element?.closest(ATOMIC); current && row.contains(current); current = current.parentElement?.closest(ATOMIC)) atom = current
  return atom
}

function edge(atom: Element, after: boolean): Point {
  const parent = atom.parentNode!
  const index = Array.prototype.indexOf.call(parent.childNodes, atom) as number
  return { node: parent, offset: after ? index + 1 : index }
}

/** Whether `a` comes before `b` in the document. */
function precedes(a: Point, b: Point): boolean {
  const range = document.createRange()
  range.setStart(a.node, a.offset)
  return range.comparePoint(b.node, b.offset) > 0
}

/** What the pointer is over inside `row`: an atom, or a caret position in text. */
export function hitAt(x: number, y: number, row: Element): { atom: Element } | { caret: Point } | undefined {
  const atom = atomOf(document.elementFromPoint(x, y), row)
  if (atom) return { atom }
  const caret = caretAt(x, y)
  if (caret === undefined || !row.contains(caret.node)) return undefined
  const inside = atomOf(elementOf(caret.node), row)
  return inside ? { atom: inside } : { caret }
}

/**
 * The selection from a drag's start to the pointer, atoms taken whole.
 * @param start - where the drag started: an atom, or a caret position.
 */
export function spanTo(start: { atom: Element } | { caret: Point }, hit: { atom: Element } | { caret: Point }): [Point, Point] {
  if ('atom' in start) {
    if ('atom' in hit && hit.atom === start.atom) return [edge(start.atom, false), edge(start.atom, true)]
    const target = 'atom' in hit ? edge(hit.atom, false) : hit.caret
    const forward = precedes(edge(start.atom, false), target)
    const base = edge(start.atom, !forward)
    return [base, 'atom' in hit ? edge(hit.atom, forward) : hit.caret]
  }
  if ('atom' in hit) return [start.caret, edge(hit.atom, precedes(start.caret, edge(hit.atom, false)))]
  return [start.caret, hit.caret]
}

/** Install atom-aware drag selection; returns its remover. */
export function installBlankSelection(): () => void {
  const down = (event: MouseEvent) => {
    if (event.button !== 0 || event.detail > 1 || event.shiftKey || event.altKey || event.defaultPrevented) return
    const target = event.target instanceof Element ? event.target : null
    const row = target?.closest(MESSAGE_ROW)
    if (target === null || row === null || row === undefined || target.closest(NATIVE)) return
    const selection = document.getSelection()
    if (selection === null) return
    const atom = atomOf(target, row)
    const caret = caretAt(event.clientX, event.clientY)
    const onText = caret !== undefined && caret.node.nodeType === Node.TEXT_NODE && row.contains(caret.node) && target !== row
    // On text the browser starts the selection; elsewhere (blank space, a block) we do.
    let start: { atom: Element } | { caret: Point } | undefined
    if (atom) start = { atom }
    else if (!onText) start = hitAt(event.clientX, event.clientY, row)
    if (start !== undefined) {
      event.preventDefault()
      const [base] = spanTo(start, start)
      selection.setBaseAndExtent(base.node, base.offset, base.node, base.offset)
    }
    let native: Point | undefined
    let pending = 0
    const apply = (x: number, y: number) => {
      const hit = hitAt(x, y, row)
      if (hit === undefined) return
      if (start === undefined) {
        // A native drag: only step in once it reaches an atom.
        if (!('atom' in hit)) return
        native ??= selection.anchorNode === null ? undefined : { node: selection.anchorNode, offset: selection.anchorOffset }
        if (native === undefined || !row.contains(native.node)) return
      }
      const [base, extent] = spanTo(start ?? { caret: native! }, hit)
      selection.setBaseAndExtent(base.node, base.offset, extent.node, extent.offset)
    }
    let last: [number, number] | undefined
    const move = (moved: MouseEvent) => {
      if ((moved.buttons & 1) === 0) return
      if (start !== undefined) {
        apply(moved.clientX, moved.clientY)
        return
      }
      // The browser updates its own selection after this event; adjust once it has.
      last = [moved.clientX, moved.clientY]
      cancelAnimationFrame(pending)
      pending = requestAnimationFrame(() => {
        pending = 0
        apply(moved.clientX, moved.clientY)
      })
    }
    const up = () => {
      // Settle a pending adjustment before the toolbar reads the selection.
      if (pending !== 0 && last !== undefined) {
        cancelAnimationFrame(pending)
        apply(...last)
      }
      document.removeEventListener('mousemove', move, true)
      document.removeEventListener('mouseup', up, true)
    }
    document.addEventListener('mousemove', move, true)
    document.addEventListener('mouseup', up, true)
  }
  document.addEventListener('mousedown', down, true)
  return () => { document.removeEventListener('mousedown', down, true) }
}
