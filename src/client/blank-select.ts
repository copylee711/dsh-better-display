/**
 * Start a text selection from blank space beside a formula block or a picture. Chromium places no
 * caret in the empty part of a centred KaTeX block or next to an inline figure, so a drag
 * starting there selected nothing and users had to start on nearby text (and over-select). Here
 * such a drag is anchored just before or after the block (whichever side the pointer is on) and
 * the selection follows the pointer like a native one. Drags that start on text, links, controls,
 * code or the picture itself (dragging a picture still attaches it) are left to the browser.
 */
import { MESSAGE_ROW } from './selection-markdown.ts'

/** Blocks a selection cannot start inside of: taken whole, from their start or end. */
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

/** The boundary just before or just after `block`, on the pointer's side. */
function beside(block: Element, x: number): Point | undefined {
  const parent = block.parentNode
  if (parent === null) return undefined
  const index = Array.prototype.indexOf.call(parent.childNodes, block) as number
  const rect = block.getBoundingClientRect()
  // A full-width formula block: compare with its content, not its (blank) box.
  const content = block.querySelector('.katex') ?? block
  const box = content.getBoundingClientRect()
  const middle = box.width > 0 ? box.left + box.width / 2 : rect.left + rect.width / 2
  return { node: parent, offset: x < middle ? index : index + 1 }
}

/** Selection point for a pointer position inside `row`. */
export function pointAt(x: number, y: number, row: Element): Point | undefined {
  const hit = document.elementFromPoint(x, y)
  const atom = hit?.closest(ATOMIC)
  if (atom && row.contains(atom)) return beside(atom, x)
  const caret = caretAt(x, y)
  if (caret === undefined || !row.contains(caret.node)) return undefined
  const inside = elementOf(caret.node)?.closest(ATOMIC)
  return inside && row.contains(inside) ? beside(inside, x) : caret
}

/** Whether a mouse-down at this spot is one the browser cannot start a selection from. */
function blankStart(event: MouseEvent, target: Element, row: Element): boolean {
  if (target.closest(NATIVE)) return false
  if (target.closest(ATOMIC)) return true
  // On text the browser does it; on a row's or paragraph's blank part it may not.
  const caret = caretAt(event.clientX, event.clientY)
  return caret === undefined || caret.node.nodeType !== Node.TEXT_NODE || !row.contains(caret.node) || target === row
}

/** Install the blank-space drag selection; returns its remover. */
export function installBlankSelection(): () => void {
  const down = (event: MouseEvent) => {
    if (event.button !== 0 || event.detail > 1 || event.shiftKey || event.altKey || event.defaultPrevented) return
    const target = event.target instanceof Element ? event.target : null
    const row = target?.closest(MESSAGE_ROW)
    if (target === null || row === null || row === undefined || !blankStart(event, target, row)) return
    const anchor = pointAt(event.clientX, event.clientY, row)
    if (anchor === undefined) return
    const selection = document.getSelection()
    if (selection === null) return
    // Keep the browser from starting its own (empty) selection or a drag of the block.
    event.preventDefault()
    selection.setBaseAndExtent(anchor.node, anchor.offset, anchor.node, anchor.offset)
    const move = (moved: MouseEvent) => {
      const focus = pointAt(moved.clientX, moved.clientY, row)
      if (focus !== undefined) selection.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset)
    }
    const up = () => {
      document.removeEventListener('mousemove', move, true)
      document.removeEventListener('mouseup', up, true)
    }
    document.addEventListener('mousemove', move, true)
    document.addEventListener('mouseup', up, true)
  }
  document.addEventListener('mousedown', down, true)
  return () => { document.removeEventListener('mousedown', down, true) }
}
