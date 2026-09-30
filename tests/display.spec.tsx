// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { removeCustomComponents } from 'markstream-react'
import { apply } from '../src/client/index.ts'
import { BetterAssistantMarkdown, MarkstreamMarkdown, SourcesPanel } from '../src/client/renderer.tsx'
import { citationLabel, extractCitations, hostOf } from '../src/client/citations.ts'

function mountPlugin() {
  const disposers: Array<() => void> = []
  const ctx = {
    slots: { inject: vi.fn((_name: string, setup: () => unknown) => setup()), register: vi.fn(() => () => {}) },
    inject: vi.fn(),
    effect: vi.fn((setup: () => void | (() => void)) => {
      const dispose = setup()
      if (typeof dispose === 'function') disposers.push(dispose)
    }),
  }
  apply(ctx as never)
  return { dispose: () => disposers.reverse().forEach(dispose => { dispose() }) }
}

const t = ((key: string) => key) as never

afterEach(() => {
  removeCustomComponents('dsh-better-display')
})

describe('citation helpers', () => {
  it('recognises numeric link text only', () => {
    expect(citationLabel('1')).toBe('1')
    expect(citationLabel('[12]')).toBe('12')
    expect(citationLabel('^3')).toBe('3')
    expect(citationLabel('Wikipedia')).toBeUndefined()
    expect(citationLabel('1234')).toBeUndefined()
  })

  it('dedupes sources by URL in order of first appearance', () => {
    const text = [
      'A [1](https://www.a.com/x "Alpha") B [2](https://b.org/y) C [1](https://www.a.com/x)',
      'D [[3]](https://c.net "Gamma") [4](javascript:alert(1)) [link](https://d.io)',
      'E [2](https://b.org/y "Beta")',
    ].join('\n')
    expect(extractCitations(text)).toEqual([
      { label: '1', url: 'https://www.a.com/x', title: 'Alpha', host: 'a.com' },
      { label: '2', url: 'https://b.org/y', title: 'Beta', host: 'b.org' },
      { label: '3', url: 'https://c.net', title: 'Gamma', host: 'c.net' },
    ])
    expect(hostOf('not a url')).toBe('not a url')
  })
})

describe('rich rendering', () => {
  it('renders numeric links as citation chips and leaves normal links alone', () => {
    const plugin = mountPlugin()
    const view = render(
      <MarkstreamMarkdown
        text={'Paris is the capital [1](https://en.wikipedia.org/wiki/Paris "Paris - Wikipedia"). See [docs](https://example.com).'}
        streaming={false}
      />,
    )
    const chip = view.container.querySelector('a.dsh-better-display__cite-chip')
    expect(chip?.textContent).toBe('1')
    expect(chip?.getAttribute('href')).toBe('https://en.wikipedia.org/wiki/Paris')
    expect(chip?.getAttribute('target')).toBe('_blank')
    expect(document.querySelector('.dsh-better-display__cite-card')).toBeNull()
    fireEvent.mouseEnter(chip!)
    expect(document.querySelector('.dsh-better-display__cite-title')?.textContent).toBe('Paris - Wikipedia')
    expect(document.querySelector('.dsh-better-display__cite-host')?.textContent).toContain('en.wikipedia.org')
    fireEvent.mouseLeave(chip!)
    expect(document.querySelector('.dsh-better-display__cite-card')).toBeNull()
    expect(screen.getByRole('link', { name: 'docs' }).classList.contains('dsh-better-display__cite-chip')).toBe(false)
    plugin.dispose()
  })

  it('keeps unsafe citation targets inert', () => {
    const plugin = mountPlugin()
    const view = render(<MarkstreamMarkdown text={'Bad [1](javascript:alert(1)) marker'} streaming={false} />)
    expect(view.container.querySelector('.dsh-better-display__cite-chip')).toBeNull()
    expect(view.container.querySelector('a[href^="javascript"]')).toBeNull()
    plugin.dispose()
  })

  it('renders captioned figures, galleries and a lightbox', () => {
    const plugin = mountPlugin()
    const view = render(
      <MarkstreamMarkdown
        text={'![Tower](https://img.example/a.jpg "Wikimedia · CC BY-SA") ![Night](https://img.example/b.jpg)\n\n![local](./secret.png)'}
        streaming={false}
      />,
    )
    const figures = view.container.querySelectorAll('.dsh-better-display__figure')
    expect(figures).toHaveLength(2)
    expect(figures[0]?.querySelector('.dsh-better-display__caption')?.textContent).toBe('Tower · Wikimedia · CC BY-SA')
    expect(figures[0]?.parentElement).toBe(figures[1]?.parentElement)
    expect(figures[0]?.querySelector('img')?.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(view.container.querySelector('img[src="./secret.png"]')).toBeNull()
    fireEvent.click(figures[0]!.querySelector('img')!)
    expect(document.querySelector('.dsh-better-display__lightbox img')?.getAttribute('src')).toBe('https://img.example/a.jpg')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.querySelector('.dsh-better-display__lightbox')).toBeNull()
    plugin.dispose()
  })

  it('falls back to a link when a picture fails to load', () => {
    const plugin = mountPlugin()
    const view = render(<MarkstreamMarkdown text={'![Broken](https://img.example/404.jpg)'} streaming={false} />)
    fireEvent.error(view.container.querySelector('.dsh-better-display__image')!)
    expect(screen.getByRole('link', { name: 'Broken' }).getAttribute('href')).toBe('https://img.example/404.jpg')
    plugin.dispose()
  })

  it('shows the sources panel only once the reply settles', () => {
    const plugin = mountPlugin()
    const blocks = [{ kind: 'text', text: 'A [1](https://a.com "Alpha") B [2](https://b.org)' }] as const
    const view = render(<BetterAssistantMarkdown blocks={blocks} streaming t={t} />)
    expect(view.container.querySelector('.dsh-better-display__sources')).toBeNull()
    view.rerender(<BetterAssistantMarkdown blocks={blocks} streaming={false} t={t} />)
    const toggle = view.container.querySelector('.dsh-better-display__sources-toggle')!
    expect(toggle.textContent).toContain('2')
    fireEvent.click(toggle)
    const items = view.container.querySelectorAll('.dsh-better-display__source a')
    expect([...items].map(item => item.getAttribute('href'))).toEqual(['https://a.com', 'https://b.org'])
    plugin.dispose()
  })

  it('renders nothing for an empty source list', () => {
    const view = render(<SourcesPanel sources={[]} />)
    expect(view.container.innerHTML).toBe('')
  })
})

describe('dollar amounts', () => {
  it('renders prices as text but keeps real math', async () => {
    const view = render(<MarkstreamMarkdown text={'价格 $2 / $10，缓存 **$0.10**（Astra $1.00）'} streaming={false} />)
    await new Promise(resolve => setTimeout(resolve, 200))
    expect(view.container.querySelector('.katex')).toBeNull()
    expect(view.container.textContent).toContain('$2 / $10')
    expect(view.container.querySelector('strong')?.textContent).toBe('$0.10')
    view.unmount()
    const math = render(<MarkstreamMarkdown text={'面积 $r^2$'} streaming={false} />)
    await new Promise(resolve => setTimeout(resolve, 200))
    expect(math.container.querySelector('.katex')).not.toBeNull()
  })
})
