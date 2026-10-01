// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { normalizeListIndent as fix } from '../src/client/list-indent.ts'
import { MarkstreamMarkdown } from '../src/client/renderer.tsx'

const REPLY = String.raw`## 四、四个必背结论

1. **无限长直导线**（距导线 $a$）：
 $$B=\frac{\mu_0 I}{2\pi a}$$
 推导思路：由 $\sin\theta$ 积分得到。
2. **有限长直导线**（垂直距离 $a$）：
 $$B=\frac{\mu_0 I}{4\pi a}$$
3. **圆环轴线**（半径 $R$）`

afterEach(() => { cleanup() })

describe('normalizeListIndent', () => {
  it('moves one-space item bodies to the content column', () => {
    expect(fix(REPLY).split('\n').slice(2, 9)).toEqual([
      '1. **无限长直导线**（距导线 $a$）：',
      String.raw`   $$B=\frac{\mu_0 I}{2\pi a}$$`,
      '   推导思路：由 $\\sin\\theta$ 积分得到。',
      '2. **有限长直导线**（垂直距离 $a$）：',
      String.raw`   $$B=\frac{\mu_0 I}{4\pi a}$$`,
      '3. **圆环轴线**（半径 $R$）',
    ])
  })

  it('leaves well-formed Markdown, unindented text and non-list text alone', () => {
    const good = '- a\n  body\n- b\n\n   indented paragraph outside a list'
    expect(fix(good)).toBe(good)
    expect(fix('1. a\nlazy continuation\n text after')).toBe('1. a\nlazy continuation\n text after')
    expect(fix(' just indented\n text')).toBe(' just indented\n text')
  })

  it('keeps nested items and moves fenced code with its fence', () => {
    expect(fix('- a\n  - b\n   body of a')).toBe('- a\n  - b\n   body of a')
    expect(fix('- a\n  - b\n body')).toBe('- a\n  - b\n    body')
    expect(fix('1. a\n ```js\n x()\n ```\n2. b')).toBe('1. a\n   ```js\n   x()\n   ```\n2. b')
  })

  it('only changes line prefixes, so streamed prefixes stay prefixes', () => {
    const full = fix(REPLY)
    for (let cut = 1; cut < REPLY.length; cut += 7) {
      const partial = fix(REPLY.slice(0, cut))
      const lines = partial.split('\n')
      const done = lines.slice(0, -1).join('\n')
      expect(full.startsWith(done)).toBe(true)
    }
  })
})

describe('rendering', () => {
  it('renders the three items as one ordered list', async () => {
    const view = render(<MarkstreamMarkdown text={REPLY} streaming={false} />)
    await new Promise(resolve => setTimeout(resolve, 200))
    const lists = view.container.querySelectorAll('ol')
    expect(lists).toHaveLength(1)
    expect(lists[0]?.querySelectorAll(':scope > li')).toHaveLength(3)
    expect(lists[0]?.textContent).toContain('推导思路')
  })
})
