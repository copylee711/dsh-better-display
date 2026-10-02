// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { installBlankSelection, pointAt } from '../src/client/blank-select.ts'

function reply() {
  document.body.innerHTML = '<div data-chat-flow-kind="assistant-step"><p>前文</p><div class="katex-display"><span class="katex">x</span></div><p>后文</p></div>'
  const row = document.querySelector('[data-chat-flow-kind]')!
  const block = row.querySelector('.katex-display')!
  const formula = row.querySelector('.katex')!
  // The block spans the column; the formula sits in its middle (x 200-300).
  block.getBoundingClientRect = () => ({ left: 0, width: 500, top: 100, height: 40 }) as DOMRect
  formula.getBoundingClientRect = () => ({ left: 200, width: 100, top: 100, height: 40 }) as DOMRect
  document.elementFromPoint = vi.fn(() => block)
  return { row, block }
}

afterEach(() => {
  document.body.innerHTML = ''
  document.getSelection()?.removeAllRanges()
})

describe('blank-space selection', () => {
  it('anchors beside a formula block on the pointer\'s side', () => {
    const { row, block } = reply()
    expect(pointAt(20, 120, row)).toEqual({ node: row, offset: 1 })
    expect(pointAt(480, 120, row)).toEqual({ node: row, offset: 2 })
    expect(block.parentNode).toBe(row)
  })

  it('selects from blank space beside a formula to the pointer', () => {
    const { row, block } = reply()
    const remove = installBlankSelection()
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 20, clientY: 120, button: 0, detail: 1 })
    block.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true)
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 480, clientY: 120 }))
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: 480, clientY: 120 }))
    const range = document.getSelection()!.getRangeAt(0)
    expect([range.startContainer, range.startOffset, range.endContainer, range.endOffset]).toEqual([row, 1, row, 2])
    expect(range.toString()).toBe('x')
    remove()
  })

  it('leaves text, links and pictures to the browser', () => {
    const { row } = reply()
    row.querySelector('p')!.innerHTML = '<a href="#">链接</a><img alt="">'
    const remove = installBlankSelection()
    for (const target of [row.querySelector('a')!, row.querySelector('img')!]) {
      const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 20, clientY: 120, button: 0, detail: 1 })
      target.dispatchEvent(down)
      expect(down.defaultPrevented).toBe(false)
    }
    remove()
  })
})
