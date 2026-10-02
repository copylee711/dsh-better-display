// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { installBlankSelection, spanTo } from '../src/client/blank-select.ts'

function reply() {
  document.body.innerHTML = '<div data-chat-flow-kind="assistant-step"><p>前文</p><div class="katex-display"><span class="katex">x<span class="fbox"></span></span></div><p>后文</p><p><span class="dsh-better-display__figure"><img alt=""></span></p></div>'
  const row = document.querySelector('[data-chat-flow-kind]')!
  const block = row.querySelector('.katex-display')!
  const figure = row.querySelector('.dsh-better-display__figure')!
  return { row, block, figure, first: row.querySelector('p')!.firstChild!, after: row.querySelectorAll('p')[1]!.firstChild! }
}

function drag(target: Element, under: (x: number) => Element) {
  document.elementFromPoint = vi.fn((x: number) => under(x))
  const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 0, clientY: 0, button: 0, detail: 1 })
  target.dispatchEvent(down)
  return down
}

afterEach(() => {
  document.body.innerHTML = ''
  document.getSelection()?.removeAllRanges()
})

describe('atom-aware selection', () => {
  it('takes a block whole as soon as a drag reaches it, in either direction', () => {
    const { row, block, figure, first, after } = reply()
    const blockStart = { node: row, offset: 1 }
    const blockEnd = { node: row, offset: 2 }
    // Started on text before the block, now touching it: through its end.
    expect(spanTo({ caret: { node: first, offset: 1 } }, { atom: block })).toEqual([{ node: first, offset: 1 }, blockEnd])
    // Started on text after it: back to its start.
    expect(spanTo({ caret: { node: after, offset: 1 } }, { atom: block })).toEqual([{ node: after, offset: 1 }, blockStart])
    // Started on the block itself: the block alone, then grown from its far side.
    expect(spanTo({ atom: block }, { atom: block })).toEqual([blockStart, blockEnd])
    expect(spanTo({ atom: block }, { caret: { node: after, offset: 1 } })).toEqual([blockStart, { node: after, offset: 1 }])
    expect(spanTo({ atom: block }, { caret: { node: first, offset: 0 } })).toEqual([blockEnd, { node: first, offset: 0 }])
    expect(spanTo({ atom: block }, { atom: figure })).toEqual([blockStart, { node: figure.parentNode, offset: 1 }])
  })

  it('selects a block from a drag starting on its blank space', () => {
    const { block } = reply()
    const remove = installBlankSelection()
    const down = drag(block, () => block)
    expect(down.defaultPrevented).toBe(true)
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 5, clientY: 0, buttons: 1 }))
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: 5, clientY: 0 }))
    expect(document.getSelection()!.toString()).toBe('x')
    remove()
  })

  it('leaves text, links and pictures to the browser', () => {
    const { row } = reply()
    row.querySelector('p')!.innerHTML = '<a href="#">链接</a>'
    const remove = installBlankSelection()
    for (const target of [row.querySelector('a')!, row.querySelector('img')!]) {
      expect(drag(target, () => target).defaultPrevented).toBe(false)
    }
    remove()
  })
})

describe('ordinary formulas', () => {
  it('stay partly selectable: a drag from their blank space only starts at their edge', () => {
    document.body.innerHTML = '<div data-chat-flow-kind="assistant-step"><p>前文</p><div class="katex-display"><span class="katex">x</span></div></div>'
    const row = document.querySelector('[data-chat-flow-kind]')!
    const block = row.querySelector('.katex-display')!
    row.querySelector('.katex')!.getBoundingClientRect = () => ({ left: 200, width: 100, top: 0, height: 20 }) as DOMRect
    document.elementFromPoint = vi.fn(() => block)
    const remove = installBlankSelection()
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 20, clientY: 5, button: 0, detail: 1 })
    block.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true)
    // Hovering the formula does not take it whole (no box): the selection stays at its edge.
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 240, clientY: 5, buttons: 1 }))
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: 240, clientY: 5 }))
    const range = document.getSelection()!.getRangeAt(0)
    expect([range.startContainer, range.startOffset, range.collapsed]).toEqual([row, 1, true])
    remove()
  })
})

describe('table cells', () => {
  it('start a drag from a cell\'s padding in that cell', () => {
    document.body.innerHTML = '<div data-chat-flow-kind="assistant-step"><table><tr><td>甲</td><td>乙</td></tr></table></div>'
    const [first, second] = [...document.querySelectorAll('td')]
    first!.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, height: 20 }) as DOMRect
    document.elementFromPoint = vi.fn(() => second!)
    const remove = installBlankSelection()
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 2, clientY: 5, button: 0, detail: 1 })
    first!.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true)
    const range = document.getSelection()!.getRangeAt(0)
    expect([range.startContainer, range.startOffset]).toEqual([first, 0])
    remove()
  })
})

describe('pictures', () => {
  it('select from a drag that starts on the picture, without opening its preview', () => {
    document.body.innerHTML = '<div data-chat-flow-kind="assistant-step"><p>前文</p><span class="dsh-better-display__figure"><img class="dsh-better-display__image" alt="图"><span class="dsh-better-display__caption">图注</span></span></div>'
    const image = document.querySelector('img')!
    image.getBoundingClientRect = () => ({ left: 0, width: 400, top: 0, height: 300 }) as DOMRect
    document.elementFromPoint = vi.fn(() => image)
    const opened = vi.fn()
    image.addEventListener('click', opened)
    const remove = installBlankSelection()
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 10, clientY: 10, button: 0, detail: 1 })
    image.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true)
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 100, buttons: 1 }))
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: 200, clientY: 100 }))
    image.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(opened).not.toHaveBeenCalled()
    // The picture alone: its caption stays free text.
    const range = document.getSelection()!.getRangeAt(0)
    expect(range.cloneContents().querySelector('img')).not.toBeNull()
    expect(range.toString()).toBe('')
    remove()
  })
})
