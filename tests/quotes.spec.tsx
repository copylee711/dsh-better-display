// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { removeCustomComponents } from 'markstream-react'
import { apply } from '../src/client/index.ts'
import { Composer } from '../src/client/composer.ts'
import type { InputActions, InputState } from '../src/client/dsh-input.ts'
import { QUOTE_SOURCE, QuoteStore, blockquote, quoteLabel } from '../src/client/quotes.ts'
import { createComposerDock } from '../src/client/selection-ui.tsx'

const TEX = String.raw`$\frac{\mu_0}{4\pi}$`

beforeEach(() => {
  document.documentElement.lang = 'zh-CN'
  apply({ slots: { inject: (_name: string, setup: () => unknown) => setup(), register: () => () => {} }, inject: vi.fn(), effect: (setup: () => unknown) => setup() } as never)
})

afterEach(() => {
  cleanup()
  removeCustomComponents('dsh-better-display')
  vi.unstubAllGlobals()
})

describe('quote codec', () => {
  it('serializes to a blockquote and labels chips readably', async () => {
    expect(blockquote(`第一行 ${TEX}\n\n第二行`)).toBe(`> 第一行 ${TEX}\n>\n> 第二行`)
    expect(quoteLabel(`**毕奥–萨伐尔** 定律 ${TEX} 描述电流元产生的磁场`)).toBe('引用：毕奥–萨伐尔 定律 ∑ 描述…')
    const store = new QuoteStore()
    const quote = store.add('s1', '原文')
    const source = store.source()
    expect(source.name).toBe(QUOTE_SOURCE)
    expect(await source.candidates(undefined, undefined)).toEqual([])
    expect(await source.codec!.serialize(quote.ref, new AbortController().signal)).toBe('\n\n> 原文\n\n')
    store.update(quote.ref, '改过的')
    expect(await source.codec!.serialize(quote.ref, new AbortController().signal)).toBe('\n\n> 改过的\n\n')
    expect(source.codec!.clipboardText(quote.ref)).toBe('\n> 改过的\n')
    expect(source.openReference!(undefined, { ref: quote.ref })).toBe(true)
    expect(store.editing).toBe(quote.ref)
  })
})

function fakeInput(draft = '问题：') {
  const state: InputState = { draft, draftRev: 3, phase: 'plain', occurrences: [], attachmentIds: [] }
  return {
    state: { getSnapshot: () => state },
    insertReference: vi.fn(() => true),
    addAttachments: vi.fn(() => true),
    notify: vi.fn(),
    focus: vi.fn(),
  }
}

describe('Composer.add', () => {
  it('inserts a quote chip at the caret and attaches pictures', async () => {
    const input = fakeInput()
    const createDrafts = vi.fn((_session: string, files: readonly File[]) => files.map((_file, index) => ({ id: `d${String(index)}` })))
    const composer = new Composer(new QuoteStore(), () => ({ conversation: { input: { for: () => input }, createDrafts }, sessions: { scope: () => ({}) } }))
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]), { status: 200 })))
    const actions = { captureInsertion: vi.fn(() => ({ start: 1, end: 1, draftRev: 3 })) } as unknown as InputActions
    const attached = await composer.add('s1', `公式 ${TEX}`, [{ src: `${location.origin}/plugins/copylee-image-gen/jobs/x/image`, alt: '示意图' }], actions)
    expect(attached).toBe(1)
    const [reference, span] = input.insertReference.mock.calls[0] as unknown as [{ source: string, ref: string, clipboardText: string }, unknown]
    expect(reference.source).toBe(QUOTE_SOURCE)
    expect(reference.clipboardText).toBe(`\n> 公式 ${TEX}\n`)
    expect(span).toEqual({ start: 1, end: 1, draftRev: 3 })
    expect(createDrafts.mock.calls[0]?.[1][0]).toMatchObject({ name: '示意图.png', type: 'image/png' })
    expect(input.addAttachments).toHaveBeenCalledWith(['d0'])
    expect(input.focus).toHaveBeenCalled()
  })

  it('falls back to the Host proxy for pictures other sites will not share', async () => {
    const input = fakeInput()
    const fetch = vi.fn(async (url: string) => {
      if (url.startsWith('https://img.example/')) throw new TypeError('CORS')
      return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0]), { status: 200, headers: { 'content-type': 'application/octet-stream' } })
    })
    vi.stubGlobal('fetch', fetch)
    const composer = new Composer(new QuoteStore(), () => ({ conversation: { input: { for: () => input }, createDrafts: () => [{ id: 'd0' }] }, sessions: { scope: () => ({}) } }))
    await composer.add('s1', '', [{ src: 'https://img.example/a.jpg', alt: '' }])
    expect(fetch.mock.calls[1]?.[0]).toBe(`${location.origin}/plugins/better-display/image?url=${encodeURIComponent('https://img.example/a.jpg')}`)
    expect(input.insertReference).not.toHaveBeenCalled()
  })

  it('refuses while the composer is submitting', async () => {
    const input = fakeInput()
    Object.assign(input.state.getSnapshot(), { phase: 'submitting' })
    const composer = new Composer(new QuoteStore(), () => ({ conversation: { input: { for: () => input } }, sessions: { scope: () => ({}) } }))
    await expect(composer.add('s1', 'x', [])).rejects.toThrow('输入框正忙')
  })
})

describe('quote cards', () => {
  it('render the quote, edit its source and remove its chip', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ selectionTools: false, sideQuestions: false }), { headers: { 'content-type': 'application/json' } })))
    const store = new QuoteStore()
    const quote = store.add('s1', `公式 ${TEX}`)
    const composer = new Composer(store, () => ({}))
    const Dock = createComposerDock({ composer, side: () => undefined, state: async () => ({ selectionTools: false, sideQuestions: false }) })
    const insertText = vi.fn(() => true)
    const input: InputState = { draft: '问题', draftRev: 7, phase: 'plain', attachmentIds: [], occurrences: [{ occurrenceId: 1, source: QUOTE_SOURCE, ref: quote.ref, offset: 2, length: 8, label: '引用：公式' }] }
    const view = render(<Dock session={{ sessionId: 's1' }} input={input} inputActions={{ insertText } as unknown as InputActions} />)
    await waitFor(() => { expect(view.container.querySelector('.dsh-better-display__quote-card .katex')).not.toBeNull() })
    expect(view.container.querySelector('.dsh-better-display__quote-label')?.textContent).toBe('引用：公式')

    fireEvent.click(view.getByText('编辑'))
    const editor = view.container.querySelector('textarea')!
    expect(editor.value).toBe(`公式 ${TEX}`)
    fireEvent.change(editor, { target: { value: '改写后的引用' } })
    fireEvent.click(view.getByText('完成'))
    expect(store.get(quote.ref)?.markdown).toBe('改写后的引用')

    fireEvent.click(view.getByText('移除'))
    expect(insertText).toHaveBeenCalledWith('', { start: 2, end: 10, draftRev: 7 })
    expect(store.get(quote.ref)).toBeUndefined()
  })
})

describe('selection toolbar', () => {
  it('turns a selection into a quote chip and offers a side question', async () => {
    const input = fakeInput()
    const composer = new Composer(new QuoteStore(), () => ({ conversation: { input: { for: () => input } }, sessions: { scope: () => ({}) } }))
    const ask = vi.fn(() => 'id')
    const none: never[] = []
    const side = { ask, list: () => none, subscribe: () => () => {}, snapshot: () => none } as never
    const Dock = createComposerDock({ composer, side: () => side, state: async () => ({ selectionTools: true, sideQuestions: true }) })
    const view = render(<>
      <div data-chat-flow-kind="assistant-step"><p>磁场 <strong>垂直</strong> 于连线</p></div>
      <Dock session={{ sessionId: 's1' }} input={input.state.getSnapshot()} inputActions={{ captureInsertion: () => ({ start: 0, end: 0, draftRev: 3 }) } as unknown as InputActions} />
    </>)
    const paragraph = view.container.querySelector('p')!
    const selectAll = () => {
      const range = document.createRange()
      range.selectNodeContents(paragraph)
      const selection = document.getSelection()!
      selection.removeAllRanges()
      selection.addRange(range)
      fireEvent.mouseUp(paragraph)
    }
    selectAll()
    const add = await view.findByText('添加到对话')
    fireEvent.click(add)
    await waitFor(() => { expect(input.insertReference).toHaveBeenCalled() })
    expect((input.insertReference.mock.calls[0] as unknown as [{ clipboardText: string }])[0].clipboardText).toBe('\n> 磁场 **垂直** 于连线\n')

    selectAll()
    fireEvent.click(await view.findByText('旁问'))
    const dialog = await view.findByRole('dialog')
    fireEvent.click(view.getByText('解释一下'))
    expect(ask).toHaveBeenCalledWith('s1', '解释一下', '磁场 **垂直** 于连线')
    expect(dialog.isConnected).toBe(false)
  })
})
