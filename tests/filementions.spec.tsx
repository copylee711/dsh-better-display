// @vitest-environment jsdom

import { render } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { removeCustomComponents } from 'markstream-react'
import { apply } from '../src/client/index.ts'
import { BetterAssistantNodeView } from '../src/client/renderer.tsx'

/** Slot entry the plugin registered for `assistant-step`, as the host received it. */
interface RegisteredEntry {
  name: string
  key?: string
  inject?: (sessionId: string) => Record<string, unknown>
}

function mountPlugin(services: Record<string, unknown> = {}) {
  const entries: RegisteredEntry[] = []
  const register = vi.fn((entry: RegisteredEntry) => {
    entries.push(entry)
    return () => {}
  })
  const ctx = {
    slots: { inject: vi.fn((_name: string, setup: () => unknown) => setup()), register },
    get: vi.fn((name: string) => services[name]),
    inject: vi.fn(),
    effect: vi.fn(),
  }
  apply(ctx as never)
  return { register, entries, ctx }
}

const t = vi.fn((key: string) => key)

/**
 * A settled final step whose turn already closed: the one state where the view builds the owner and
 * calls `fileMentions` at all. `finalNode.seq` must match the turn tail for the owner to exist.
 */
function nodeProps(extra: Record<string, unknown> = {}) {
  const turn = { status: 'closed' }
  return {
    node: {
      data: { blocks: [{ kind: 'text', text: 'Tall [1](https://a.com "A")' }], status: 'settled', step: 2, finalNode: { seq: 7 } },
      location: { kind: 'step', turn },
    },
    useTurnData: (key: string) => key === 'turn-tail' ? { closing: { finalNode: { seq: 7 } } } : undefined,
    openFile: vi.fn(),
    renderMessageImages: vi.fn(() => null),
    t,
    ...extra,
  } as unknown as ComponentProps<typeof BetterAssistantNodeView>
}

afterEach(() => {
  removeCustomComponents('dsh-better-display')
})

describe('fileMentions delivered through the entry inject face (DSH 0.2.2+)', () => {
  it('registers an inject face that resolves mentions through chatFileMentions', () => {
    const forClosing = vi.fn((_owner: unknown, _sessionId: string) => ({ resolve: () => undefined }))
    const plugin = mountPlugin({ chatFileMentions: { forClosing } })
    const entry = plugin.entries.find(value => value.key === 'assistant-step')
    expect(entry?.inject).toBeTypeOf('function')
    const injected = entry?.inject?.('session-1') as { fileMentions?: (owner: unknown) => unknown }
    expect(injected.fileMentions).toBeTypeOf('function')
    const owner = { seq: 1 }
    injected.fileMentions?.(owner)
    expect(forClosing).toHaveBeenCalledWith(owner, 'session-1', undefined)
  })

  it('tolerates a host without the chatFileMentions service', () => {
    const plugin = mountPlugin()
    const entry = plugin.entries.find(value => value.key === 'assistant-step')
    const injected = entry?.inject?.('session-1') as { fileMentions?: (owner: unknown) => unknown }
    expect(injected.fileMentions?.({ seq: 1 })).toBeUndefined()
  })

  it('renders the reply instead of throwing when fileMentions is missing', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const view = render(<BetterAssistantNodeView {...nodeProps()} />)
    expect(view.container.textContent).toContain('Tall')
    expect(view.container.querySelector('.dsh-better-display__markdown')).not.toBeNull()
    expect(view.container.querySelector('.dsh-better-display__sources')).not.toBeNull()
    expect(consoleError).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('still resolves mentions when the host provides fileMentions', () => {
    const resolve = vi.fn(() => undefined)
    const fileMentions = vi.fn(() => ({ resolve }))
    render(<BetterAssistantNodeView {...nodeProps({ fileMentions })} />)
    expect(fileMentions).toHaveBeenCalledTimes(1)
  })
})
