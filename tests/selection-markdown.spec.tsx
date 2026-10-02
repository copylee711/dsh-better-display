// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { removeCustomComponents } from 'markstream-react'
import { apply } from '../src/client/index.ts'
import { MarkstreamMarkdown } from '../src/client/renderer.tsx'
import { quotableRow, selectionToMarkdown } from '../src/client/selection-markdown.ts'

const REPLY = String.raw`有 **粗体** 和 $\frac{\mu_0}{4\pi}$ 行内。

$$
E=mc^2
$$

1. 第一 [1](https://a.com "A")
2. 第二

| a | b |
|---|---|
| 1 | $|y|$ |

` + '```py\nprint(1)\n```\n\n> 引用\n\n![埃菲尔铁塔](https://img.example/a.jpg)'

async function mount(text = REPLY) {
  const view = render(<div data-chat-flow-kind="assistant-step"><MarkstreamMarkdown text={text} streaming={false} /></div>)
  await new Promise(resolve => setTimeout(resolve, 600))
  return view.container.querySelector('[data-chat-flow-kind]')!
}

beforeEach(() => {
  apply({ slots: { inject: (_name: string, setup: () => unknown) => setup(), register: () => () => {} }, inject: vi.fn(), effect: (setup: () => unknown) => setup() } as never)
})

afterEach(() => {
  cleanup()
  removeCustomComponents('dsh-better-display')
})

describe('selectionToMarkdown', () => {
  it('rebuilds Markdown, TeX and pictures from a rendered reply', async () => {
    const row = await mount()
    const range = document.createRange()
    range.selectNodeContents(row)
    expect(quotableRow(range)).toBe(row)
    const quote = selectionToMarkdown(range)
    expect(quote.markdown).toBe([
      String.raw`有 **粗体** 和 $\frac{\mu_0}{4\pi}$ 行内。`,
      '',
      '$$\nE=mc^2\n$$',
      '',
      '1. 第一 [1](https://a.com)\n2. 第二',
      '',
      // The renderer already wrote the table cell's |y| as \vert (see dollars.ts).
      '| a | b |\n| --- | --- |\n' + String.raw`| 1 | $\vert y\vert$ |`,
      '',
      '```python\nprint(1)\n```',
      '',
      '> 引用',
      '',
      // The caption was selected too: quoted as text under the picture, not repeated as alt.
      '![](https://img.example/a.jpg)',
      '',
      '埃菲尔铁塔',
    ].join('\n'))
    expect(quote.images).toEqual([{ src: 'https://img.example/a.jpg', alt: '埃菲尔铁塔' }])
  })

  it('takes a formula whole when the selection starts or ends inside it', async () => {
    const row = await mount(String.raw`前文 $\frac{a}{b}$ 后文`)
    const glyphs = row.querySelector('.katex-html')!
    const range = document.createRange()
    range.setStart(glyphs.firstChild!, 0)
    const tail = [...row.querySelectorAll('.text-node')].at(-1)!.firstChild!
    range.setEnd(tail, 3)
    expect(selectionToMarkdown(range).markdown).toBe(String.raw`$\frac{a}{b}$ 后文`)
  })

  it('keeps a block formula a block when the selection lies inside it', async () => {
    const row = await mount('前文\n\n$$\nB=\\frac{\\mu_0 I}{2\\pi a}\n$$\n\n后文')
    const glyphs = row.querySelector('.katex-display .katex-html')!
    const range = document.createRange()
    range.selectNodeContents(glyphs)
    expect(selectionToMarkdown(range).markdown).toBe('$$\nB=\\frac{\\mu_0 I}{2\\pi a}\n$$')
  })

  it('quotes just the selected part of a formula', async () => {
    const row = await mount('前文\n\n$$\nd\\Phi=\\mathbf E\\cdot d\\mathbf A=E\\,dA\\cos\\theta\n$$\n\n后文')
    const atoms = [...row.querySelectorAll('.katex-display .katex-html > .katex-base > *')].filter(atom => !atom.classList.contains('katex-strut') && !atom.classList.contains('mspace'))
    const range = document.createRange()
    range.setStart(atoms[0]!, 0)
    range.setEnd(atoms[3]!, atoms[3]!.childNodes.length)
    expect(selectionToMarkdown(range).markdown).toBe('$$\nd\\Phi=\\mathbf{E}\n$$')
    // The page keeps no trace of the cut.
    expect(row.querySelector('[data-better-display-part-tex]')).toBeNull()
  })

  it('quotes a picture with the part of its caption that is selected', async () => {
    const row = await mount('![滑冰者收臂加速](https://img.example/s.png)')
    const image = row.querySelector('img')!
    const caption = row.querySelector('.dsh-better-display__caption')!
    const range = document.createRange()
    range.setStartBefore(image)
    range.setEnd(caption.firstChild!, 3)
    const quote = selectionToMarkdown(range)
    expect(quote.markdown).toBe('![](https://img.example/s.png)\n\n滑冰者')
    expect(quote.images).toEqual([{ src: 'https://img.example/s.png', alt: '滑冰者收臂加速' }])
    // The picture alone keeps its caption as alt text.
    range.setEndAfter(image)
    expect(selectionToMarkdown(range).markdown).toBe('![滑冰者收臂加速](https://img.example/s.png)')
  })

  it('refuses selections outside one message row', async () => {
    const row = await mount('段落')
    const outside = document.createElement('p')
    outside.textContent = 'outside'
    document.body.append(outside)
    const range = document.createRange()
    range.setStart(row, 0)
    range.setEnd(outside, 1)
    expect(quotableRow(range)).toBeNull()
    outside.remove()
  })
})
