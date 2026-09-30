import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'
import MarkdownRender, { MarkdownCodeBlockNode } from 'markstream-react'
import type { NodeComponentProps } from 'markstream-react'
import type { CodeBlockNode, ImageNode, InlineCodeNode, LinkNode } from 'stream-markdown-parser'
import { DisclosureRow, IconThinkOutline14, JsonBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownFileMentions } from '@deepseek-ai/dsh-client-ui-primitives'
import { ImageGallery } from '@deepseek-ai/dsh-client-ui-attachment'
import type { ImageLoader } from '@deepseek-ai/dsh-client-ui-attachment'
import type {
  AssistantChatData, ChatNodeViewProps, ChatViewSlotProps, TurnTailOwnerProps,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { SHIKI_LANGUAGES } from './shiki.ts'
import { citationLabel, extractCitations, hostOf, safeHttpUrl } from './citations.ts'
import type { Citation } from './citations.ts'

const CUSTOM_COMPONENT_SCOPE = 'dsh-better-display'

function isFileMentions(value: unknown): value is MarkdownFileMentions {
  return typeof value === 'object' && value !== null && 'resolve' in value
    && typeof value.resolve === 'function'
}

function rendererFileMentions(ctx: NodeComponentProps['ctx']): MarkdownFileMentions | undefined {
  const value = ctx?.codeBlockProps?.fileMentions
  return isFileMentions(value) ? value : undefined
}

function safeLink(url: string): string | undefined {
  try {
    const protocol = new URL(url).protocol
    return protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:' ? url : undefined
  } catch {
    return undefined
  }
}

function remoteImage(url: string): string | undefined {
  const safe = safeLink(url)
  return safe?.startsWith('http:') || safe?.startsWith('https:') ? safe : undefined
}

function Lightbox({ src, alt, onClose }: { src: string, alt: string, onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [onClose])
  return createPortal(
    <div className="dsh-better-display__lightbox" role="dialog" aria-modal="true" aria-label={alt || 'Image preview'} onClick={onClose}>
      <img src={src} alt={alt} referrerPolicy="no-referrer" onClick={event => { event.stopPropagation() }} />
      <div className="dsh-better-display__lightbox-bar" onClick={event => { event.stopPropagation() }}>
        <a href={src} target="_blank" rel="noopener noreferrer">Open original ↗</a>
        <button type="button" onClick={onClose}>Close</button>
      </div>
    </div>,
    document.body,
  )
}

/**
 * Inline picture with caption and click-to-zoom. Keeps DSH's external-only image policy.
 * Rendered as spans because Markdown images live inside paragraphs.
 */
export function DshImageNode({ node }: NodeComponentProps<ImageNode>) {
  const [failed, setFailed] = useState(false)
  const [zoomed, setZoomed] = useState(false)
  const close = useCallback(() => { setZoomed(false) }, [])
  const src = remoteImage(node.src)
  if (src === undefined) return <span className="dsh-better-display__image-alt">{node.alt}</span>
  if (failed) {
    return (
      <a className="dsh-better-display__image-alt" href={src} target="_blank" rel="noopener noreferrer">
        {node.alt || hostOf(src)}
      </a>
    )
  }
  const caption = [node.alt, node.title].filter(part => part !== null && part !== '').join(' · ')
  return (
    <span className="dsh-better-display__figure" role="figure" aria-label={node.alt || undefined}>
      <img
        className="dsh-better-display__image"
        src={src}
        alt={node.alt}
        title={node.title ?? undefined}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => { setFailed(true) }}
        onClick={() => { setZoomed(true) }}
      />
      {caption !== '' && <span className="dsh-better-display__caption">{caption}</span>}
      {zoomed && <Lightbox src={src} alt={node.alt} onClose={close} />}
    </span>
  )
}

function Favicon({ url }: { url: string }) {
  const [failed, setFailed] = useState(false)
  const host = hostOf(url)
  if (failed) return <span className="dsh-better-display__favicon" aria-hidden>{host.charAt(0).toUpperCase()}</span>
  let origin = ''
  try { origin = new URL(url).origin } catch { /* unreachable for validated URLs */ }
  return (
    <img
      className="dsh-better-display__favicon"
      src={`${origin}/favicon.ico`}
      alt=""
      aria-hidden
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => { setFailed(true) }}
    />
  )
}

/** Superscript source marker with a hover/focus card; clicking opens the source. */
export function CitationChip({ label, url, title }: { label: string, url: string, title?: string | undefined }) {
  const host = hostOf(url)
  return (
    <span className="dsh-better-display__cite">
      <a
        className="dsh-better-display__cite-chip"
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Source ${label}: ${title ?? host}`}
        data-citation={label}
      >
        {label}
      </a>
      <span className="dsh-better-display__cite-card" role="tooltip">
        <span className="dsh-better-display__cite-host"><Favicon url={url} />{host}</span>
        {title !== undefined && <span className="dsh-better-display__cite-title">{title}</span>}
      </span>
    </span>
  )
}

/** Citation markers become chips; other safe external links stay links; unsafe targets stay inert. */
export function DshLinkNode({ node, children }: NodeComponentProps<LinkNode>) {
  const href = safeLink(node.href)
  const label = citationLabel(node.text)
  if (label !== undefined) {
    const url = safeHttpUrl(node.href)
    if (url === undefined) return <>{children ?? node.text}</>
    return <CitationChip label={label} url={url} title={node.title ?? undefined} />
  }
  if (href === undefined) return <>{children ?? node.text}</>
  return <a href={href} target="_blank" rel="noopener noreferrer">{children ?? node.text}</a>
}

/** Collapsible list of every source cited in a settled reply. */
export function SourcesPanel({ sources }: { sources: readonly Citation[] }) {
  const [open, setOpen] = useState(false)
  if (sources.length === 0) return null
  const title = sourcesLabel()
  return (
    <div className="dsh-better-display__sources" data-count={sources.length}>
      <button
        type="button"
        className="dsh-better-display__sources-toggle"
        aria-expanded={open}
        onClick={() => { setOpen(value => !value) }}
      >
        <span className="dsh-better-display__sources-stack" aria-hidden>
          {sources.slice(0, 4).map(source => <Favicon key={source.url} url={source.url} />)}
        </span>
        <span>{title} · {sources.length}</span>
        <span className="dsh-better-display__sources-chevron" aria-hidden>{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <ol className="dsh-better-display__sources-list">
          {sources.map(source => (
            <li key={source.url} className="dsh-better-display__source">
              <span className="dsh-better-display__source-label">{source.label}</span>
              <a href={source.url} target="_blank" rel="noopener noreferrer">
                <span className="dsh-better-display__source-title">{source.title ?? source.url}</span>
                <span className="dsh-better-display__source-host"><Favicon url={source.url} />{source.host}</span>
              </a>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

/** DSH ships zh/en UIs; follow the document language, then the browser's. */
function sourcesLabel(): string {
  const lang = document.documentElement.lang || navigator.language
  return lang.toLowerCase().startsWith('zh') ? '来源' : 'Sources'
}

/** Preserve DSH's URL promotion and settled file-mention behavior for inline code. */
export function DshInlineCodeNode({ node, ctx }: NodeComponentProps<InlineCodeNode>) {
  const href = safeLink(node.code)
  if (href?.startsWith('http:') || href?.startsWith('https:')) {
    return <code><a href={href} target="_blank" rel="noopener noreferrer">{node.code}</a></code>
  }
  const mention = rendererFileMentions(ctx)?.resolve(node.code)
  if (mention !== undefined) {
    return (
      <code>
        <button
          type="button"
          className="dsh-better-display__file-mention"
          title={mention.title}
          aria-label={mention.label}
          onClick={mention.open}
        >
          {node.code}
        </button>
      </code>
    )
  }
  return <code>{node.code}</code>
}

/** Use Markstream's worker-free Shiki renderer for fenced code blocks. */
export function DshCodeBlockNode({ node, ctx }: NodeComponentProps<CodeBlockNode>) {
  return (
    <MarkdownCodeBlockNode
      node={node}
      loading={node.loading}
      stream={ctx?.codeBlockStream ?? true}
      isDark={ctx?.isDark ?? false}
      langs={SHIKI_LANGUAGES}
      onCopy={ctx?.events.onCopy}
    />
  )
}

/** Luminance threshold (0-255 scale) below which the DSW base background counts as dark. */
const DARK_BG_LUMINANCE = 140

/**
 * Resolve whether the DSH web shell is currently in dark mode.
 * Primary signal: luminance of the computed `--dsw-alias-bg-base` token — always fresh,
 * independent of how the theme system applies tokens. Fallbacks are the
 * `data-ds-dark-theme` attribute on `<body>`, then the OS preference.
 */
function detectDshDark(): boolean {
  try {
    const value = getComputedStyle(document.body).getPropertyValue('--dsw-alias-bg-base').trim()
    if (value !== '') {
      const match = /(?:rgba?\(\s*)?(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(value)
      if (match !== null) {
        return 0.2126 * Number(match[1]) + 0.7152 * Number(match[2]) + 0.0722 * Number(match[3]) < DARK_BG_LUMINANCE
      }
    }
  } catch { /* document body not available yet */ }
  try {
    if (document.body.hasAttribute('data-ds-dark-theme')) return true
  } catch { /* ignore */ }
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return false
  }
}

/** Reactive DSH dark-mode state; re-renders when the shell flips theme tokens or attributes. */
export function useDshIsDark(): boolean {
  const [dark, setDark] = useState(detectDshDark)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(() => setDark(detectDshDark()), 80)
    }
    try {
      const observer = new MutationObserver(schedule)
      const options: MutationObserverInit = { attributes: true, attributeFilter: ['data-ds-dark-theme', 'style'] }
      observer.observe(document.documentElement, options)
      observer.observe(document.body, options)
      return () => {
        if (timer !== undefined) clearTimeout(timer)
        observer.disconnect()
      }
    } catch { /* MutationObserver unavailable */ }
    return undefined
  }, [])
  return dark
}

/** Markstream wrapper configured for untrusted assistant output. */
export const MarkstreamMarkdown = memo(function MarkstreamMarkdown({ text, streaming, fileMentions }: {
  text: string
  streaming: boolean
  fileMentions?: MarkdownFileMentions | undefined
}) {
  const isDark = useDshIsDark()
  const codeBlockProps = useMemo(() => ({
    fileMentions: streaming ? undefined : fileMentions,
  }), [fileMentions, streaming])
  return (
    <div className="dsh-better-display__markdown" data-markdown-renderer="markstream-react">
      <MarkdownRender
        content={text}
        final={!streaming}
        isDark={isDark}
        customId={CUSTOM_COMPONENT_SCOPE}
        htmlPolicy="escape"
        fade={false}
        smoothStreaming={false}
        viewportPriority={false}
        codeBlockStream={streaming}
        codeBlockProps={codeBlockProps}
      />
    </div>
  )
})

function firstLine(text: string): string {
  const newline = text.indexOf('\n')
  return newline === -1 ? text : text.slice(0, newline)
}

function latestLine(text: string): string {
  const visible = text.trimEnd()
  const newline = visible.lastIndexOf('\n')
  return newline === -1 ? visible : visible.slice(newline + 1)
}

function ReasoningRow({ text, running, t }: {
  text: string
  running: boolean
  t: ChatViewSlotProps['t']
}) {
  const [expanded, setExpanded] = useState(false)
  const summaryRef = useRef<HTMLSpanElement>(null)
  const summary = running ? latestLine(text) : firstLine(text)
  useEffect(() => {
    const element = summaryRef.current
    if (element !== null) element.scrollLeft = running ? element.scrollWidth - element.clientWidth : 0
  }, [running, summary])
  return (
    <div className="dsh-better-display__reasoning" data-state={running ? 'running' : 'ok'}>
      {running && <span className="dsh-better-display__visually-hidden">{t('row.running')}</span>}
      <DisclosureRow
        rowClassName="dsh-better-display__reasoning-row"
        leadingClassName="dsh-better-display__reasoning-leading"
        titleClassName="dsh-better-display__reasoning-title"
        chevronClassName="dsh-better-display__reasoning-chevron"
        icon={<IconThinkOutline14 size={14} />}
        title="Think"
        open={expanded}
        expandable
        expandOnRowClick
        onToggle={() => { setExpanded(value => !value) }}
        collapsedContent={(
          <>
            <span className="dsh-better-display__reasoning-separator" aria-hidden />
            <span ref={summaryRef} className="dsh-better-display__reasoning-summary">{summary}</span>
          </>
        )}
      >
        <div className="dsh-better-display__reasoning-body">{text}</div>
      </DisclosureRow>
    </div>
  )
}

type AssistantBlock = AssistantChatData['blocks'][number]

export function BetterAssistantMarkdown({ blocks, streaming, interrupted, loadImage, mentions, t }: {
  blocks: readonly AssistantBlock[]
  streaming: boolean
  interrupted?: boolean | undefined
  loadImage?: ImageLoader | undefined
  mentions?: MarkdownFileMentions | undefined
  t: ChatViewSlotProps['t']
}) {
  const sources = useMemo(() => streaming
    ? []
    : extractCitations(blocks.map(block => block.kind === 'text' ? block.text : '').join('\n')), [blocks, streaming])
  const imageLoader = loadImage ?? (() => Promise.reject(new Error(t('image.serviceUnavailable'))))
  const last = blocks.length - 1
  const hasVisible = streaming || interrupted === true || blocks.some(block => block.kind !== 'tool-call')
  if (!hasVisible) return null
  const rendered: ReactNode[] = []
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]
    if (block === undefined) continue
    switch (block.kind) {
      case 'text':
        rendered.push(
          <MarkstreamMarkdown key={index} text={block.text} streaming={streaming} fileMentions={mentions} />,
        )
        break
      case 'reasoning':
        rendered.push(<ReasoningRow key={index} text={block.text} running={streaming && index === last} t={t} />)
        break
      case 'image': {
        const start = index
        const group = [block]
        while (index + 1 < blocks.length) {
          const next = blocks[index + 1]
          if (next === undefined || next.kind !== 'image') break
          group.push(next)
          index += 1
        }
        rendered.push(
          <ImageGallery
            key={start}
            images={group}
            load={imageLoader}
            align="start"
            labels={{
              image: t('image.label'),
              open: t('image.openOriginal'),
              openNamed: label => t('image.openOriginalLabel', { label }),
              loading: t('image.loading'),
              loadFailed: t('image.loadFailed'),
              lightbox: {
                dialog: t('image.preview'),
                close: t('image.closePreview'),
              },
            }}
          />,
        )
        break
      }
      case 'tool-call':
        break
      default:
        rendered.push(
          <JsonBlock
            key={index}
            label={t('message.unknownBlock')}
            payload={block.block}
            truncatedLabel={total => t('json.truncated', { total })}
          />,
        )
    }
  }
  return (
    <div className="dsh-better-display__root" data-streaming={streaming || undefined}>
      <div className="dsh-better-display__body">
        {rendered}
        {interrupted && <span className="dsh-better-display__stopped">{t('message.stopped')}</span>}
        <SourcesPanel sources={sources} />
      </div>
    </div>
  )
}

/** Streaming, settled, and interrupted assistant states rendered through Markstream. */
export const BetterAssistantNodeView = memo(function BetterAssistantNodeView({
  node, useTurnData, openFile, loadImage, fileMentions, t,
}: ChatNodeViewProps<'assistant-step'>) {
  const data = node.data
  const turn = node.location.kind === 'turn' || node.location.kind === 'step'
    ? node.location.turn
    : undefined
  const tail = useTurnData('turn-tail')
  const owner = useMemo<TurnTailOwnerProps | undefined>(() => {
    if (turn?.status !== 'closed' || data.finalNode === undefined) return undefined
    if (tail?.closing?.finalNode.seq !== data.finalNode.seq) return undefined
    return { turn, seq: data.finalNode.seq, openFile }
  }, [data.finalNode, openFile, tail, turn])
  const mentions = useMemo(
    () => owner === undefined ? undefined : fileMentions(owner),
    [fileMentions, owner],
  )
  return (
    <BetterAssistantMarkdown
      blocks={data.blocks}
      streaming={data.status === 'running'}
      interrupted={data.status === 'interrupted'}
      loadImage={loadImage}
      mentions={mentions}
      t={t}
    />
  )
})
