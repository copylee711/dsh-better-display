import { Component, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ComponentType, ReactNode } from 'react'
import MarkdownRender, { MarkdownCodeBlockNode } from 'markstream-react'
import type { NodeComponentProps } from 'markstream-react'
import type { CodeBlockNode, ImageNode, InlineCodeNode, LinkNode } from 'stream-markdown-parser'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import { DisclosureRow, JsonBlock, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownFileMentions } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AssistantChatData, ChatNodeViewProps, TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import { escapeCurrencyDollars } from './dollars.ts'
import { CODE_THEMES, CODE_THEME_DARK, CODE_THEME_LIGHT, SHIKI_LANGUAGES } from './shiki.ts'
import { citationLabel, extractCitations, hostOf, safeHttpUrl } from './citations.ts'
import type { Citation } from './citations.ts'
import { WorkspaceProvider, localPath, useWorkspace, workspaceFileUrl } from './workspace.ts'

const CUSTOM_COMPONENT_SCOPE = 'dsh-better-display'
/** Exports looked up by name because they were renamed or added across DSH releases. */
const primitiveExports = primitives as unknown as Record<string, unknown>

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

/** Remote http(s) pictures as-is; workspace files (e.g. saved by save_images) through DSH's file API. */
function imageSource(url: string, cwd: string | undefined): string | undefined {
  const remote = remoteImage(url)
  if (remote !== undefined) return remote
  const path = localPath(url)
  return path === undefined ? undefined : workspaceFileUrl(document.baseURI, cwd, path)
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
 * Inline picture with caption and click-to-zoom: remote http(s) images, or workspace files
 * resolved through the DSH owner (e.g. pictures saved by save_images).
 * Rendered as spans because Markdown images live inside paragraphs.
 */
export function DshImageNode({ node }: NodeComponentProps<ImageNode>) {
  const [failed, setFailed] = useState(false)
  const [zoomed, setZoomed] = useState(false)
  const close = useCallback(() => { setZoomed(false) }, [])
  const { cwd } = useWorkspace()
  const src = imageSource(node.src, cwd)
  if (src === undefined) return <span className="dsh-better-display__image-alt">{node.alt}</span>
  if (failed) {
    return (
      <a className="dsh-better-display__image-alt" href={src} target="_blank" rel="noopener noreferrer">
        {node.alt || (remoteImage(node.src) === undefined ? node.src : hostOf(src))}
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

const CARD_WIDTH = 280
const CARD_MARGIN = 8

/** Superscript source marker; its hover/focus card lives on <body> so scroll containers never clip it. */
export function CitationChip({ label, url, title }: { label: string, url: string, title?: string | undefined }) {
  const host = hostOf(url)
  const [anchor, setAnchor] = useState<{ left: number, top: number } | null>(null)
  const show = useCallback((element: HTMLElement) => {
    const rect = element.getBoundingClientRect()
    const width = Math.min(CARD_WIDTH, window.innerWidth - CARD_MARGIN * 2)
    const left = Math.min(Math.max(CARD_MARGIN, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - CARD_MARGIN)
    setAnchor({ left, top: rect.bottom + 6 })
  }, [])
  const hide = useCallback(() => { setAnchor(null) }, [])
  useEffect(() => {
    if (anchor === null) return undefined
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => {
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
    }
  }, [anchor, hide])
  return (
    <span className="dsh-better-display__cite">
      <a
        className="dsh-better-display__cite-chip"
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Source ${label}: ${title ?? host}`}
        data-citation={label}
        onMouseEnter={event => { show(event.currentTarget) }}
        onMouseLeave={hide}
        onFocus={event => { show(event.currentTarget) }}
        onBlur={hide}
      >
        {label}
      </a>
      {anchor !== null && createPortal(
        <span className="dsh-better-display__cite-card" role="tooltip" style={{ left: anchor.left, top: anchor.top }}>
          <span className="dsh-better-display__cite-host"><Favicon url={url} />{host}</span>
          {title !== undefined && <span className="dsh-better-display__cite-title">{title}</span>}
        </span>,
        document.body,
      )}
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
  if (href === undefined) return <LocalLink href={node.href}>{children ?? node.text}</LocalLink>
  return <ExternalLink href={href}>{children ?? node.text}</ExternalLink>
}

function ExternalLink({ href, children }: { href: string, children: ReactNode }) {
  return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
}

/** Workspace paths open through the DSH owner when it offers `openFile`; anything else stays inert text. */
function LocalLink({ href, children }: { href: string, children: ReactNode }) {
  const { openFile } = useWorkspace()
  const path = localPath(href)
  if (openFile === undefined || path === undefined) return <>{children}</>
  return (
    <button type="button" className="dsh-better-display__file-mention" title={path} onClick={() => { openFile(path) }}>
      {children}
    </button>
  )
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

/** Display names for fenced-code languages; anything else is shown with a capital first letter. */
const LANGUAGE_NAMES: Record<string, string> = {
  c: 'C', cpp: 'C++', 'c++': 'C++', cc: 'C++', cxx: 'C++', h: 'C', hpp: 'C++', cs: 'C#', csharp: 'C#',
  js: 'JavaScript', javascript: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', jsx: 'JSX',
  ts: 'TypeScript', typescript: 'TypeScript', tsx: 'TSX', py: 'Python', python: 'Python',
  rb: 'Ruby', rs: 'Rust', go: 'Go', golang: 'Go', kt: 'Kotlin', java: 'Java', php: 'PHP', sql: 'SQL',
  sh: 'Bash', bash: 'Bash', zsh: 'Zsh', shell: 'Shell', shellscript: 'Shell', console: 'Shell',
  ps1: 'PowerShell', powershell: 'PowerShell', html: 'HTML', xml: 'XML', svg: 'SVG', css: 'CSS', scss: 'SCSS',
  json: 'JSON', jsonc: 'JSON', yaml: 'YAML', yml: 'YAML', toml: 'TOML', md: 'Markdown', markdown: 'Markdown',
  dockerfile: 'Dockerfile', objc: 'Objective-C', 'objective-c': 'Objective-C', vue: 'Vue', svelte: 'Svelte',
  text: '', txt: '', plaintext: '', plain: '',
}

/**
 * Header label for a fenced block's info string (`cpp`, `c++ title=x`, …).
 * @param language - raw language from the parser.
 * @returns the display name, or '' for plain text / no language.
 */
export function languageLabel(language: string | undefined): string {
  const id = (language ?? '').trim().split(/[\s{:]/, 1)[0]?.toLowerCase() ?? ''
  if (id === '') return ''
  const known = LANGUAGE_NAMES[id]
  return known ?? id.charAt(0).toUpperCase() + id.slice(1)
}

function codeLabels() {
  const lang = typeof document === 'undefined' ? '' : document.documentElement.lang || navigator.language
  return lang.toLowerCase().startsWith('zh')
    ? { code: '代码', copy: '复制', copied: '已复制', collapse: '折叠', expand: '展开', lines: (n: number) => `已折叠 · ${n} 行` }
    : { code: 'Code', copy: 'Copy', copied: 'Copied', collapse: 'Collapse', expand: 'Expand', lines: (n: number) => `Collapsed · ${n} line${n === 1 ? '' : 's'}` }
}

function CodeIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5M9 3 7 13" />
    </svg>
  )
}

function CopyIcon({ done }: { done: boolean }) {
  return done
    ? <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 8.5 6.5 12 13 4.5" /></svg>
    : <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" /><path d="M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5" /></svg>
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 120ms ease' }}>
      <path d="m4 6 4 4 4-4" />
    </svg>
  )
}

/**
 * ChatGPT-style fenced code block: our own header (language, collapse, copy) around Markstream's
 * worker-free Shiki body. Collapsing unmounts the body and expanding mounts a fresh one, which
 * highlights in one full pass (Markstream's own collapse toggle left an empty body behind, because
 * its streaming renderer keeps writing into the unmounted element). When a streamed reply settles
 * the body also remounts in non-streaming mode for the same full pass.
 */
export function DshCodeBlockNode({ node, ctx }: NodeComponentProps<CodeBlockNode>) {
  const streaming = ctx?.codeBlockStream ?? true
  const [collapsed, setCollapsed] = useState(false)
  const [copied, setCopied] = useState(false)
  const labels = codeLabels()
  const label = languageLabel(node.language) || labels.code
  const onCopy = ctx?.events.onCopy
  useEffect(() => {
    if (!copied) return undefined
    const timer = setTimeout(() => { setCopied(false) }, 1500)
    return () => { clearTimeout(timer) }
  }, [copied])
  const code = node.code.replace(/\n$/, '')
  const copy = () => {
    const done = () => { setCopied(true); onCopy?.(code) }
    try {
      void navigator.clipboard.writeText(code).then(done, () => {})
    } catch { /* clipboard unavailable */ }
  }
  const lineCount = code.split('\n').length
  return (
    <div className="dsh-better-display__code" data-collapsed={collapsed || undefined} data-theme={ctx?.isDark === true ? 'dark' : 'light'}>
      <div className="dsh-better-display__code-header">
        <span className="dsh-better-display__code-lang"><CodeIcon />{label}</span>
        {collapsed && <span className="dsh-better-display__code-folded">{labels.lines(lineCount)}</span>}
        <span className="dsh-better-display__code-actions">
          <button
            type="button"
            className="dsh-better-display__code-button"
            aria-expanded={!collapsed}
            aria-label={collapsed ? labels.expand : labels.collapse}
            title={collapsed ? labels.expand : labels.collapse}
            onClick={() => { setCollapsed(value => !value) }}
          >
            <ChevronIcon open={!collapsed} />
          </button>
          <button
            type="button"
            className="dsh-better-display__code-button"
            aria-label={copied ? labels.copied : labels.copy}
            title={copied ? labels.copied : labels.copy}
            onClick={copy}
          >
            <CopyIcon done={copied} />
          </button>
        </span>
      </div>
      {!collapsed && (
        <MarkdownCodeBlockNode
          key={streaming ? 'streaming' : 'settled'}
          node={node}
          loading={node.loading}
          stream={streaming}
          isDark={ctx?.isDark ?? false}
          langs={SHIKI_LANGUAGES}
          themes={CODE_THEMES}
          lightTheme={CODE_THEME_LIGHT}
          darkTheme={CODE_THEME_DARK}
          showHeader={false}
          showCollapseButton={false}
          showFontSizeButtons={false}
          showExpandButton={false}
          showPreviewButton={false}
          enableFontSizeControl={false}
        />
      )}
    </div>
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
  const content = useMemo(() => escapeCurrencyDollars(text), [text])
  const codeBlockProps = useMemo(() => ({
    fileMentions: streaming ? undefined : fileMentions,
  }), [fileMentions, streaming])
  return (
    <div className="dsh-better-display__markdown" data-markdown-renderer="markstream-react">
      <MarkdownRender
        content={content}
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

type Translate = (key: string, params?: Record<string, unknown>) => string

/** Translate with a fallback for keys a given DSH version does not ship. */
function tr(t: Translate, key: string, fallback: string, params?: Record<string, unknown>): string {
  try {
    const value = t(key, params)
    return value === '' || value === key ? fallback : value
  } catch {
    return fallback
  }
}

/** The Think icon was renamed across DSH releases; never hand React an undefined component. */
const ThinkIcon = (primitiveExports.IconThinkOutlineRegular
  ?? primitiveExports.IconThinkOutline14) as ComponentType<{ size?: number }> | undefined

function ReasoningRow({ text, running, t }: {
  text: string
  running: boolean
  t: Translate
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
      <DisclosureRow
        rowClassName="dsh-better-display__reasoning-row"
        leadingClassName="dsh-better-display__reasoning-leading"
        titleClassName="dsh-better-display__reasoning-title"
        chevronClassName="dsh-better-display__reasoning-chevron"
        icon={ThinkIcon === undefined ? <span aria-hidden>·</span> : <ThinkIcon size={14} />}
        title={tr(t, 'message.think', 'Think')}
        open={expanded}
        expandable
        expandOnRowClick
        running={running}
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

function markdownLabels(t: Translate) {
  return {
    code: {
      copyLabel: tr(t, 'copy', 'Copy'),
      copiedLabel: tr(t, 'copied', 'Copied'),
      toolbarLabels: {
        codeLabel: tr(t, 'codeBlock.title', 'Code'),
        wrapLabel: tr(t, 'codeBlock.wrap', 'Wrap'),
        unwrapLabel: tr(t, 'codeBlock.unwrap', 'Unwrap'),
      },
    },
    footnotes: tr(t, 'markdown.footnotes', 'Footnotes'),
  }
}

/** Contain a renderer failure to one text block by falling back to DSH's own Markdown. */
class TextBoundary extends Component<{ text: string, streaming: boolean, mentions?: MarkdownFileMentions | undefined, t: Translate, children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  override componentDidCatch(error: unknown) {
    console.warn('dsh-better-display: falling back to the built-in Markdown renderer for one block', error)
  }

  override render() {
    if (!this.state.failed) return this.props.children
    const { text, streaming, mentions, t } = this.props
    return <MarkdownText text={text} streaming={streaming} labels={markdownLabels(t) as never} fileMentions={mentions} />
  }
}

type AssistantBlock = AssistantChatData['blocks'][number]

/** Subset of the owner's gallery renderer this view uses. */
type RenderMessageImages = (owner: { images: readonly { attachment: unknown }[], align: 'start' | 'end' }) => ReactNode

export function BetterAssistantMarkdown({
  blocks, streaming, interrupted, groupPart, reasoningHidden = false, revealProcess, renderMessageImages, mentions, t,
}: {
  blocks: readonly (AssistantBlock | undefined)[]
  streaming: boolean
  interrupted?: boolean | undefined
  /** `reasoning` / `response` when the Chat grouping splits one step across two rows. */
  groupPart?: string | undefined
  /** Inline reasoning folded into the Turn-process disclosure. */
  reasoningHidden?: boolean | undefined
  revealProcess?: (() => void) | undefined
  renderMessageImages?: RenderMessageImages | undefined
  mentions?: MarkdownFileMentions | undefined
  t: Translate
}) {
  const sources = useMemo(() => streaming || groupPart === 'reasoning'
    ? []
    : extractCitations(blocks.map(block => block?.kind === 'text' ? block.text : '').join('\n')), [blocks, groupPart, streaming])
  const last = blocks.length - 1
  const hasVisible = streaming || interrupted === true || blocks.some(block => block !== undefined && block.kind !== 'tool-call')
  if (!hasVisible) return null
  const rendered: ReactNode[] = []
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]
    if (block === undefined) continue
    if (groupPart === 'reasoning' && block.kind !== 'reasoning') continue
    if (groupPart === 'response' && block.kind === 'reasoning') continue
    switch (block.kind) {
      case 'text':
        rendered.push(
          <TextBoundary key={index} text={block.text} streaming={streaming} mentions={mentions} t={t}>
            <MarkstreamMarkdown text={block.text} streaming={streaming} fileMentions={mentions} />
          </TextBoundary>,
        )
        break
      case 'reasoning':
        rendered.push(
          <div
            key={index}
            data-turn-process-inline={reasoningHidden || undefined}
            hidden={reasoningHidden}
            onClick={reasoningHidden ? revealProcess : undefined}
          >
            <ReasoningRow text={block.text} running={streaming && index === last} t={t} />
          </div>,
        )
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
        if (renderMessageImages !== undefined) {
          rendered.push(
            <div key={start}>
              {renderMessageImages({ images: group.map(({ attachment }) => ({ attachment })), align: 'start' })}
            </div>,
          )
        }
        break
      }
      case 'tool-call':
        break
      default:
        rendered.push(
          <JsonBlock
            key={index}
            label={tr(t, 'message.unknownBlock', 'Unknown block')}
            payload={'block' in block ? block.block : block}
            truncatedLabel={total => tr(t, 'json.truncated', `… ${total}`, { total })}
          />,
        )
    }
  }
  const showStopped = interrupted === true && (groupPart === undefined || groupPart === 'response'
    || !blocks.some(block => block !== undefined && block.kind !== 'reasoning' && block.kind !== 'tool-call'))
  return (
    <div className="dsh-better-display__root" data-streaming={streaming || undefined}>
      <div className="dsh-better-display__body">
        {rendered}
        {showStopped && <span className="dsh-better-display__stopped">{tr(t, 'message.stopped', 'Stopped')}</span>}
        <SourcesPanel sources={sources} />
      </div>
    </div>
  )
}

/** Streaming, settled, and interrupted assistant states rendered through Markstream. */
export const BetterAssistantNodeView = memo(function BetterAssistantNodeView({
  node, groupPart, useTurnData, turnProcess, openFile, renderMessageImages, fileMentions, cwd, t,
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
  const reasoningHidden = turnProcess !== undefined
    && turnProcess.foldable
    && turnProcess.spec.answerStep === data.step
    && turnProcess.spec.inlineReasoning
    && !turnProcess.open
  const revealProcess = useCallback(() => { turnProcess?.setOpen(true) }, [turnProcess])
  const workspace = useMemo(() => ({ cwd, openFile: (path: string) => { openFile(path) } }), [cwd, openFile])
  return (
    <WorkspaceProvider value={workspace}>
      <BetterAssistantMarkdown
        blocks={data.blocks}
        groupPart={groupPart}
        streaming={data.status === 'running'}
        interrupted={data.status === 'interrupted'}
        reasoningHidden={reasoningHidden}
        revealProcess={revealProcess}
        renderMessageImages={renderMessageImages as RenderMessageImages}
        mentions={mentions}
        t={t as unknown as Translate}
      />
    </WorkspaceProvider>
  )
})
