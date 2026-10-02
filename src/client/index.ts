/** Browser half: shadow the built-in assistant renderer at a lower slot priority. */

import type { Context } from '@deepseek-ai/cordis'
import { removeCustomComponents, setCustomComponents } from 'markstream-react'
import 'markstream-react/index.css'
// DSH ships KaTeX 0.16 styles; markstream renders with the bundled KaTeX 0.18, whose class names differ.
import 'katex/dist/katex.min.css'
import './styles.css'
import {
  BetterAssistantNodeView,
  DshCodeBlockNode,
  DshImageNode,
  DshInlineCodeNode,
  DshLinkNode,
  DshTextNode,
} from './renderer.tsx'
import { DisplaySettings, LOCALE_NS, ROW_CONFIG_KEY, en, zh } from './settings.tsx'
import { Composer, setActiveComposer } from './composer.ts'
import type { ConversationService, InputTriggersService, SessionsService } from './dsh-input.ts'
import { isChinese } from './labels.ts'
import { QuoteStore } from './quotes.ts'
import { createComposerDock, type DockState } from './selection-ui.tsx'
import { SIDE_CLOSE_COMMAND, SIDE_RUN_COMMAND, SideQuestions } from './side-questions.ts'
import { createUserMessageView, userMarkdownSetting } from './user-message.tsx'

const CUSTOM_COMPONENT_SCOPE = 'dsh-better-display'

/**
 * Below dsh-better-markdown (-100) and dsh-genui (-1), so this renderer wins when several are installed;
 * the built-in renderer (0) stays in the slot as a fallback.
 */
export const ASSISTANT_STEP_PRIORITY = -110

/** The part of the host slot service this plugin uses (declared by different packages across DSH releases). */
interface SlotService {
  inject(name: string, setup: () => () => void): void
  register(entry: { name: string, key?: string, id?: string, order?: number, priority?: number, locale?: string }, component: unknown): () => void
  /** Registered entries of a slot (an inspection surface; missing on some hosts). */
  entries?(name: string): ReadonlyArray<{ component: unknown, options: { key?: string, priority?: number } }>
}

/** `remote.commands` of dsh-api-remotes: runs a slash command line in a session. */
interface RemoteService {
  commands: {
    execute(sessionId: string, line: string, attachments: readonly unknown[], signal?: AbortSignal): Promise<
      { ok: true, value?: { result?: { kind?: string, text?: string } } } | { ok: false, error: { message: string } }
    >
  }
}

const STATE_ROUTE = 'plugins/better-display/state'

async function readState(): Promise<DockState> {
  const response = await fetch(new URL(STATE_ROUTE, document.baseURI).href, { credentials: 'same-origin', cache: 'no-store' })
  if (!response.ok || !(response.headers.get('content-type') ?? '').includes('json')) return { selectionTools: true, sideQuestions: false }
  const body = await response.json() as Partial<DockState>
  return { selectionTools: body.selectionTools !== false, sideQuestions: body.sideQuestions === true, userMarkdown: body.userMarkdown !== false }
}

/** Dictionary registry of the web client. */
interface LocaleService {
  register(namespace: string, dictionaries: { zh: Record<string, string>, en: Record<string, string> }): () => void
}

/** Services required in the browser Cordis tree. */
export const inject = ['slots']

/**
 * Replace the `assistant-step` slot cell while preserving the built-in renderer as a fallback.
 * @param ctx - Browser plugin context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => {
    setCustomComponents(CUSTOM_COMPONENT_SCOPE, {
      code_block: DshCodeBlockNode,
      image: DshImageNode,
      inline_code: DshInlineCodeNode,
      link: DshLinkNode,
      text: DshTextNode,
    })
    return () => { removeCustomComponents(CUSTOM_COMPONENT_SCOPE) }
  }, 'dsh-better-display: markstream component policy')

  const { slots } = ctx as Context & { slots: SlotService }
  slots.inject('conversation.chat.node', () => slots.register({
    name: 'conversation.chat.node',
    key: 'assistant-step',
    priority: ASSISTANT_STEP_PRIORITY,
    // ui-chat owns assistant-step and its `chat` locale namespace (DSH 0.1.7+).
    locale: 'chat',
  }, BetterAssistantNodeView))

  // The user's own bubbles as Markdown, drawn by the built-in bubble it shadows.
  if (typeof slots.entries === 'function') {
    const UserMessageView = createUserMessageView(kind => {
      const shadowed = (slots.entries?.('conversation.chat.node') ?? [])
        .filter(entry => entry.options.key === kind && entry.component !== UserMessageView)
        .sort((a, b) => (a.options.priority ?? 0) - (b.options.priority ?? 0))[0]
      return shadowed?.component as ReturnType<Parameters<typeof createUserMessageView>[0]>
    })
    slots.inject('conversation.chat.node', () => {
      const disposers = ['user', 'steering'].map(key => slots.register({ name: 'conversation.chat.node', key, priority: ASSISTANT_STEP_PRIORITY, locale: 'chat' }, UserMessageView))
      return () => { for (const dispose of disposers) dispose() }
    })
    ctx.effect(() => {
      const refresh = () => { void readState().then(state => { userMarkdownSetting.set(state.userMarkdown !== false) }, () => {}) }
      refresh()
      window.addEventListener('focus', refresh)
      return () => { window.removeEventListener('focus', refresh) }
    }, 'dsh-better-display: user message setting')
  }

  // Quotes, pictures and side questions from transcript selections (composer dock).
  const services: { conversation?: ConversationService, sessions?: SessionsService } = {}
  const composer = new Composer(new QuoteStore(), () => services)
  let side: SideQuestions | undefined
  ctx.effect(() => {
    setActiveComposer(composer)
    return () => { setActiveComposer(undefined) }
  }, 'dsh-better-display: composer')
  ctx.inject(['conversation', 'sessions'], (cctx) => {
    const scoped = cctx as unknown as { conversation: ConversationService, sessions: SessionsService }
    cctx.effect(() => {
      services.conversation = scoped.conversation
      services.sessions = scoped.sessions
      return () => {
        delete services.conversation
        delete services.sessions
      }
    }, 'dsh-better-display: composer services')
  })
  ctx.inject(['inputTriggers'], (tctx) => {
    const triggers = (tctx as unknown as { inputTriggers: InputTriggersService }).inputTriggers
    tctx.effect(() => triggers.registerSource(composer.quotes.source()), 'dsh-better-display: quote chips')
  })
  ctx.inject(['remote', 'remote.commands'], (rctx) => {
    const remote = (rctx as unknown as { remote: RemoteService }).remote
    rctx.effect(() => {
      const store = new SideQuestions({
        run: async (sessionId, line, signal) => {
          const response = await remote.commands.execute(sessionId, line, [], signal)
          if (!response.ok) throw new Error(response.error.message)
          return { kind: response.value?.result?.kind ?? 'error', text: response.value?.result?.text ?? '' }
        },
      }, () => isChinese() ? 'zh' : 'en')
      side = store
      return () => {
        store.dispose()
        if (side === store) side = undefined
      }
    }, 'dsh-better-display: side questions')
  })
  slots.inject('conversation.input.dock', () => slots.register({
    name: 'conversation.input.dock',
    id: 'dsh-better-display',
    order: -40,
  }, createComposerDock({ composer, side: () => side, state: readState })))
  // The side-question commands are plumbing: no transcript rows for them.
  slots.inject('conversation.chat.commandview', () => {
    const disposers = [SIDE_RUN_COMMAND, SIDE_CLOSE_COMMAND].map(key => slots.register({ name: 'conversation.chat.commandview', key }, () => null))
    return () => { for (const dispose of disposers) dispose() }
  })

  // Settings form on the Plugins page (row configure control); optional so older hosts still render replies.
  ctx.inject(['locale'], (lctx) => {
    const { locale, slots: scoped } = lctx as unknown as { locale: LocaleService, slots: SlotService }
    lctx.effect(() => locale.register(LOCALE_NS, { zh, en }), 'dsh-better-display: settings dictionaries')
    scoped.inject('plugins.row.config', () => scoped.register({
      name: 'plugins.row.config',
      key: ROW_CONFIG_KEY,
      locale: LOCALE_NS,
    }, DisplaySettings))
  })
}
