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

const CUSTOM_COMPONENT_SCOPE = 'dsh-better-display'

/**
 * Below dsh-better-markdown (-100) and dsh-genui (-1), so this renderer wins when several are installed;
 * the built-in renderer (0) stays in the slot as a fallback.
 */
export const ASSISTANT_STEP_PRIORITY = -110

/** The part of the host slot service this plugin uses (declared by different packages across DSH releases). */
interface SlotService {
  inject(name: string, setup: () => () => void): void
  register(entry: { name: string, key: string, priority: number, locale: string }, component: unknown): () => void
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
}
