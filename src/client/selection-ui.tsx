/**
 * Composer dock (`conversation.input.dock`): the selection toolbar over transcript selections,
 * the side-question dialog and answer bubbles, and the cards of quotes attached to the draft.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Composer } from './composer.ts'
import type { InputActions, InputDockProps, Occurrence } from './dsh-input.ts'
import { label } from './labels.ts'
import { QUOTE_SOURCE, useQuoteStore } from './quotes.ts'
import { MarkstreamMarkdown } from './renderer.tsx'
import { quotableRow, selectionToMarkdown } from './selection-markdown.ts'
import type { SelectionQuote } from './selection-markdown.ts'
import { useSideAnswers, type SideQuestions } from './side-questions.ts'

/** What the Host allows (GET plugins/better-display/state). */
export interface DockState {
  selectionTools: boolean
  sideQuestions: boolean
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
    document.addEventListener('mouseup', update)
    document.addEventListener('keyup', update)
    document.addEventListener('mousedown', dismiss)
    document.addEventListener('keydown', escape)
    document.addEventListener('selectionchange', collapsed)
    document.addEventListener('scroll', dismiss, true)
    window.addEventListener('blur', dismiss)
    window.addEventListener('resize', dismiss)
    return () => {
      document.removeEventListener('mouseup', update)
      document.removeEventListener('keyup', update)
      document.removeEventListener('mousedown', dismiss)
      document.removeEventListener('keydown', escape)
      document.removeEventListener('selectionchange', collapsed)
      document.removeEventListener('scroll', dismiss, true)
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
function QuoteCard({ occurrence, composer, actions, draftRev }: { occurrence: Occurrence, composer: Composer, actions: InputActions | undefined, draftRev: number }) {
  useQuoteStore(composer.quotes)
  const quote = composer.quotes.get(occurrence.ref)
  const editing = composer.quotes.editing === occurrence.ref
  const [expanded, setExpanded] = useState(false)
  const [source, setSource] = useState(quote?.markdown ?? '')
  useEffect(() => { if (editing) setSource(quote?.markdown ?? '') }, [editing]) // eslint-disable-line react-hooks/exhaustive-deps
  if (quote === undefined) return null
  const save = () => {
    if (source.trim() !== '') composer.quotes.update(quote.ref, source)
    composer.quotes.edit(undefined)
  }
  const remove = () => {
    actions?.insertText('', { start: occurrence.offset, end: occurrence.offset + occurrence.length, draftRev })
    composer.quotes.delete(quote.ref)
  }
  return (
    <div className="dsh-better-display__quote-card" data-editing={editing || undefined}>
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

function QuoteCards({ input, composer, actions }: { input: InputDockProps['input'], composer: Composer, actions: InputActions | undefined }) {
  const occurrences = input.occurrences.filter(occurrence => occurrence.source === QUOTE_SOURCE)
  if (occurrences.length === 0) return null
  return (
    <div className="dsh-better-display__quote-cards">
      {occurrences.map(occurrence => <QuoteCard key={occurrence.occurrenceId} occurrence={occurrence} composer={composer} actions={actions} draftRev={input.draftRev} />)}
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
        <QuoteCards input={props.input} composer={composer} actions={actions} />
      </div>
    )
  }
}
