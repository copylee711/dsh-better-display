/**
 * Composer dock (`conversation.input.dock`): the selection toolbar over transcript selections,
 * the side-question dialog and answer bubbles, and the cards of quotes attached to the draft.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ComponentType, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { installBlankSelection } from './blank-select.ts'
import type { Composer } from './composer.ts'
import type { InputActions, InputDockProps, Occurrence } from './dsh-input.ts'
import { label } from './labels.ts'
import { QUOTE_SOURCE, chipSpan, useQuoteStore } from './quotes.ts'
import { hardBreaks, looksLikeMarkdown } from './user-message.tsx'
import { MarkstreamMarkdown } from './renderer.tsx'
import { quotableRow, selectionToMarkdown } from './selection-markdown.ts'
import type { SelectionQuote } from './selection-markdown.ts'
import { useSideAnswers, type SideQuestions } from './side-questions.ts'

/** What the Host allows (GET plugins/better-display/state). */
export interface DockState {
  selectionTools: boolean
  sideQuestions: boolean
  userMarkdown?: boolean
}

interface DockContext {
  composer: Composer
  /** Side questions, once the remote command channel is available. */
  side: () => SideQuestions | undefined
  state: () => Promise<DockState>
}

/** Only image placeholders (`[alt]`) and whitespace: the selection is pictures only. */
function textOf(quote: SelectionQuote): string {
  return quote.images.length === 0 ? quote.markdown : quote.markdown.replace(/\[[^\]\n]*\]/g, '').trim() === '' ? '' : quote.markdown
}

interface Captured {
  quote: SelectionQuote
  rect: Pick<DOMRect, 'top' | 'bottom' | 'left' | 'width'>
}

function captureSelection(target: EventTarget | null): Captured | undefined {
  const selection = document.getSelection()
  if (selection === null || selection.rangeCount !== 1 || selection.isCollapsed) return undefined
  const range = selection.getRangeAt(0)
  if (quotableRow(range, target) === null) return undefined
  const quote = selectionToMarkdown(range)
  if (quote.markdown === '' && quote.images.length === 0) return undefined
  // Ranges without layout (jsdom) fall back to the corner.
  const rect = typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : { top: 0, bottom: 0, left: 0, width: 0 }
  return { quote, rect }
}

const BAR_GAP = 8

/** Floating toolbar over a transcript selection. */
function SelectionBar({ onAdd, onAsk, canAsk }: {
  onAdd: (quote: SelectionQuote) => void
  onAsk: (quote: SelectionQuote) => void
  canAsk: boolean
}) {
  const [captured, setCaptured] = useState<Captured>()
  const bar = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ left: number, top: number }>()

  useEffect(() => {
    const update = (event: Event) => {
      if (event instanceof MouseEvent && (event.button !== 0 || event.defaultPrevented)) return
      if (event instanceof KeyboardEvent && !(event.key === 'Shift' || (event.shiftKey && /^(Arrow|Home|End)/.test(event.key)))) return
      if (bar.current?.contains(event.target as Node)) return
      // Let the browser finish updating the selection first.
      setTimeout(() => { setCaptured(captureSelection(event.target)) }, 0)
    }
    const dismiss = (event: Event) => {
      if (bar.current?.contains(event.target as Node)) return
      setCaptured(undefined)
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setCaptured(undefined) }
    const collapsed = () => { if (document.getSelection()?.isCollapsed !== false) setCaptured(undefined) }
    // Scrolling keeps the toolbar: it follows the selection (and hides while that is off-screen).
    let frame = 0
    const follow = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const selection = document.getSelection()
        if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) {
          setCaptured(undefined)
          return
        }
        const rect = selection.getRangeAt(0).getBoundingClientRect()
        setCaptured(current => current === undefined ? undefined : { ...current, rect })
      })
    }
    // Drags from blank space beside formulas and pictures select too (blank-select.ts).
    const removeBlankSelection = installBlankSelection()
    document.addEventListener('mouseup', update)
    document.addEventListener('keyup', update)
    document.addEventListener('mousedown', dismiss)
    document.addEventListener('keydown', escape)
    document.addEventListener('selectionchange', collapsed)
    document.addEventListener('scroll', follow, true)
    window.addEventListener('blur', dismiss)
    window.addEventListener('resize', dismiss)
    return () => {
      removeBlankSelection()
      document.removeEventListener('mouseup', update)
      document.removeEventListener('keyup', update)
      document.removeEventListener('mousedown', dismiss)
      document.removeEventListener('keydown', escape)
      document.removeEventListener('selectionchange', collapsed)
      cancelAnimationFrame(frame)
      document.removeEventListener('scroll', follow, true)
      window.removeEventListener('blur', dismiss)
      window.removeEventListener('resize', dismiss)
    }
  }, [])

  useLayoutEffect(() => {
    if (captured === undefined || bar.current === null) {
      setPosition(undefined)
      return
    }
    const { width, height } = bar.current.getBoundingClientRect()
    const rect = captured.rect
    // The selection scrolled out of view: hide until it is back.
    if (rect.bottom < 0 || rect.top > window.innerHeight) {
      setPosition(undefined)
      return
    }
    const above = rect.top - height - BAR_GAP
    const top = above >= BAR_GAP ? above : Math.min(window.innerHeight - height - BAR_GAP, rect.bottom + BAR_GAP)
    const left = Math.min(Math.max(BAR_GAP, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - BAR_GAP)
    setPosition({ left, top })
  }, [captured])

  if (captured === undefined) return null
  const quote = captured.quote
  const run = (action: (quote: SelectionQuote) => void) => () => {
    setCaptured(undefined)
    action(quote)
  }
  return createPortal(
    <div
      ref={bar}
      className="dsh-better-display__selection-bar"
      role="toolbar"
      style={position === undefined ? { visibility: 'hidden', left: 0, top: 0 } : position}
      // Keep the selection while clicking the toolbar.
      onMouseDown={event => { event.preventDefault() }}
    >
      <button type="button" onClick={run(onAdd)}>{textOf(quote) === '' ? label('addImage') : label('addToChat')}</button>
      {canAsk && textOf(quote) !== '' && <button type="button" onClick={run(onAsk)}>{label('sideQuestion')}</button>}
    </div>,
    document.body,
  )
}

/** Modal for a side question about a quote. */
function AskDialog({ quote, onSend, onClose }: { quote: string, onSend: (question: string) => void, onClose: () => void }) {
  const [question, setQuestion] = useState('')
  const field = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { field.current?.focus() }, [])
  const send = (text: string) => {
    if (text.trim() === '') return
    onSend(text.trim())
    onClose()
  }
  const keys = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') onClose()
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      send(question)
    }
  }
  return createPortal(
    <div className="dsh-better-display__ask-backdrop" onMouseDown={onClose}>
      <div className="dsh-better-display__ask" role="dialog" aria-modal="true" aria-label={label('askTitle')} onMouseDown={event => { event.stopPropagation() }}>
        <div className="dsh-better-display__ask-title">{label('askTitle')}</div>
        <div className="dsh-better-display__quote-preview"><MarkstreamMarkdown text={quote} streaming={false} /></div>
        <textarea ref={field} value={question} rows={3} placeholder={label('askPlaceholder')} onChange={event => { setQuestion(event.target.value) }} onKeyDown={keys} />
        <div className="dsh-better-display__ask-actions">
          <button type="button" onClick={onClose}>{label('cancel')}</button>
          <button type="button" onClick={() => { send(label('explain')) }}>{label('explain')}</button>
          <button type="button" className="dsh-better-display__primary" disabled={question.trim() === ''} onClick={() => { send(question) }}>{label('send')}</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button type="button" onClick={() => { void navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => { setCopied(false) }, 1500) }) }}>
      {copied ? label('copied') : label('copy')}
    </button>
  )
}

/** Side-question answers of this session. */
function SideBubbles({ side, sessionId, onQuote }: { side: SideQuestions, sessionId: string, onQuote: (markdown: string) => void }) {
  const items = useSideAnswers(side, sessionId)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  if (items.length === 0) return null
  const toggle = (id: string) => { setCollapsed(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next }) }
  return (
    <div className="dsh-better-display__bubbles">
      {items.map(item => (
        <div key={item.id} className="dsh-better-display__bubble" data-phase={item.phase}>
          <div className="dsh-better-display__bubble-head">
            <span className="dsh-better-display__bubble-question" title={item.question}>{label('sideQuestion')} · {item.question}</span>
            <span className="dsh-better-display__bubble-actions">
              {item.answer !== undefined && <CopyButton text={item.answer} />}
              {item.answer !== undefined && <button type="button" onClick={() => { onQuote(item.answer!) }}>{label('addToChat')}</button>}
              <button type="button" onClick={() => { toggle(item.id) }}>{collapsed.has(item.id) ? label('expand') : label('collapse')}</button>
              <button type="button" onClick={() => { side.close(item.id) }}>{label('close')}</button>
            </span>
          </div>
          {!collapsed.has(item.id) && (
            <div className="dsh-better-display__bubble-body">
              {item.phase === 'running' && <span className="dsh-better-display__bubble-thinking">{label('thinking')}</span>}
              {item.phase === 'error' && <span className="dsh-better-display__bubble-error">{label('sideFailed', { error: item.error ?? '' })}</span>}
              {item.answer !== undefined && <MarkstreamMarkdown text={item.answer} streaming={false} />}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

/** One attached quote: rendered preview, or its Markdown source while editing. */
function QuoteCard({ occurrence, input, composer, actions }: { occurrence: Occurrence, input: InputDockProps['input'], composer: Composer, actions: InputActions | undefined }) {
  useQuoteStore(composer.quotes)
  const quote = composer.quotes.get(occurrence.ref)
  const editing = composer.quotes.editing === occurrence.ref
  const [expanded, setExpanded] = useState(false)
  const [source, setSource] = useState(quote?.markdown ?? '')
  const card = useRef<HTMLDivElement>(null)
  const latest = useRef(source)
  latest.current = source
  useEffect(() => { if (editing) setSource(quote?.markdown ?? '') }, [editing]) // eslint-disable-line react-hooks/exhaustive-deps
  // Clicking anywhere outside the card while editing keeps the edit and closes the editor.
  useEffect(() => {
    if (!editing) return undefined
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && card.current?.contains(event.target) === true) return
      if (latest.current.trim() !== '') composer.quotes.update(occurrence.ref, latest.current)
      composer.quotes.edit(undefined)
    }
    document.addEventListener('pointerdown', outside, true)
    return () => { document.removeEventListener('pointerdown', outside, true) }
  }, [editing, occurrence.ref])
  if (quote === undefined) return null
  const save = () => {
    if (source.trim() !== '') composer.quotes.update(quote.ref, source)
    composer.quotes.edit(undefined)
  }
  const remove = () => {
    if (actions?.insertText('', { ...chipSpan(input, occurrence), draftRev: input.draftRev }) !== true) {
      composer.notify(quote.sessionId, label('removeFailed'))
      return
    }
    for (const id of quote.attachmentIds) actions.removeAttachment(id)
    composer.quotes.delete(quote.ref)
  }
  return (
    <div ref={card} className="dsh-better-display__quote-card" data-editing={editing || undefined}>
      <div className="dsh-better-display__quote-head">
        <span className="dsh-better-display__quote-label">{occurrence.label}</span>
        <span className="dsh-better-display__quote-actions">
          {editing
            ? <button type="button" onClick={save}>{label('done')}</button>
            : <button type="button" onClick={() => { composer.quotes.edit(quote.ref) }}>{label('edit')}</button>}
          {!editing && <button type="button" onClick={() => { setExpanded(value => !value) }}>{expanded ? label('collapse') : label('expand')}</button>}
          <button type="button" onClick={remove}>{label('remove')}</button>
        </span>
      </div>
      {editing
        ? <textarea
            className="dsh-better-display__quote-editor"
            value={source}
            rows={Math.min(12, Math.max(3, source.split('\n').length))}
            onChange={event => { setSource(event.target.value) }}
            onKeyDown={event => {
              if (event.key === 'Escape') composer.quotes.edit(undefined)
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) save()
            }}
            autoFocus
          />
        : <div className="dsh-better-display__quote-preview" data-expanded={expanded || undefined}>
            <MarkstreamMarkdown text={quote.markdown} streaming={false} />
          </div>}
    </div>
  )
}

function QuoteCards({ sessionId, input, composer, actions }: { sessionId: string, input: InputDockProps['input'], composer: Composer, actions: InputActions | undefined }) {
  const occurrences = input.occurrences.filter(occurrence => occurrence.source === QUOTE_SOURCE)
  // A chip deleted in the input box (or sent) takes its pictures along: they would otherwise be
  // sent as stray attachments nobody can see.
  const present = occurrences.map(occurrence => occurrence.ref).join(' ')
  useEffect(() => {
    const refs = new Set(present.split(' '))
    for (const quote of composer.quotes.withPictures(sessionId)) {
      if (refs.has(quote.ref)) continue
      for (const id of quote.attachmentIds) if (input.attachmentIds.includes(id)) actions?.removeAttachment(id)
      composer.quotes.detach(quote.ref)
    }
  }, [present, sessionId])  // eslint-disable-line react-hooks/exhaustive-deps
  if (occurrences.length === 0) return null
  return (
    <div className="dsh-better-display__quote-cards">
      {occurrences.map(occurrence => <QuoteCard key={occurrence.occurrenceId} occurrence={occurrence} input={input} composer={composer} actions={actions} />)}
    </div>
  )
}

const PREVIEW_KEY = 'dsh-better-display:draft-preview'

/** The draft's own words: quote chips (expanded in `draft`) are shown by their cards instead. */
export function draftWords(input: Pick<InputDockProps['input'], 'draft' | 'occurrences'>): string {
  let out = ''
  let at = 0
  for (const occurrence of input.occurrences) {
    if (occurrence.source !== QUOTE_SOURCE) continue
    out += input.draft.slice(at, occurrence.offset)
    at = occurrence.offset + occurrence.length
  }
  return (out + input.draft.slice(at)).trim()
}

/** Rendered preview of a draft written in Markdown / TeX (the input box itself stays plain text). */
function DraftPreview({ input }: { input: InputDockProps['input'] }) {
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(PREVIEW_KEY) === '1' } catch { return false }
  })
  const words = draftWords(input)
  if (!looksLikeMarkdown(words)) return null
  const toggle = () => {
    setOpen(value => {
      try { localStorage.setItem(PREVIEW_KEY, value ? '0' : '1') } catch { /* storage unavailable */ }
      return !value
    })
  }
  return (
    <div className="dsh-better-display__draft-preview" data-open={open || undefined}>
      <button type="button" className="dsh-better-display__draft-preview-toggle" aria-expanded={open} onClick={toggle}>
        {open ? label('hidePreview') : label('preview')}
      </button>
      {open && (
        <div className="dsh-better-display__draft-preview-body">
          <MarkstreamMarkdown text={hardBreaks(words)} streaming={false} />
        </div>
      )}
    </div>
  )
}

/** Build the `conversation.input.dock` entry. */
export function createComposerDock(context: DockContext) {
  return function ComposerDock(props: InputDockProps): ReactNode {
    const { composer } = context
    const sessionId = props.session.sessionId
    const actions = props.inputActions
    const [asking, setAsking] = useState<string>()
    const [state, setState] = useState<DockState>({ selectionTools: true, sideQuestions: false })
    useEffect(() => {
      let live = true
      void context.state().then(next => { if (live) setState(next) }, () => {})
      return () => { live = false }
    }, [sessionId])
    const side = state.sideQuestions ? context.side() : undefined
    useEffect(() => {
      composer.activeSession = sessionId
      return () => { if (composer.activeSession === sessionId) composer.activeSession = undefined }
    }, [sessionId])
    const add = useCallback((quote: SelectionQuote) => {
      void composer.add(sessionId, textOf(quote), quote.images, actions).catch((error: unknown) => { composer.notify(sessionId, error) })
    }, [sessionId, actions])
    return (
      <div className="dsh-better-display__dock">
        {state.selectionTools && <SelectionBar onAdd={add} onAsk={quote => { setAsking(textOf(quote)) }} canAsk={side !== undefined} />}
        {asking !== undefined && side !== undefined && (
          <AskDialog
            quote={asking}
            onClose={() => { setAsking(undefined) }}
            onSend={question => {
              try {
                side.ask(sessionId, question, asking)
              } catch (error) {
                composer.notify(sessionId, error)
              }
            }}
          />
        )}
        {side !== undefined && <SideBubbles side={side} sessionId={sessionId} onQuote={markdown => { add({ markdown, images: [] }) }} />}
        <QuoteCards sessionId={sessionId} input={props.input} composer={composer} actions={actions} />
        <DraftPreview input={props.input} />
      </div>
    )
  }
}

/**
 * The composer's attachment rail without the pictures that belong to quote cards (they show
 * inside their card instead). Everything else — dropped, pasted or uploaded files — is drawn by
 * the built-in rail this one shadows.
 */
export function createAttachmentRail(quotes: Composer['quotes'], builtin: () => ComponentType<RailProps> | undefined) {
  return function QuoteAwareAttachmentRail(props: RailProps): ReactNode {
    useQuoteStore(quotes)
    const Builtin = builtin()
    // Abdicate to the built-in rail (the slot renders the next entry when this one throws).
    if (Builtin === undefined) throw new Error('dsh-better-display: built-in attachment rail not found')
    const hidden = quotes.quotedAttachments()
    if (hidden.size === 0) return <Builtin {...props} />
    return <Builtin {...props} attachments={props.attachments.filter(attachment => !hidden.has(attachment.id))} />
  }
}

interface RailProps {
  attachments: ReadonlyArray<{ id: string }>
  [prop: string]: unknown
}
