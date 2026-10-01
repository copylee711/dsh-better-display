/**
 * Side questions ("旁问"): a one-off question about a quote, answered by a tool-less fork of the
 * conversation on the Host (src/side-question.ts) and shown as bubbles above the composer, so the
 * main conversation stays untouched. Bubbles live for the page's life only.
 */
import { useSyncExternalStore } from 'react'

/** Hidden Host commands (see src/side-question.ts). */
export const SIDE_RUN_COMMAND = 'better-display-aside'
export const SIDE_CLOSE_COMMAND = 'better-display-aside-close'
const MAX_PER_SESSION = 20
const MAX_RUNNING = 8

export interface SideAnswer {
  id: string
  sessionId: string
  question: string
  quote?: string
  phase: 'running' | 'done' | 'error'
  answer?: string
  error?: string
}

export interface SideTransport {
  run(sessionId: string, line: string, signal: AbortSignal): Promise<{ kind: string, text: string }>
}

export class SideQuestions {
  private items: SideAnswer[] = []
  private readonly controllers = new Map<string, AbortController>()
  private readonly listeners = new Set<() => void>()

  constructor(private readonly transport: SideTransport, private readonly locale: () => string) {}

  list(sessionId: string): SideAnswer[] {
    return this.items.filter(item => item.sessionId === sessionId)
  }

  ask(sessionId: string, question: string, quote?: string): string {
    if (this.controllers.size >= MAX_RUNNING) throw new Error('too many side questions are running')
    const id = crypto.randomUUID()
    const own = this.list(sessionId)
    if (own.length >= MAX_PER_SESSION) this.close(own[0]!.id)
    const controller = new AbortController()
    this.controllers.set(id, controller)
    this.set([...this.items, { id, sessionId, question, ...(quote === undefined ? {} : { quote }), phase: 'running' }])
    const line = `/${SIDE_RUN_COMMAND} ${JSON.stringify({ id, question, quote, locale: this.locale() })}`
    void this.transport.run(sessionId, line, controller.signal).then(
      result => { this.patch(id, result.kind === 'success' ? { phase: 'done', answer: result.text } : { phase: 'error', error: result.text }) },
      (error: unknown) => { if (!controller.signal.aborted) this.patch(id, { phase: 'error', error: error instanceof Error ? error.message : String(error) }) },
    ).finally(() => { this.controllers.delete(id) })
    return id
  }

  close(id: string): void {
    const item = this.items.find(entry => entry.id === id)
    if (item === undefined) return
    const controller = this.controllers.get(id)
    if (controller !== undefined) {
      controller.abort()
      // Stop the Host fork too; failures only leave it to its own timeout.
      void this.transport.run(item.sessionId, `/${SIDE_CLOSE_COMMAND} ${id}`, new AbortController().signal).catch(() => {})
    }
    this.set(this.items.filter(entry => entry.id !== id))
  }

  dispose(): void {
    for (const controller of this.controllers.values()) controller.abort()
    this.controllers.clear()
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  snapshot = (): readonly SideAnswer[] => this.items

  private patch(id: string, change: Partial<SideAnswer>): void {
    this.set(this.items.map(item => item.id === id ? { ...item, ...change } : item))
  }

  private set(items: SideAnswer[]): void {
    this.items = items
    for (const listener of this.listeners) listener()
  }
}

export function useSideAnswers(store: SideQuestions, sessionId: string): SideAnswer[] {
  const items = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot)
  return items.filter(item => item.sessionId === sessionId)
}
