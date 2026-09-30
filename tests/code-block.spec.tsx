// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { removeCustomComponents } from 'markstream-react'
import { apply } from '../src/client/index.ts'
import { MarkstreamMarkdown, languageLabel } from '../src/client/renderer.tsx'

function mountPlugin() {
  const disposers: Array<() => void> = []
  apply({
    slots: { inject: vi.fn((_name: string, setup: () => unknown) => setup()), register: vi.fn(() => () => {}) },
    inject: vi.fn(),
    effect: vi.fn((setup: () => void | (() => void)) => {
      const dispose = setup()
      if (typeof dispose === 'function') disposers.push(dispose)
    }),
  } as never)
  return () => disposers.reverse().forEach(dispose => { dispose() })
}

afterEach(() => {
  cleanup()
  removeCustomComponents('dsh-better-display')
})

const CODE = 'int main(void) {\n  return 0;\n}'
const TEXT = `Example:\n\n\`\`\`cpp\n${CODE}\n\`\`\`\n`

const highlighted = (root: HTMLElement) => root.querySelector('.code-block-render pre [class^="smd-token"]') !== null

describe('ChatGPT-style code block', () => {
  it('labels languages', () => {
    expect(languageLabel('cpp')).toBe('C++')
    expect(languageLabel('ts title="a.ts"')).toBe('TypeScript')
    expect(languageLabel('zig')).toBe('Zig')
    expect(languageLabel('')).toBe('')
    expect(languageLabel('text')).toBe('')
  })

  it('renders its own header without Markstream font-size controls', async () => {
    const dispose = mountPlugin()
    const view = render(<MarkstreamMarkdown text={TEXT} streaming={false} />)
    const block = view.container.querySelector('.dsh-better-display__code')!
    expect(block).not.toBeNull()
    expect(block.querySelector('.dsh-better-display__code-lang')?.textContent).toBe('C++')
    expect(block.querySelector('.code-block-header')).toBeNull()
    expect(block.querySelectorAll('.code-action-btn')).toHaveLength(0)
    dispose()
  })

  it('expands again, highlighted, after collapsing', async () => {
    const dispose = mountPlugin()
    const view = render(<MarkstreamMarkdown text={TEXT} streaming={false} />)
    const block = view.container.querySelector<HTMLElement>('.dsh-better-display__code')!
    await waitFor(() => { expect(highlighted(block)).toBe(true) }, { timeout: 15000 })
    const toggle = block.querySelector<HTMLButtonElement>('[aria-expanded]')!
    await act(async () => { fireEvent.click(toggle) })
    expect(block.querySelector('.code-block-render')).toBeNull()
    expect(block.textContent).toMatch(/3/)
    await act(async () => { fireEvent.click(toggle) })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    await waitFor(() => { expect(highlighted(block)).toBe(true) }, { timeout: 15000 })
    expect(block.querySelector('.code-block-render')?.textContent).toContain('return 0;')
    dispose()
  }, 40000)

  it('copies the raw code', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const dispose = mountPlugin()
    const view = render(<MarkstreamMarkdown text={TEXT} streaming={false} />)
    const buttons = view.container.querySelectorAll<HTMLButtonElement>('.dsh-better-display__code-button')
    await act(async () => { fireEvent.click(buttons[buttons.length - 1]!) })
    expect(writeText).toHaveBeenCalledWith(CODE)
    dispose()
  })
})
