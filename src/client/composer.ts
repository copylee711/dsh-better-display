/**
 * Composer actions behind "Add to chat": a quote chip (content kept in {@link QuoteStore}) at the
 * caret, and pictures as image attachments, through DSH's public input contract.
 */
import { imageFile } from './attach-image.ts'
import type { ConversationService, InputActions, InputState, SessionsService } from './dsh-input.ts'
import { label } from './labels.ts'
import { chipSpan, nextQuoteNumber, type QuoteStore } from './quotes.ts'
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
    let quoted: string | undefined
    if (markdown.trim() !== '') {
      const quote = this.quotes.add(sessionId, markdown)
      quoted = quote.ref
      const reference = this.quotes.reference(quote, nextQuoteNumber(state.occurrences))
      const span = actions?.captureInsertion() ?? { start: state.draft.length, end: state.draft.length, draftRev: state.draftRev }
      if (!input.insertReference(reference, span)) {
        // The caret moved under us: append the readable quote as text instead.
        const end = input.state.getSnapshot()
        actions?.insertText(reference.clipboardText, { start: end.draft.length, end: end.draft.length, draftRev: end.draftRev })
        this.quotes.delete(quote.ref)
        quoted = undefined
      }
    }
    const ids = images.length === 0 ? [] : await this.attach(sessionId, conversation, input, images)
    // Pictures of a quote belong to its card: shown there, removed with it.
    if (quoted !== undefined && ids.length > 0) this.quotes.attach(quoted, ids)
    input.focus()
    if (quoted !== undefined && actions !== undefined) placeCaretAfter(input, actions, quoted)
    return ids.length
  }

  private async attach(sessionId: string, conversation: ConversationService, input: ReturnType<ConversationService['input']['for']>, images: readonly QuotedImage[]): Promise<string[]> {
    if (conversation.createDrafts === undefined) throw new Error(label('imageFailed', { error: 'unsupported DSH version' }))
    const settled = await Promise.allSettled(images.map(image => imageFile(image.src, image.alt)))
    const files = settled.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
    const failure = settled.find(result => result.status === 'rejected')
    const ids = files.length === 0 ? [] : conversation.createDrafts(sessionId, files).map(draft => draft.id)
    if (ids.length > 0) input.addAttachments(ids)
    if (failure !== undefined) input.notify('error', label('imageFailed', { error: String((failure as PromiseRejectedResult).reason) }))
    return ids
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

/**
 * Put the caret right after a quote chip. Focusing the input box after a click elsewhere (the
 * selection toolbar) restores the caret it had before, i.e. in front of the new chip; an empty
 * insertion at the chip's end moves it past the chip, so typing continues after the quote.
 */
function placeCaretAfter(input: { state: { getSnapshot(): InputState } }, actions: InputActions, ref: string): void {
  const move = () => {
    const state = input.state.getSnapshot()
    const chip = state.occurrences.find(occurrence => occurrence.ref === ref)
    if (chip === undefined) return
    const { end } = chipSpan(state, chip)
    actions.insertText('', { start: end, end, draftRev: state.draftRev })
  }
  // After the focus has settled (it restores the old caret asynchronously).
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(move)
  else move()
}
