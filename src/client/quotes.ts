/**
 * Quotes attached to the composer. Each quote is an inline reference chip (input-trigger source
 * `better-display-quote`) whose content lives here, so it can be previewed as a rendered card
 * above the composer and edited before sending; the chip's codec turns it into a Markdown
 * blockquote when the message is sent.
 */
import { useSyncExternalStore } from 'react'
import type { InputTriggerSource, ReferenceInsert } from './dsh-input.ts'
import { label } from './labels.ts'

export const QUOTE_SOURCE = 'better-display-quote'

export interface Quote {
  ref: string
  /** Session whose composer holds the chip. */
  sessionId: string
  markdown: string
}

/** `> `-prefixed Markdown, one quote line per source line. */
export function blockquote(markdown: string): string {
  return markdown.trim().split('\n').map(line => line.trim() === '' ? '>' : `> ${line}`).join('\n')
}

/** Short chip label: the quote's first words without Markdown punctuation. */
export function quoteLabel(markdown: string): string {
  const plain = markdown
    .replace(/^\s*(?:[-*+]|\d+[.)]|>)\s+/gm, '')
    .replace(/\$\$?[\s\S]*?\$\$?/g, '∑')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~>#|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const head = [...plain].slice(0, 14).join('')
  return `${label('quote')}：${head}${[...plain].length > 14 ? '…' : ''}`
}

export class QuoteStore {
  private readonly quotes = new Map<string, Quote>()
  private readonly listeners = new Set<() => void>()
  private version = 0
  private counter = 0
  /** Quote whose editor is open (set by clicking its chip). */
  editing: string | undefined

  add(sessionId: string, markdown: string): Quote {
    const quote = { ref: `q${Date.now().toString(36)}${String(++this.counter)}`, sessionId, markdown }
    this.quotes.set(quote.ref, quote)
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

  edit(ref: string | undefined): void {
    this.editing = ref
    this.changed()
  }

  /**
   * Forget one quote. Quotes are otherwise kept for the page's life (they are small): a failed
   * send restores the draft with its chips, which must still serialize.
   */
  delete(ref: string): void {
    if (this.quotes.delete(ref)) this.changed()
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  snapshot = (): number => this.version

  private changed(): void {
    this.version++
    for (const listener of this.listeners) listener()
  }

  /** The chip inserted for a quote. */
  reference(quote: Quote): ReferenceInsert {
    return { source: QUOTE_SOURCE, ref: quote.ref, label: quoteLabel(quote.markdown), clipboardText: `\n${blockquote(quote.markdown)}\n` }
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
          return quote === undefined ? '' : `\n${blockquote(quote.markdown)}\n`
        },
        // Blank lines around the quote keep it a block between the user's own words.
        serialize: async ref => {
          const quote = this.quotes.get(ref)
          return quote === undefined ? '' : `\n\n${blockquote(quote.markdown)}\n\n`
        },
      },
    }
  }
}

export function useQuoteStore(store: QuoteStore): number {
  return useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot)
}
