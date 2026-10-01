/**
 * The parts of DSH's composer contract (dsh-client-ui-conversation 0.2, dsh-client-ui-input-trigger)
 * this plugin uses, typed locally so the bundle needs no host type packages at runtime.
 */

export interface TokenSpan {
  readonly start: number
  readonly end: number
  readonly draftRev: number
}

export interface ReferenceInsert {
  readonly source: string
  readonly ref: string
  readonly label: string
  readonly appearance?: 'session' | 'file' | 'folder'
  readonly clipboardText: string
}

/** One reference chip in the draft, in the clipboard-text projection. */
export interface Occurrence {
  readonly occurrenceId: number
  readonly source: string
  readonly ref: string
  readonly offset: number
  readonly length: number
  readonly label: string
}

export interface InputState {
  readonly draft: string
  readonly draftRev: number
  readonly phase: 'plain' | 'adjudicating' | 'claimed' | 'submitting'
  readonly occurrences: readonly Occurrence[]
  readonly attachmentIds: readonly string[]
}

/** Stable input verbs handed to session-scoped slot entries. */
export interface InputActions {
  captureInsertion(): TokenSpan
  insertText(text: string, span: TokenSpan): boolean
  setDraft(text: string): void
  addAttachments(ids: readonly string[]): boolean
  removeAttachment(id: string): void
}

/** `ctx.conversation.input.for(actx)`. */
export interface SessionInput {
  insertReference(ref: ReferenceInsert, span: TokenSpan): boolean
  addAttachments(ids: readonly string[]): boolean
  notify(level: 'info' | 'error', text: string): void
  focus(): void
  readonly state: { getSnapshot(): InputState }
}

export interface ConversationService {
  input: { for(actx: unknown): SessionInput }
  /** Public on the ConversationController class (not on its IConversation face). */
  createDrafts?(sessionId: string, files: readonly File[]): ReadonlyArray<{ id: string }>
}

export interface SessionsService {
  scope(sessionId: string): unknown
}

/** Props of a `conversation.input.dock` entry (InputZone + session standard props). */
export interface InputDockProps {
  session: { sessionId: string }
  input: InputState
  inputActions?: InputActions
}

export interface ReferenceCodec {
  clipboardText(ref: string): string
  serialize(ref: string, signal: AbortSignal): Promise<string>
}

export interface InputTriggerSource {
  readonly trigger: '/' | '@'
  readonly name: string
  readonly order?: number
  candidates(session: unknown, request: unknown): Promise<readonly unknown[]>
  onPick(pick: unknown): unknown
  openReference?(session: unknown, reference: { ref: string }): boolean
  readonly codec?: ReferenceCodec
}

export interface InputTriggersService {
  registerSource(source: InputTriggerSource): () => void
}
