// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { removeCustomComponents } from 'markstream-react'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import { forwardRef, memo } from 'react'
import { apply } from '../src/client/index.ts'
import { QuoteStore } from '../src/client/quotes.ts'
import { createAttachmentRail } from '../src/client/selection-ui.tsx'
import { isSlotComponent, registerShadow, shadowedComponent } from '../src/client/slot-components.ts'

afterEach(() => {
  cleanup()
  removeCustomComponents('dsh-better-display')
})

function pluginWith(entries: Array<{ component: unknown, options: { priority?: number, key?: string } }>) {
  const registrations: Array<{ name: string, key?: string, component: unknown }> = []
  const disposers: Array<() => void> = []
  const slots = {
    entries: () => entries,
    inject: (_name: string, setup: () => () => void) => { disposers.push(setup()) },
    register: (options: { name: string, key?: string }, component: unknown) => {
      registrations.push({ ...options, component })
      return () => {}
    },
  }
  apply({ slots, inject: vi.fn(), effect: (setup: () => () => void) => { disposers.push(setup()) } } as never)
  return { registrations, dispose: () => disposers.reverse().forEach(dispose => dispose()) }
}

describe('optional native slot delegation (issue #1)', () => {
  it.each([undefined, null, {}, 'div'])('does not take over a rail with an invalid native component: %s', component => {
    const plugin = pluginWith([{ component, options: {} }])
    try {
      expect(plugin.registrations.some(entry => entry.name === 'conversation.input.attachments')).toBe(false)
    } finally { plugin.dispose() }
  })

  it('leaves absent native rails and user cells untouched', () => {
    const plugin = pluginWith([])
    try {
      expect(plugin.registrations.some(entry => entry.name === 'conversation.input.attachments')).toBe(false)
      expect(plugin.registrations.filter(entry => entry.name === 'conversation.chat.node').map(entry => entry.key)).toEqual(['assistant-step'])
    } finally { plugin.dispose() }
  })

  it('does not throw while a native rail is unavailable', () => {
    const Rail = createAttachmentRail(new QuoteStore(undefined), () => undefined)
    expect(render(<Rail attachments={[]} />).container.childElementCount).toBe(0)
  })

  it('ignores higher-ranked wrappers instead of delegating back into them', () => {
    const foreign = vi.fn(() => { throw new Error('recursive foreign wrapper') })
    const native = vi.fn(({ attachments }: { attachments: Array<{ id: string }> }) => <span>{attachments.map(item => item.id).join(',')}</span>)
    const plugin = pluginWith([
      { component: foreign, options: { priority: -200 } },
      { component: native, options: { priority: 0 } },
    ])
    try {
      const Rail = plugin.registrations.find(entry => entry.name === 'conversation.input.attachments')!.component as ReturnType<typeof createAttachmentRail>
      expect(render(<Rail attachments={[{ id: 'file' }]} />).container.textContent).toBe('file')
      expect(foreign).not.toHaveBeenCalled()
    } finally { plugin.dispose() }
  })

  it('accepts memo and forwardRef native components without treating them as undefined', () => {
    for (const Native of [memo(() => <span>memo</span>), forwardRef<HTMLSpanElement, { attachments: readonly { id: string }[] }>(() => <span>ref</span>)]) {
      expect(isSlotComponent(Native)).toBe(true)
      const Rail = createAttachmentRail(new QuoteStore(undefined), () => Native)
      const view = render(<Rail attachments={[]} />)
      expect(view.container.textContent).toMatch(/memo|ref/)
      view.unmount()
    }
  })

  it.each(['inject', 'store', 'children'])('does not strip native %s seats by nesting an unbound component', seat => {
    expect(shadowedComponent([{ component: () => null, options: {}, [seat]: {} }], -110)).toBeUndefined()
  })

  it('follows late native registration, withdrawal, remount and disposal using the real slot core', async () => {
    const core = new SlotCore()
    const name = 'test.attachment-rail'
    core.register({ name: 'root', children: { [name]: { kind: 'single', scope: 'root' } } } as never, (() => null) as never)
    const Wrapper = () => null
    const Native = () => null
    const dispose = registerShadow(core as never, { name, priority: -110, locale: 'conversation' }, Wrapper)
    expect(core.entries(name)).toHaveLength(0)
    const removeNative = core.register({ name } as never, Native as never)
    await Promise.resolve()
    expect(core.entries(name).map(entry => entry.component)).toEqual([Wrapper, Native])
    removeNative()
    await Promise.resolve()
    expect(core.entries(name)).toHaveLength(0)
    core.register({ name } as never, Native as never)
    await Promise.resolve()
    expect(core.entries(name).map(entry => entry.component)).toEqual([Wrapper, Native])
    dispose()
    await Promise.resolve()
    expect(core.entries(name).map(entry => entry.component)).toEqual([Native])
    // Disposal is idempotent and a queued mutation cannot revive the wrapper.
    dispose()
    await Promise.resolve()
    expect(core.entries(name).map(entry => entry.component)).toEqual([Native])
  })
})
