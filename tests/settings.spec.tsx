// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.ts'
import { DisplaySettings, ROW_CONFIG_KEY, readValues, zh } from '../src/client/settings.tsx'
import type { ConfigPageForm } from '../src/client/settings.tsx'

const t = (key: keyof typeof zh) => zh[key]

function form(value: Record<string, unknown>, writable = true) {
  const mutate = vi.fn(async () => true)
  const page: ConfigPageForm = { state: { status: 'ready', value, revision: 3, writable }, mutate }
  return { page, mutate }
}

afterEach(() => { cleanup() })

describe('settings page', () => {
  it('registers a row configure page with its dictionaries when the locale service is present', () => {
    const register = vi.fn(() => () => {})
    const localeRegister = vi.fn(() => () => {})
    const slots = { inject: vi.fn((_name: string, setup: () => unknown) => setup()), register }
    const ctx = {
      slots,
      effect: vi.fn((setup: () => unknown) => { setup() }),
      // Like Cordis: a callback runs only when every service it asks for exists.
      inject: vi.fn((deps: string[], callback: (value: unknown) => void) => {
        const scoped = { slots, locale: { register: localeRegister }, effect: (setup: () => unknown) => { setup() } }
        if (deps.every(dep => dep in scoped)) callback(scoped)
      }),
    }
    apply(ctx as never)
    expect(ctx.inject).toHaveBeenCalledWith(['locale'], expect.any(Function))
    expect(localeRegister).toHaveBeenCalledWith('betterDisplay', expect.objectContaining({ zh: expect.any(Object), en: expect.any(Object) }))
    expect(register).toHaveBeenCalledWith(expect.objectContaining({ name: 'plugins.row.config', key: ROW_CONFIG_KEY, locale: 'betterDisplay' }), DisplaySettings)
    expect(ROW_CONFIG_KEY).toBe('@copylee/dsh-better-display#better-display')
  })

  it('shows a one-liner in summary view', () => {
    const view = render(<DisplaySettings view="summary" t={t} />)
    expect(view.container.textContent).toBe(zh.summary)
  })

  it('writes each change to the host config with the read revision', async () => {
    const { page, mutate } = form({ citations: true, inlineImages: true, imageCount: 'auto', maxImages: 8 })
    render(<DisplaySettings view="page" form={page} t={t} />)
    const maxInput = screen.getByLabelText(zh.maxImages) as HTMLInputElement
    expect(maxInput.disabled).toBe(true)
    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: zh.citations })) })
    expect(mutate).toHaveBeenLastCalledWith([{ op: 'set', path: ['citations'], value: false }], 3)
    await act(async () => { fireEvent.click(screen.getByText(zh.imageCountLimit)) })
    expect(mutate).toHaveBeenLastCalledWith([{ op: 'set', path: ['imageCount'], value: 'limit' }], 3)
    expect(maxInput.disabled).toBe(false)
    fireEvent.change(maxInput, { target: { value: '30' } })
    await act(async () => { fireEvent.blur(maxInput) })
    expect(mutate).toHaveBeenLastCalledWith([{ op: 'set', path: ['maxImages'], value: 20 }], 3)
    expect(screen.getByText(zh.saved)).toBeTruthy()
  })

  it('is read-only when the deployment does not accept writes, and unavailable without a form', () => {
    const { page } = form({}, false)
    const view = render(<DisplaySettings view="page" form={page} t={t} />)
    expect(screen.getByText(zh.readOnly)).toBeTruthy()
    expect((screen.getByRole('switch', { name: zh.citations }) as HTMLButtonElement).disabled).toBe(true)
    view.rerender(<DisplaySettings view="page" t={t} />)
    expect(screen.getByText(zh.unavailable)).toBeTruthy()
  })

  it('fills defaults for unset values', () => {
    expect(readValues(undefined)).toEqual({ citations: true, inlineImages: true, imageCount: 'auto', maxImages: 8, selectionTools: true })
    expect(readValues({ maxImages: 99, imageCount: 'x' })).toMatchObject({ maxImages: 20, imageCount: 'auto' })
  })
})
