// @vitest-environment jsdom

import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { removeCustomComponents } from 'markstream-react'
import { apply } from '../src/client/index.ts'
import { DshTextNode as TextNode } from '../src/client/renderer.tsx'
import { QUOTE_SOURCE } from '../src/client/quotes.ts'
import { draftWords } from '../src/client/selection-ui.tsx'
import { createUserMessageView, hardBreaks, looksLikeMarkdown, userMarkdownSetting } from '../src/client/user-message.tsx'

beforeEach(() => {
  apply({ slots: { inject: (_name: string, setup: () => unknown) => setup(), register: () => () => {} }, inject: vi.fn(), effect: (setup: () => unknown) => setup() } as never)
})

afterEach(() => {
  cleanup()
  removeCustomComponents('dsh-better-display')
  userMarkdownSetting.set(true)
})

describe('user message Markdown', () => {
  it('tells Markdown from plain prose and keeps line breaks', () => {
    expect(looksLikeMarkdown('帮我看看这个问题')).toBe(false)
    expect(looksLikeMarkdown('为什么 $B=\\mu_0 I$ 成立')).toBe(true)
    expect(looksLikeMarkdown('> 引用\n\n问题')).toBe(true)
    expect(looksLikeMarkdown('- 一\n- 二')).toBe(true)
    expect(hardBreaks('第一行\n第二行\n\n段落')).toBe('第一行  \n第二行\n\n段落')
    expect(hardBreaks('```\na\nb\n```')).toBe('```\na\nb\n```')
    expect(hardBreaks('$$\na\nb\n$$')).toBe('$$\na\nb\n$$')
  })

  // The built-in bubble's shape: CSS-module classes around the text box, actions after it.
  function Builtin({ node }: { node: { data: { content: Array<{ type: string, text: string }> } } }) {
    return <div className="Six_userRow"><div className="Six_userStack"><div className="Six_bubble">{node.data.content[0]!.text}</div></div><button type="button">copy</button></div>
  }
  const View = createUserMessageView(() => Builtin as never)
  const node = (text: string, extra: Record<string, unknown> = {}) => ({ kind: 'user', data: { content: [{ type: 'text', text }], ...extra } })

  it('swaps the built-in text box for rendered Markdown and keeps the rest', async () => {
    const view = render(<View node={node('> 引用 $x^2$\n\n- 一\n- 二')} />)
    await waitFor(() => { expect(view.container.querySelector('.dsh-better-display__user-markdown .katex')).not.toBeNull() })
    expect(view.container.querySelector('.Six_bubble')!.hasAttribute('data-better-display-replaced')).toBe(true)
    expect(view.container.querySelector('.dsh-better-display__user-markdown')!.classList.contains('Six_bubble')).toBe(true)
    expect(view.container.querySelectorAll('.dsh-better-display__user-markdown li')).toHaveLength(2)
    expect(view.getByText('copy')).toBeDefined()
  })

  it('leaves plain prose, reference chips and the switched-off setting to the built-in bubble', () => {
    const plain = render(<View node={node('你好')} />)
    expect(plain.container.querySelector('.dsh-better-display__user-markdown')).toBeNull()
    plain.unmount()
    const chips = render(<View node={node('看 `a.ts`', { referenceLabels: ['a.ts'] })} />)
    expect(chips.container.querySelector('.dsh-better-display__user-markdown')).toBeNull()
    chips.unmount()
    userMarkdownSetting.set(false)
    const off = render(<View node={node('**粗体**')} />)
    expect(off.container.querySelector('.dsh-better-display__user-markdown')).toBeNull()
  })
})

describe('streamed text', () => {
  it('fades in each new piece in its own span and folds settled pieces back', () => {
    const ctx = {}
    const props = (content: string) => ({ node: { type: 'text' as const, content, raw: content }, ctx, indexKey: 'p0-0' }) as unknown as Parameters<typeof TextNode>[0]
    const view = render(<TextNode {...props('你好')} />)
    expect(view.container.querySelector('.dsh-better-display__text-fade')).toBeNull()
    view.rerender(<TextNode {...props('你好，世界')} />)
    view.rerender(<TextNode {...props('你好，世界！')} />)
    const pieces = [...view.container.querySelectorAll('.dsh-better-display__text-fade')].map(span => span.textContent)
    expect(pieces).toEqual(['，世界', '！'])
    expect(view.container.textContent).toBe('你好，世界！')
    // A remount (its paragraph changed shape) continues without fading the whole run again.
    view.unmount()
    const again = render(<TextNode {...props('你好，世界！再见')} />)
    expect([...again.container.querySelectorAll('.dsh-better-display__text-fade')].map(span => span.textContent)).toEqual(['再见'])
  })

  it('shows settled text plainly', async () => {
    const now = vi.spyOn(performance, 'now')
    now.mockReturnValue(1000)
    const props = (content: string) => ({ node: { type: 'text' as const, content, raw: content }, ctx: {}, indexKey: 'k' }) as unknown as Parameters<typeof TextNode>[0]
    const view = render(<TextNode {...props('a')} />)
    view.rerender(<TextNode {...props('ab')} />)
    expect(view.container.querySelector('.dsh-better-display__text-fade')).not.toBeNull()
    now.mockReturnValue(2000)
    view.rerender(<TextNode {...props('ab')} />)
    expect(view.container.querySelector('.dsh-better-display__text-fade')).toBeNull()
    now.mockRestore()
  })
})

describe('draft preview', () => {
  it('previews only the draft\'s own words', () => {
    const draft = '问题 $x$\n> 引用\n 结尾'
    const occurrences = [{ occurrenceId: 1, source: QUOTE_SOURCE, ref: 'q', offset: 7, length: 6, label: '引用 1' }]
    expect(draftWords({ draft, occurrences })).toBe('问题 $x$\n结尾')
  })
})
