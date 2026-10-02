/**
 * Composer actions behind "Add to chat": a quote chip (content kept in {@link QuoteStore}) at the
 * caret, and pictures as image attachments, through DSH's public input contract.
 */
import { imageFile } from './attach-image.ts'
import type { ConversationService, InputActions, SessionsService } from './dsh-input.ts'
import { label } from './labels.ts'
import { nextQuoteNumber, type QuoteStore } from './quotes.ts'
import type { QuotedImage } from './selection-markdown.ts'

export class Composer {
  /** Session of the conversation on screen (set by its composer dock). */
  activeSession: string | undefined

  constructor(
    readonly quotes: QuoteStore,
    private readonly services: () => { conversation?: ConversationService, sessions?: SessionsService },
  ) {}

  private input(sessionId: string) {
    const { conversation, sessions } = this.services()
    const actx = sessions?.scope(sessionId)
    if (conversation === undefined || actx === undefined) throw new Error(label('noSession'))
    return { conversation, input: conversation.input.for(actx) }
  }

  /**
   * Insert a quote chip (when there is text) and attach pictures.
   * @param actions - the dock's input actions, for the caret; without them the quote goes last.
   * @returns how many pictures were attached.
   */
  async add(sessionId: string, markdown: string, images: readonly QuotedImage[], actions?: InputActions): Promise<number> {
    const { conversation, input } = this.input(sessionId)
    const state = input.state.getSnapshot()
    if (state.phase === 'adjudicating' || state.phase === 'submitting') throw new Error(label('composerBusy'))
    if (markdown.trim() !== '') {
      const quote = this.quotes.add(sessionId, markdown)
      const reference = this.quotes.reference(quote, nextQuoteNumber(state.occurrences))
      const span = actions?.captureInsertion() ?? { start: state.draft.length, end: state.draft.length, draftRev: state.draftRev }
      if (!input.insertReference(reference, span)) {
        // The caret moved under us: append the readable quote as text instead.
        const end = input.state.getSnapshot()
        actions?.insertText(reference.clipboardText, { start: end.draft.length, end: end.draft.length, draftRev: end.draftRev })
        this.quotes.delete(quote.ref)
      }
    }
    const attached = images.length === 0 ? 0 : await this.attach(sessionId, conversation, input, images)
    input.focus()
    return attached
  }

  private async attach(sessionId: string, conversation: ConversationService, input: ReturnType<ConversationService['input']['for']>, images: readonly QuotedImage[]): Promise<number> {
    if (conversation.createDrafts === undefined) throw new Error(label('imageFailed', { error: 'unsupported DSH version' }))
    const settled = await Promise.allSettled(images.map(image => imageFile(image.src, image.alt)))
    const files = settled.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
    const failure = settled.find(result => result.status === 'rejected')
    if (files.length > 0) input.addAttachments(conversation.createDrafts(sessionId, files).map(draft => draft.id))
    if (failure !== undefined) input.notify('error', label('imageFailed', { error: String((failure as PromiseRejectedResult).reason) }))
    return files.length
  }

  /** Report an action's failure in the composer's notice line. */
  notify(sessionId: string, error: unknown): void {
    try {
      this.input(sessionId).input.notify('error', error instanceof Error ? error.message : String(error))
    } catch {
      // No session to report to.
    }
  }
}

let active: Composer | undefined

/** The composer bound to the loaded plugin (for the image preview's "Add to chat"). */
export function activeComposer(): Composer | undefined {
  return active
}

export function setActiveComposer(composer: Composer | undefined): void {
  active = composer
}
