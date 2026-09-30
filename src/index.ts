/**
 * Host half: registers the system-prompt section that asks the model to cite web sources as
 * `[n](url)` markers and to embed relevant pictures, which the browser half renders as
 * citation chips, a sources panel and captioned figures. The `dsh.client` entry is discovered
 * through this active host row.
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

/** Stable Cordis plugin name. */
export const name = 'dsh-better-display'

/** User-tunable prompt behavior. */
export interface Config {
  /** Ask the model to cite web facts inline as `[n](url)`. */
  citations: boolean
  /** Ask the model to embed relevant pictures from image or web search results. */
  inlineImages: boolean
  /** Upper bound of pictures per reply suggested to the model. */
  maxImages: number
  /** Registry order among system-prompt sections (higher = later). */
  sectionOrder: number
}

export const Config: z<Config> = z.object({
  citations: z.boolean().default(true).description('Cite web search results inline as numbered source chips.'),
  inlineImages: z.boolean().default(true).description('Embed relevant pictures from image/web search in the reply.'),
  maxImages: z.natural().min(1).max(12).default(4).description('Maximum pictures per reply.'),
  sectionOrder: z.number().default(600).description('System-prompt section order.'),
})

/** Tools whose results carry citable URLs (built-in DSH tools and @copylee/dsh-free-search). */
const SOURCE_TOOLS = 'web_search, web_fetch, multi_search, advanced_search, platform_search'
/** Tools whose results carry picture URLs (@copylee/dsh-free-search). */
const IMAGE_TOOLS = 'image_search, page_images'

/**
 * Build the prompt section text for the enabled features.
 * @param config - validated plugin config.
 * @returns the section text, or an empty string when every feature is off.
 */
export function promptText(config: Config): string {
  const parts: string[] = []
  if (config.citations) {
    parts.push(
      '### Citing web sources',
      `When your answer uses information from tool results that carry URLs (${SOURCE_TOOLS}), cite the source right after the sentence or clause it supports, using a Markdown link whose text is only a number:`,
      '`The tower is 330 m tall [1](https://example.org/eiffel "Eiffel Tower - Wikipedia").`',
      '- Number sources 1, 2, 3… in order of first use; reuse the same number for the same URL. Several sources in a row: `[1](url1)[2](url2)`.',
      '- Put the page title in the link title (the quoted part) when you know it.',
      '- Cite only URLs that actually appear in tool results of this conversation; never invent or guess URLs.',
      '- Do not add a separate reference list at the end: the interface renders the markers as clickable superscripts and collects them into a sources panel.',
      '- Do not use this marker format for anything other than citations.',
    )
  }
  if (config.inlineImages) {
    if (parts.length > 0) parts.push('')
    parts.push(
      '### Illustrating answers',
      `Pictures found by ${IMAGE_TOOLS} (and image URLs from web results) are shown to the user only inside a collapsed tool panel. When pictures genuinely help the answer (people, places, objects, products, events, visual comparisons), embed the most relevant ones in your reply, at most ${config.maxImages}:`,
      '`![Eiffel Tower at dusk](https://upload.wikimedia.org/.../eiffel.jpg "Wikimedia Commons · CC BY-SA 4.0")`',
      '- Use the direct image URL from the tool result (the `image:` line), not the page URL. Alt text is the caption; put source/author/license in the quoted title.',
      '- Place a picture next to the paragraph it illustrates. Put 2-4 related pictures on one line (no blank line between them) to show them as a gallery.',
      '- If you have no suitable picture and the answer would clearly benefit from one, you may call image_search or page_images first when available.',
      '- Skip pictures for code, math, or purely textual tasks, and never embed an image URL you did not get from a tool result or the user.',
    )
  }
  if (parts.length === 0) return ''
  return ['## Rich answer formatting (dsh-better-display)', '', ...parts].join('\n')
}

interface SystemPromptRegistry {
  section(section: { name: string, order: number, text: string }): () => void
}

/**
 * Register the prompt section while the plugin is active.
 * @param ctx - host Cordis context.
 * @param config - validated plugin config.
 */
export function apply(ctx: Context, config: Config): void {
  const text = promptText(config)
  if (text === '') return
  // systemPrompt is provided by the web/base profile; optional so the client entry still loads without it.
  ctx.inject(['systemPrompt'], (sctx) => {
    const registry = (sctx as unknown as { systemPrompt: SystemPromptRegistry }).systemPrompt
    sctx.effect(
      () => registry.section({ name: 'better-display:rich-answer', order: config.sectionOrder, text }),
      'dsh-better-display: rich answer prompt section',
    )
  })
}
