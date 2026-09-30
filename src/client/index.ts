/** Browser half: shadow the built-in assistant renderer at a lower slot priority. */

import type { Context } from '@deepseek-ai/cordis'
import { removeCustomComponents, setCustomComponents } from 'markstream-react'
import 'markstream-react/index.css'
import './styles.css'
import {
  BetterAssistantNodeView,
  DshCodeBlockNode,
  DshImageNode,
  DshInlineCodeNode,
  DshLinkNode,
} from './renderer.tsx'
import { DisplaySettings, LOCALE_NS, ROW_CONFIG_KEY, en, zh } from './settings.tsx'

const CUSTOM_COMPONENT_SCOPE = 'dsh-better-display'

/**
 * Below dsh-better-markdown (-100) and dsh-genui (-1), so this renderer wins when several are installed;
 * the built-in renderer (0) stays in the slot as a fallback.
 */
export const ASSISTANT_STEP_PRIORITY = -110

/** The part of the host slot service this plugin uses (declared by different packages across DSH releases). */
interface SlotService {
  inject(name: string, setup: () => () => void): void
  register(entry: { name: string, key: string, priority?: number, locale: string }, component: unknown): () => void
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
