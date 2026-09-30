// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { removeCustomComponents } from 'markstream-react'
import { apply } from '../src/client/index.ts'
import { MarkstreamMarkdown } from '../src/client/renderer.tsx'
import answer from './fixtures/linked-list.md?raw'

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

/** Code blocks whose fence names a language but whose <pre> has no Shiki tokens. */
function unhighlighted(container: HTMLElement): string[] {
  return [...container.querySelectorAll('.code-block-render pre')]
    .filter(pre => pre.querySelector('[class^="smd-token"]') === null)
    .map(pre => (pre.textContent ?? '').slice(0, 30))
}

describe('code highlighting after streaming', () => {
  it('highlights every C block once a streamed reply settles', async () => {
    const dispose = mountPlugin()
    const view = render(<MarkstreamMarkdown text="" streaming />)
    for (let end = 0; end < answer.length; end += 180) {
      await act(async () => {
        view.rerender(<MarkstreamMarkdown text={answer.slice(0, end)} streaming />)
        await new Promise(resolve => setTimeout(resolve, 5))
      })
    }
    await act(async () => { view.rerender(<MarkstreamMarkdown text={answer} streaming={false} />) })
    // the one unlabelled ASCII diagram block is plain text by design
    await waitFor(() => { expect(unhighlighted(view.container).filter(text => !text.includes('头指针'))).toEqual([]) }, { timeout: 15000 })
    dispose()
  }, 60000)
})
