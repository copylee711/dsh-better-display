// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { removeCustomComponents } from 'markstream-react'
import { apply } from '../src/client/index.ts'
import { MarkstreamMarkdown } from '../src/client/renderer.tsx'
import { WorkspaceProvider } from '../src/client/workspace.ts'
import { generatedJobId, jobImageUrl, jobStatusUrl, resetGeneratedJobs } from '../src/client/generated-image.ts'

const JOB = '0f8c2a4e-1b2c-4d3e-8f90-123456789abc'

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

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } })
}

afterEach(() => {
  cleanup()
  removeCustomComponents('dsh-better-display')
  resetGeneratedJobs()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('genimg references', () => {
  it('parses only complete job ids and resolves the job routes against the page', () => {
    expect(generatedJobId(`genimg:${JOB}`)).toBe(JOB)
    expect(generatedJobId('genimg:0f8c2a4e-1b2c')).toBeUndefined()
    expect(jobStatusUrl(JOB)).toBe(`http://localhost:3000/plugins/copylee-image-gen/jobs/${JOB}`)
    expect(jobImageUrl(JOB)).toBe(`http://localhost:3000/plugins/copylee-image-gen/jobs/${JOB}/image`)
  })

  it('shows a placeholder at the expected ratio, then swaps in the finished image', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const answers = [
      jsonResponse({ id: JOB, status: 'pending', width: 16, height: 9 }),
      jsonResponse({ id: JOB, status: 'done', width: 1600, height: 900 }),
    ]
    const fetch = vi.fn(async () => answers.shift() ?? jsonResponse({ id: JOB, status: 'done', width: 1600, height: 900 }))
    vi.stubGlobal('fetch', fetch)
    const plugin = mountPlugin()
    const view = render(<MarkstreamMarkdown text={`Gauss's law:\n\n![Gaussian surface](genimg:${JOB})\n\nThe flux…`} streaming={false} />)
    const placeholder = await waitFor(() => {
      const box = view.container.querySelector<HTMLElement>('.dsh-better-display__image-placeholder')
      expect(box?.style.aspectRatio).toBe('16 / 9')
      return box
    })
    expect(placeholder?.getAttribute('aria-busy')).toBe('true')
    expect(view.container.querySelector('.dsh-better-display__caption')?.textContent).toBe('Gaussian surface')
    await act(async () => { await vi.advanceTimersByTimeAsync(1600) })
    const image = await waitFor(() => {
      const img = view.container.querySelector('img.dsh-better-display__image')
      expect(img).not.toBeNull()
      return img!
    })
    expect(image.getAttribute('src')).toBe(jobImageUrl(JOB))
    expect(image.getAttribute('width')).toBe('1600')
    expect(view.container.querySelector('.dsh-better-display__image-placeholder')).toBeNull()
    fireEvent.click(image)
    expect(document.querySelector('.dsh-better-display__lightbox img')?.getAttribute('src')).toBe(jobImageUrl(JOB))
    // The page's own image cannot open in the system browser on Desktop: offer saving instead.
    const bar = document.querySelector('.dsh-better-display__lightbox-bar')
    expect(bar?.querySelector('a')).toBeNull()
    expect(bar?.querySelectorAll('button')).toHaveLength(2)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(fetch).toHaveBeenCalledWith(jobStatusUrl(JOB), expect.objectContaining({ cache: 'no-store' }))
    plugin.dispose()
  })

  it('opens a finished image through DSH when its file path is known', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ id: JOB, status: 'done', width: 4, height: 3, path: 'D:/ws/copylee-image-gen/image-1.png' })))
    const openFile = vi.fn()
    const plugin = mountPlugin()
    const view = render(
      <WorkspaceProvider value={{ cwd: 'D:/ws', openFile }}>
        <MarkstreamMarkdown text={`![Diagram](genimg:${JOB})`} streaming={false} />
      </WorkspaceProvider>,
    )
    const image = await waitFor(() => {
      const img = view.container.querySelector('img.dsh-better-display__image')
      expect(img).not.toBeNull()
      return img!
    })
    fireEvent.click(image)
    const open = document.querySelector<HTMLButtonElement>('.dsh-better-display__lightbox-bar button[title]')
    expect(open?.getAttribute('title')).toBe('D:/ws/copylee-image-gen/image-1.png')
    fireEvent.click(open!)
    expect(openFile).toHaveBeenCalledWith('D:/ws/copylee-image-gen/image-1.png')
    expect(document.querySelector('.dsh-better-display__lightbox')).toBeNull()
    plugin.dispose()
  })

  it('shows the failure reason and stops polling', async () => {
    const fetch = vi.fn(async () => jsonResponse({ id: JOB, status: 'failed', width: 1, height: 1, error: 'quota exceeded' }))
    vi.stubGlobal('fetch', fetch)
    const plugin = mountPlugin()
    const view = render(<MarkstreamMarkdown text={`![Diagram](genimg:${JOB})`} streaming={false} />)
    await waitFor(() => {
      expect(view.container.querySelector('.dsh-better-display__image-placeholder--failed')?.textContent).toContain('quota exceeded')
    })
    expect(fetch).toHaveBeenCalledTimes(1)
    plugin.dispose()
  })

  it('treats a missing job route (HTML fallback) as unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } })))
    const plugin = mountPlugin()
    const view = render(<MarkstreamMarkdown text={`![Diagram](genimg:${JOB})`} streaming={false} />)
    await waitFor(() => {
      expect(view.container.querySelector('.dsh-better-display__image-placeholder--failed')).not.toBeNull()
    })
    plugin.dispose()
  })

  it('does not poll while the reference is still streaming in', () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const plugin = mountPlugin()
    const view = render(<MarkstreamMarkdown text={'![Diagram](genimg:0f8c2a4e-1b2c)'} streaming={false} />)
    expect(view.container.querySelector('.dsh-better-display__image-placeholder')).not.toBeNull()
    expect(fetch).not.toHaveBeenCalled()
    plugin.dispose()
  })
})
