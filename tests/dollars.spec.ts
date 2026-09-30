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
