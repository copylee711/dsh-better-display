import { describe, expect, it, vi } from 'vitest'
import { Config, DEFAULTS, apply, promptText, resolveConfig, withEmbedHint } from '../src/index.ts'

/** Volatile references as the DSH Loader hands them to `apply`. */
function liveConfig(initial: Partial<typeof DEFAULTS> = {}) {
  const values: Record<string, unknown> = { ...DEFAULTS, ...initial }
  const refs = Object.fromEntries(Object.keys(values).map(key => [key, { get: () => values[key] }]))
  return { refs, values }
}

function mountHost(config: unknown) {
  const disposers: Array<() => void> = []
  const listeners: Record<string, Array<(...args: never[]) => unknown>> = {}
  const section = vi.fn(() => vi.fn())
  const scoped = {
    systemPrompt: { section },
    effect: vi.fn((setup: () => void | (() => void)) => {
      const result = setup()
      if (typeof result === 'function') disposers.push(result)
    }),
    on: vi.fn((event: string, listener: (...args: never[]) => unknown) => { (listeners[event] ??= []).push(listener) }),
  }
  // Like Cordis: a callback runs only when every service it asks for exists.
  const services: Record<string, unknown> = { systemPrompt: scoped.systemPrompt, settings: {}, tools: {} }
  const ctx = { inject: vi.fn((deps: string[], callback: (value: unknown) => void) => { if (deps.every(dep => dep in services)) callback(scoped) }) }
  apply(ctx as never, config)
  const emit = (ns: string) => listeners['settings/document-updated']?.forEach(listener => { (listener as (ns: unknown) => void)(ns) })
  return { ctx, section, emit, listeners, unload: () => disposers.forEach(fn => { fn() }) }
}

describe('host prompt section', () => {
  it('declares a schema DSH can turn into a settings form', () => {
    expect(resolveConfig(Config({}))).toEqual({ citations: true, inlineImages: true, imageCount: 'auto', maxImages: 8, sectionOrder: 600, selectionTools: true, userMarkdown: true })
    expect(() => Config({ maxImages: 50 })).toThrow()
    expect(() => Config({ imageCount: 'many' } as never)).toThrow()
  })

  it('unwraps volatile references and repairs invalid values', () => {
    expect(resolveConfig(liveConfig({ maxImages: 12 }).refs).maxImages).toBe(12)
    expect(resolveConfig({ maxImages: 99, imageCount: 'x', citations: 'yes' })).toEqual({ ...DEFAULTS, maxImages: 20 })
    expect(resolveConfig(undefined)).toEqual(DEFAULTS)
  })

  it('lets the model decide the picture count in auto mode and caps it in limit mode', () => {
    const auto = promptText(DEFAULTS)
    expect(auto).toContain('[1](https://')
    expect(auto).toContain('decide how many to embed')
    expect(auto).not.toContain('at most')
    const limit = promptText({ ...DEFAULTS, imageCount: 'limit', maxImages: 12 })
    expect(limit).toContain('at most 12')
    expect(promptText({ ...DEFAULTS, inlineImages: false })).not.toContain('Illustrating answers')
    expect(promptText({ ...DEFAULTS, citations: false })).not.toContain('Citing web sources')
    expect(promptText({ ...DEFAULTS, citations: false, inlineImages: false })).toBe('')
  })

  it('teaches the model to embed dsh-image-gen pictures by job reference', () => {
    const text = promptText(DEFAULTS)
    expect(text).toContain('### Generated images')
    expect(text).toContain('](genimg:<id>)')
    expect(text).toContain('background: true')
    expect(promptText({ ...DEFAULTS, inlineImages: false })).not.toContain('genimg:')
  })

  it('registers the section and re-renders it when the settings page changes our entry', () => {
    const { refs, values } = liveConfig()
    const host = mountHost(refs)
    expect(host.section).toHaveBeenCalledTimes(1)
    expect(host.section).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'better-display:rich-answer', order: 600 }))
    const firstDispose = host.section.mock.results[0]?.value as ReturnType<typeof vi.fn>

    values.imageCount = 'limit'
    values.maxImages = 12
    host.emit('web-search-free')
    expect(host.section).toHaveBeenCalledTimes(1)
    host.emit('better-display')
    expect(firstDispose).toHaveBeenCalled()
    expect(host.section).toHaveBeenCalledTimes(2)
    expect((host.section.mock.calls[1] as unknown as [{ text: string }])[0].text).toContain('at most 12')

    host.emit('better-display')
    expect(host.section).toHaveBeenCalledTimes(2)

    values.citations = false
    values.inlineImages = false
    host.emit('better-display')
    expect(host.section).toHaveBeenCalledTimes(2)
    const secondDispose = host.section.mock.results[1]?.value as ReturnType<typeof vi.fn>
    expect(secondDispose).toHaveBeenCalled()

    values.citations = true
    host.emit('better-display')
    expect(host.section).toHaveBeenCalledTimes(3)
    host.unload()
    expect((host.section.mock.results[2]?.value as ReturnType<typeof vi.fn>)).toHaveBeenCalled()
  })

  it('accepts plain (non-volatile) config from older hosts', () => {
    const host = mountHost({ citations: true, inlineImages: true, maxImages: 3 })
    expect((host.section.mock.calls[0] as unknown as [{ text: string }])[0].text).toContain('decide how many')
  })
})

describe('dsh-image-gen results', () => {
  const JOB = '0f8c2a4e-1b2c-4d3e-8f90-123456789abc'
  const result = { isError: false, content: [{ type: 'text', text: `Generated one image. Inline image reference: genimg:${JOB}.` }, { type: 'image' }] }

  it('appends the embed instruction to generated-image results only', () => {
    const decision = withEmbedHint({ name: 'paint_image' }, result, { kind: 'accept' })
    const hint = decision.content?.at(-1)
    expect(decision.content).toHaveLength(3)
    expect(hint?.text).toContain(`![<short caption>](genimg:${JOB})`)
    expect(withEmbedHint({ name: 'web_search' }, result, { kind: 'accept' })).toEqual({ kind: 'accept' })
    expect(withEmbedHint({ name: 'paint_image' }, { ...result, isError: true }, { kind: 'accept' })).toEqual({ kind: 'accept' })
    expect(withEmbedHint({ name: 'paint_image' }, { isError: false, content: [{ type: 'text', text: 'no reference' }] }, { kind: 'accept' })).toEqual({ kind: 'accept' })
    const blocked = { kind: 'block', content: [] }
    expect(withEmbedHint({ name: 'paint_image' }, result, blocked)).toBe(blocked)
  })

  it('hooks tools/post-execute and follows the inline images switch', async () => {
    const { refs, values } = liveConfig()
    const host = mountHost(refs)
    const listener = host.listeners['tools/post-execute']?.[0] as unknown as (exec: unknown, result: unknown, next: () => Promise<unknown>) => Promise<{ content?: unknown[] }>
    expect((await listener({ name: 'paint_images' }, result, async () => ({ kind: 'accept' }))).content).toHaveLength(3)
    values.inlineImages = false
    expect(await listener({ name: 'paint_images' }, result, async () => ({ kind: 'accept' }))).toEqual({ kind: 'accept' })
  })
})
