// @vitest-environment jsdom

import { fireEvent, render } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { removeCustomComponents } from 'markstream-react'
import { apply } from '../src/client/index.ts'
import { BetterAssistantNodeView, MarkstreamMarkdown } from '../src/client/renderer.tsx'
import { WorkspaceProvider, localPath, resolveWorkspacePath, workspaceFileUrl } from '../src/client/workspace.ts'

function mountPlugin() {
  const register = vi.fn(() => () => {})
  const disposers: Array<() => void> = []
  const ctx = {
    slots: { inject: vi.fn((_name: string, setup: () => unknown) => setup()), register },
    inject: vi.fn(),
    effect: vi.fn((setup: () => void | (() => void)) => {
      const dispose = setup()
      if (typeof dispose === 'function') disposers.push(dispose)
    }),
  }
  apply(ctx as never)
  return { register, dispose: () => disposers.reverse().forEach(dispose => { dispose() }) }
}

const t = vi.fn((key: string) => key)

function nodeProps(blocks: unknown[], extra: Record<string, unknown> = {}) {
  return {
    node: {
      data: { blocks, status: 'settled', step: 2 },
      location: { kind: 'step', turn: { status: 'closed' } },
    },
    useTurnData: () => undefined,
    openFile: vi.fn(),
    fileMentions: () => undefined,
    renderMessageImages: vi.fn(() => <span data-testid="gallery" />),
    t,
    ...extra,
  } as unknown as ComponentProps<typeof BetterAssistantNodeView>
}

afterEach(() => {
  removeCustomComponents('dsh-better-display')
})

describe('DSH 0.2 assistant-step contract', () => {
  it('registers under the chat locale namespace', () => {
    const plugin = mountPlugin()
    expect(plugin.register).toHaveBeenCalledWith(expect.objectContaining({ locale: 'chat', priority: -110 }), expect.anything())
    plugin.dispose()
  })

  it('renders reasoning + text with the real 0.2 primitives without throwing', () => {
    const plugin = mountPlugin()
    const view = render(
      <BetterAssistantNodeView {...nodeProps([
        { kind: 'reasoning', text: 'thinking about towers' },
        { kind: 'text', text: 'Tall [1](https://a.com "A")' },
        { kind: 'image', attachment: { id: 'x' } },
      ])}
      />,
    )
    expect(view.container.querySelector('.dsh-better-display__reasoning')).not.toBeNull()
    expect(view.container.querySelector('.dsh-better-display__cite-chip')).not.toBeNull()
    expect(view.getByTestId('gallery')).toBeTruthy()
    expect(view.container.querySelector('.dsh-better-display__sources')).not.toBeNull()
    plugin.dispose()
  })

  it('hides inline reasoning while the Turn-process disclosure is folded', () => {
    const plugin = mountPlugin()
    const turnProcess = { foldable: true, open: false, spec: { answerStep: 2, inlineReasoning: true }, setOpen: vi.fn() }
    const view = render(<BetterAssistantNodeView {...nodeProps([{ kind: 'reasoning', text: 'x' }, { kind: 'text', text: 'answer' }], { turnProcess })} />)
    const wrapper = view.container.querySelector('[data-turn-process-inline]')
    expect(wrapper?.hasAttribute('hidden')).toBe(true)
    plugin.dispose()
  })

  it('splits reasoning and response by groupPart', () => {
    const plugin = mountPlugin()
    const blocks = [{ kind: 'reasoning', text: 'why' }, { kind: 'text', text: 'final answer' }]
    const reasoning = render(<BetterAssistantNodeView {...nodeProps(blocks, { groupPart: 'reasoning' })} />)
    expect(reasoning.container.querySelector('.dsh-better-display__reasoning')).not.toBeNull()
    expect(reasoning.container.textContent).not.toContain('final answer')
    reasoning.unmount()
    const response = render(<BetterAssistantNodeView {...nodeProps(blocks, { groupPart: 'response' })} />)
    expect(response.container.querySelector('.dsh-better-display__reasoning')).toBeNull()
    expect(response.container.textContent).toContain('final answer')
    plugin.dispose()
  })

  it('resolves workspace image paths through the DSH file API like the built-in renderer', () => {
    const plugin = mountPlugin()
    const openFile = vi.fn()
    const view = render(
      <WorkspaceProvider value={{ cwd: 'D:\\AI\\ws', openFile }}>
        <MarkstreamMarkdown
          text={'![手机 背面](<images/phone design/a.webp> "来源 · 版权") ![b](images/b.jpg)\n\nSee [notes](docs/notes.md) and fact [1](https://a.com "A")'}
          streaming={false}
        />
      </WorkspaceProvider>,
    )
    const images = view.container.querySelectorAll('.dsh-better-display__figure img')
    expect(images).toHaveLength(2)
    expect(images[0]?.getAttribute('src')).toBe(`http://localhost:3000/api/file?path=${encodeURIComponent('D:\\AI\\ws\\images/phone design/a.webp')}`)
    expect(view.container.querySelector('.dsh-better-display__caption')?.textContent).toBe('手机 背面 · 来源 · 版权')
    fireEvent.click(view.getByRole('button', { name: 'notes' }))
    expect(openFile).toHaveBeenCalledWith('docs/notes.md')
    plugin.dispose()
  })

  it('mirrors DSH workspace path rules', () => {
    expect(resolveWorkspacePath('/home/u/ws/', 'images/a.png')).toBe('/home/u/ws/images/a.png')
    expect(resolveWorkspacePath('C:\\ws', 'a.png')).toBe('C:\\ws\\a.png')
    expect(resolveWorkspacePath('/ws', '/abs/a.png')).toBe('/abs/a.png')
    expect(localPath('javascript:alert(1)')).toBeUndefined()
    expect(localPath('data:image/png;base64,xx')).toBeUndefined()
    expect(localPath('C:/pics/a%20b.png?x=1')).toBe('C:/pics/a b.png')
    expect(workspaceFileUrl('file:///x', '/ws', 'a.png')).toBeUndefined()
    expect(workspaceFileUrl('dsh-app://app/', '/ws', 'a.png')).toBe('dsh-app://app/api/file?path=%2Fws%2Fa.png')
    expect(workspaceFileUrl('http://h/', undefined, 'rel.png')).toBeUndefined()
  })

  it('keeps relative images as alt text when the workspace is unknown', () => {
    const plugin = mountPlugin()
    const view = render(<MarkstreamMarkdown text={'![local](images/a.webp)'} streaming={false} />)
    expect(view.container.querySelector('img')).toBeNull()
    expect(view.container.textContent).toContain('local')
    plugin.dispose()
  })
})
