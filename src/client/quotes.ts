/**
 * Quotes attached to the composer. Each quote is an inline reference chip (input-trigger source
 * `better-display-quote`) whose content lives here, so it can be previewed as a rendered card
 * above the composer and edited before sending; the chip's codec turns it into a Markdown
 * blockquote when the message is sent.
 */
import { useSyncExternalStore } from 'react'
import type { InputState, InputTriggerSource, Occurrence, ReferenceInsert } from './dsh-input.ts'
import { label } from './labels.ts'

export const QUOTE_SOURCE = 'better-display-quote'

export interface Quote {
  ref: string
  /** Session whose composer holds the chip. */
  sessionId: string
  markdown: string
  /** Composer attachments carrying the quote's pictures (shown in the card, not the rail). */
  attachmentIds: readonly string[]
}

/**
 * The quote as sent: its pictures travel as image attachments, so in the text each one is
 * replaced by a short label instead of a URL the model cannot look at.
 */
export function sendableMarkdown(markdown: string): string {
  return markdown.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_match, alt: string) => `[${label('quotedImage')}${alt.trim() === '' ? '' : `：${alt.trim()}`}]`)
}

/** `> `-prefixed Markdown, one quote line per source line. */
export function blockquote(markdown: string): string {
  return markdown.trim().split('\n').map(line => line.trim() === '' ? '>' : `> ${line}`).join('\n')
}

/** Chip label: "Quote n", the n-th quote chip in the draft (the card above shows the content). */
export function quoteLabel(n: number): string {
  return `${label('quote')} ${String(n)}`
}

/**
 * Number for the next quote chip: one past the highest "Quote n" already in the draft, so labels
 * stay distinct while chips are removed and added.
 */
export function nextQuoteNumber(occurrences: readonly Occurrence[]): number {
  let highest = 0
  for (const occurrence of occurrences) {
    if (occurrence.source !== QUOTE_SOURCE) continue
    const n = Number(/(\d+)\s*$/.exec(occurrence.label)?.[1] ?? 0)
    highest = Math.max(highest, n)
  }
  return highest + 1
}

/**
 * The editor range of one chip. Occurrence offsets count the chip's expanded clipboard text, the
 * editor's own coordinates count every chip as one character; the space inserted after the chip
 * goes with it.
 */
export function chipSpan(input: Pick<InputState, 'draft' | 'occurrences'>, target: Occurrence): { start: number, end: number } {
  let shift = 0
  for (const occurrence of input.occurrences) {
    if (occurrence.offset >= target.offset) break
    shift += occurrence.length - 1
  }
  const start = target.offset - shift
  return { start, end: start + (input.draft[target.offset + target.length] === ' ' ? 2 : 1) }
}

/** Where quotes outlive a page reload (the restored draft still holds their chips). */
const STORAGE_KEY = 'dsh-better-display:quotes'
/** Quotes older than this are not restored (their drafts are long gone). */
const STORAGE_TTL_MS = 7 * 24 * 3600 * 1000

export class QuoteStore {
  private readonly quotes = new Map<string, Quote>()
  private readonly created = new Map<string, number>()

  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = defaultStorage()) {
    try {
      const saved = JSON.parse(this.storage?.getItem(STORAGE_KEY) ?? '[]') as Array<Quote & { at?: number }>
      for (const quote of saved) {
        if (typeof quote.ref !== 'string' || typeof quote.markdown !== 'string' || Date.now() - (quote.at ?? 0) > STORAGE_TTL_MS) continue
        this.quotes.set(quote.ref, { ref: quote.ref, sessionId: String(quote.sessionId), markdown: quote.markdown, attachmentIds: Array.isArray(quote.attachmentIds) ? quote.attachmentIds.map(String) : [] })
        this.created.set(quote.ref, quote.at ?? 0)
      }
    } catch { /* unreadable storage: start empty */ }
  }
  private readonly listeners = new Set<() => void>()
  private version = 0
  private counter = 0
  /** Quote whose editor is open (set by clicking its chip). */
  editing: string | undefined

  add(sessionId: string, markdown: string): Quote {
    const quote: Quote = { ref: `q${Date.now().toString(36)}${String(++this.counter)}`, sessionId, markdown, attachmentIds: [] }
    this.quotes.set(quote.ref, quote)
    this.created.set(quote.ref, Date.now())
    this.changed()
    return quote
  }

  get(ref: string): Quote | undefined {
    return this.quotes.get(ref)
  }

  update(ref: string, markdown: string): void {
    const quote = this.quotes.get(ref)
    if (quote === undefined || quote.markdown === markdown) return
    this.quotes.set(ref, { ...quote, markdown })
    this.changed()
  }

  /** Record the attachments holding a quote's pictures. */
  attach(ref: string, ids: readonly string[]): void {
    const quote = this.quotes.get(ref)
    if (quote === undefined) return
    this.quotes.set(ref, { ...quote, attachmentIds: [...quote.attachmentIds, ...ids] })
    this.changed()
  }

  /** Forget a quote's pictures (their attachments were removed or sent). */
  detach(ref: string): void {
    const quote = this.quotes.get(ref)
    if (quote === undefined || quote.attachmentIds.length === 0) return
    this.quotes.set(ref, { ...quote, attachmentIds: [] })
    this.changed()
  }

  /** Attachments shown inside quote cards, to keep out of the composer's attachment rail. */
  quotedAttachments(): ReadonlySet<string> {
    const ids = new Set<string>()
    for (const quote of this.quotes.values()) for (const id of quote.attachmentIds) ids.add(id)
    return ids
  }

  /** Quotes of a session that hold pictures. */
  withPictures(sessionId: string): Quote[] {
    return [...this.quotes.values()].filter(quote => quote.sessionId === sessionId && quote.attachmentIds.length > 0)
  }

  edit(ref: string | undefined): void {
    this.editing = ref
    this.changed()
  }

  /**
   * Forget one quote. Quotes are otherwise kept for the page's life (they are small): a failed
   * send restores the draft with its chips, which must still serialize.
   */
  delete(ref: string): void {
    this.created.delete(ref)
    if (this.quotes.delete(ref)) this.changed()
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  snapshot = (): number => this.version

  private changed(): void {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify([...this.quotes.values()].map(quote => ({ ...quote, at: this.created.get(quote.ref) ?? Date.now() }))))
    } catch { /* storage full or unavailable: quotes stay in memory */ }
    this.version++
    for (const listener of this.listeners) listener()
  }

  /** The chip inserted for a quote. */
  reference(quote: Quote, n: number): ReferenceInsert {
    return { source: QUOTE_SOURCE, ref: quote.ref, label: quoteLabel(n), clipboardText: `\n${blockquote(sendableMarkdown(quote.markdown))}\n` }
  }

  /** Input-trigger source: no menu entries, chips open the card editor, sending writes a blockquote. */
  source(): InputTriggerSource {
    return {
      trigger: '@',
      name: QUOTE_SOURCE,
      order: 1000,
      candidates: async () => [],
      onPick: () => undefined,
      openReference: (_session, reference) => {
        if (!this.quotes.has(reference.ref)) return false
        this.edit(reference.ref)
        return true
      },
      codec: {
        clipboardText: ref => {
          const quote = this.quotes.get(ref)
          return quote === undefined ? '' : `\n${blockquote(sendableMarkdown(quote.markdown))}\n`
        },
        // Blank lines around the quote keep it a block between the user's own words.
        serialize: async ref => {
          const quote = this.quotes.get(ref)
          return quote === undefined ? '' : `\n\n${blockquote(sendableMarkdown(quote.markdown))}\n\n`
        },
      },
    }
  }
}

export function useQuoteStore(store: QuoteStore): number {
  return useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot)
}

function defaultStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}
