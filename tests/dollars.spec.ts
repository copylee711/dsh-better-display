import { describe, expect, it } from 'vitest'
import { escapeCurrencyDollars as esc } from '../src/client/dollars.ts'

describe('escapeCurrencyDollars', () => {
  it('escapes prices', () => {
    expect(esc('$2 / $10 每百万 token')).toBe('\\$2 / \\$10 每百万 token')
    expect(esc('$2/$10')).toBe('\\$2/\\$10')
    expect(esc('**$0.10**（Astra $1.00，GPT-6 Sol $0.20）')).toBe('**\\$0.10**（Astra \\$1.00，GPT-6 Sol \\$0.20）')
    expect(esc('（$0.10 / $0.50）就够')).toBe('（\\$0.10 / \\$0.50）就够')
    expect(esc('$0.65/任务')).toBe('\\$0.65/任务')
    expect(esc('| 输入 | $2 / $10 | Astra 是 $10 / $50 |')).toBe('| 输入 | \\$2 / \\$10 | Astra 是 \\$10 / \\$50 |')
  })

  it('keeps math', () => {
    for (const s of ['$\\mu_0$', '$r^2$', '磁导率 $10^{-7}$ 很小', '$a$ 和 $b$', '$x$.']) expect(esc(s)).toBe(s)
    expect(esc('$$E=mc^2$$')).toBe('$$E=mc^2$$')
    expect(esc('$$\n\\int_0^1 x\\,dx\n$$')).toBe('$$\n\\int_0^1 x\\,dx\n$$')
  })

  it('leaves code and escapes alone', () => {
    expect(esc('run `echo $HOME` now')).toBe('run `echo $HOME` now')
    expect(esc('```sh\necho $HOME $2\n```')).toBe('```sh\necho $HOME $2\n```')
    expect(esc('already \\$5')).toBe('already \\$5')
  })

  it('does not pair across lines', () => {
    expect(esc('costs $5\n\nand x$')).toBe('costs \\$5\n\nand x\\$')
  })
})

describe('Markdown escapes inside math', () => {
  it('turns \\* back into * in inline and display math', () => {
    expect(esc('若最优点 $x^\\*$ 处')).toBe('若最优点 $x^*$ 处')
    expect(esc('$$\\nabla f(x^\\*) = 0$$')).toBe('$$\\nabla f(x^*) = 0$$')
    expect(esc('$$\nL(x^\\*,\\lambda^\\*)\n$$')).toBe('$$\nL(x^*,\\lambda^*)\n$$')
  })
  it('leaves \\* outside math and TeX line breaks alone', () => {
    expect(esc('a \\* b')).toBe('a \\* b')
    expect(esc('$$a \\\\* b$$')).toBe('$$a \\\\* b$$')
  })
})

describe('streaming', () => {
  it('only ever appends while a reply streams in', async () => {
    const { default: answer } = await import('./fixtures/lagrange.md?raw')
    const text = `${answer}\n\n价格 $2 / $10，缓存 **$0.10**（Astra $1.00），代码 \`echo $HOME\` 与 $x^\\*$。\n`
    for (const step of [1, 7, 40]) {
      let shown = ''
      for (let end = step; end < text.length; end += step) {
        const next = esc(text.slice(0, end), true)
        expect(next.startsWith(shown), `step ${step} at ${end}`).toBe(true)
        shown = next
      }
      expect(esc(text).startsWith(shown)).toBe(true)
    }
  })
})
