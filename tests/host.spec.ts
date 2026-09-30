import { describe, expect, it, vi } from 'vitest'
import { Config, apply, promptText } from '../src/index.ts'

/** Resolve defaults through the schema, as Cordis does before `apply`. */
function config(input: Partial<Config> = {}): Config {
  return Config(input as Config)
}

function mountHost(config: Config) {
  const dispose = vi.fn()
  const section = vi.fn(() => dispose)
  const disposers: Array<() => void> = []
  const sctx = {
    systemPrompt: { section },
    effect: vi.fn((setup: () => void | (() => void)) => {
      const result = setup()
      if (typeof result === 'function') disposers.push(result)
    }),
  }
  const ctx = { inject: vi.fn((_deps: string[], callback: (value: unknown) => void) => { callback(sctx) }) }
  apply(ctx as never, config)
  return { ctx, section, dispose, unload: () => disposers.forEach(fn => { fn() }) }
}

describe('host prompt section', () => {
  it('registers the rich-answer section and disposes it on unload', () => {
    const host = mountHost(config())
    expect(host.ctx.inject).toHaveBeenCalledWith(['systemPrompt'], expect.any(Function))
    expect(host.section).toHaveBeenCalledWith(expect.objectContaining({ name: 'better-display:rich-answer', order: 600 }))
    host.unload()
    expect(host.dispose).toHaveBeenCalled()
  })

  it('follows the config toggles', () => {
    const all = promptText(config({ maxImages: 3 }))
    expect(all).toContain('[1](https://')
    expect(all).toContain('at most 3')
    expect(promptText(config({ inlineImages: false }))).not.toContain('Illustrating answers')
    expect(promptText(config({ citations: false }))).not.toContain('Citing web sources')
    expect(promptText(config({ citations: false, inlineImages: false }))).toBe('')
    const host = mountHost(config({ citations: false, inlineImages: false }))
    expect(host.ctx.inject).not.toHaveBeenCalled()
  })
})
