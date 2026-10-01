/**
 * Host half: registers the system-prompt section that asks the model to cite web sources as
 * `[n](url)` markers and to embed relevant pictures, which the browser half renders as
 * citation chips, a sources panel and captioned figures. The `dsh.client` entry is discovered
 * through this active host row.
 *
 * Every field is `.volatile()`: DSH generates a settings form from this schema on the plugin
 * page, and edits are committed in place, so the prompt section is re-rendered on each change
 * instead of requiring a restart.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { IMAGE_PROXY_PATH, imageProxyRoute } from './image-proxy.ts'
import { setupSideQuestions, sideQuestionsAvailable, type SideHost } from './side-question.ts'

/** Stable Cordis plugin name. */
export const name = 'dsh-better-display'

/** Composition entry id (see cordis.patch.yml); settings events are keyed by it. */
export const ENTRY_ID = 'better-display'

/** How many pictures a reply may carry. */
export type ImageCount = 'auto' | 'limit'

/** User-tunable prompt behavior (plain values, after unwrapping volatile references). */
export interface Config {
  /** Ask the model to cite web facts inline as `[n](url)`. */
  citations: boolean
  /** Ask the model to embed relevant pictures from image or web search results. */
  inlineImages: boolean
  /** `auto`: the model decides how many pictures fit; `limit`: at most `maxImages`. */
  imageCount: ImageCount
  /** Upper bound of pictures per reply in `limit` mode. */
  maxImages: number
  /** Registry order among system-prompt sections (higher = later). */
  sectionOrder: number
  /** Toolbar over selected reply text: add it to the chat as a quote, or ask a side question. */
  selectionTools: boolean
}

export const DEFAULTS: Config = {
  citations: true,
  inlineImages: true,
  imageCount: 'auto',
  maxImages: 8,
  sectionOrder: 600,
  selectionTools: true,
}

export const Config = z.object({
  citations: z.boolean().default(DEFAULTS.citations).volatile().i18n({
    'zh-CN': { $description: '引用角标：让模型用 [n](url) 标注联网来源，回答中显示为可点击的上标角标，末尾汇总「来源」面板。' },
    'en-US': { $description: 'Citation chips: the model cites web sources as [n](url), shown as clickable superscripts plus a sources panel.' },
  }),
  inlineImages: z.boolean().default(DEFAULTS.inlineImages).volatile().i18n({
    'zh-CN': { $description: '正文配图：让模型把搜到的相关图片（image_search / page_images / save_images）嵌入回答。' },
    'en-US': { $description: 'Inline pictures: the model embeds relevant pictures found by image_search / page_images / save_images.' },
  }),
  imageCount: z.union([
    z.const('auto').i18n({ 'zh-CN': { $description: '由 AI 按内容决定' }, 'en-US': { $description: 'Let the AI decide' } }),
    z.const('limit').i18n({ 'zh-CN': { $description: '限制最多张数' }, 'en-US': { $description: 'Cap the number' } }),
  ]).default(DEFAULTS.imageCount).volatile().i18n({
    'zh-CN': { $description: '配图数量：由 AI 按回答需要决定（不需要就不配），或限制每条回答的最多张数。' },
    'en-US': { $description: 'Picture count: let the AI decide per answer (none when not useful), or cap it per reply.' },
  }),
  maxImages: z.natural().min(1).max(20).default(DEFAULTS.maxImages).volatile().i18n({
    'zh-CN': { $description: '每条回答最多配图张数（仅在「限制最多张数」时生效）。' },
    'en-US': { $description: 'Maximum pictures per reply (only with "Cap the number").' },
  }),
  selectionTools: z.boolean().default(DEFAULTS.selectionTools).volatile().i18n({
    'zh-CN': { $description: '选中工具条：在回答中选中文字或图片后，可「添加到对话」（引用卡片，公式保持可读、可编辑）或「旁问」（不打扰主对话的一次性提问）。' },
    'en-US': { $description: 'Selection toolbar: select reply text or pictures to add them to the chat as an editable quote card, or ask a one-off side question.' },
  }),
  sectionOrder: z.number().default(DEFAULTS.sectionOrder).volatile().i18n({
    'zh-CN': { $description: '高级：system prompt 中本段的排序（越大越靠后）。' },
    'en-US': { $description: 'Advanced: order of this section in the system prompt (higher = later).' },
  }),
})

/** Tools whose results carry citable URLs (built-in DSH tools and @copylee/dsh-free-search). */
const SOURCE_TOOLS = 'web_search, web_fetch, multi_search, advanced_search, platform_search'
/** Tools whose results carry picture URLs or saved picture paths (@copylee/dsh-free-search). */
const IMAGE_TOOLS = 'image_search, page_images, save_images'
/** dsh-image-gen tools whose results carry a `genimg:<job id>` reference. */
const GENERATED_IMAGE_TOOLS = 'paint_image, paint_images, edit_painting'
const GENERATED_IMAGE_TOOL_NAMES = new Set(['paint_image', 'paint_images', 'edit_painting'])

/**
 * Unwrap the Loader's volatile references (`{ get() }`) into plain values, filling defaults.
 * @param raw - the config object handed to `apply`.
 * @returns the current accepted values.
 */
export function resolveConfig(raw: unknown): Config {
  const out: Record<string, unknown> = {}
  if (raw !== null && typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw)) {
      out[key] = value !== null && typeof value === 'object' && typeof (value as { get?: unknown }).get === 'function'
        ? (value as { get: () => unknown }).get()
        : value
    }
  }
  const pick = <K extends keyof Config>(key: K, valid: (value: unknown) => boolean): Config[K] =>
    valid(out[key]) ? out[key] as Config[K] : DEFAULTS[key]
  const maxImages = pick('maxImages', value => typeof value === 'number' && Number.isFinite(value))
  return {
    citations: pick('citations', value => typeof value === 'boolean'),
    inlineImages: pick('inlineImages', value => typeof value === 'boolean'),
    imageCount: pick('imageCount', value => value === 'auto' || value === 'limit'),
    maxImages: Math.min(20, Math.max(1, Math.floor(maxImages))),
    sectionOrder: pick('sectionOrder', value => typeof value === 'number' && Number.isFinite(value)),
    selectionTools: pick('selectionTools', value => typeof value === 'boolean'),
  }
}

function imageBudget(config: Config): string {
  if (config.imageCount === 'limit') return `embed the most relevant ones in your reply, at most ${config.maxImages}.`
  return 'decide how many to embed from what the answer needs: none for code, math or purely textual answers; 1-2 for a single fact, person or object; more (for example 4-8) for visual comparisons, places, products, step-by-step visuals or explicit requests for pictures. Never pad with near-duplicates or loosely related pictures.'
}

/**
 * Build the prompt section text for the enabled features.
 * @param config - current plugin config.
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
      `Pictures found by ${IMAGE_TOOLS} (and image URLs from web results) are shown to the user only inside a collapsed tool panel. When pictures genuinely help the answer (people, places, objects, products, events, visual comparisons), ${imageBudget(config)}`,
      '`![Eiffel Tower at dusk](https://upload.wikimedia.org/.../eiffel.jpg "Wikimedia Commons · CC BY-SA 4.0")`',
      '- Use the direct image URL from the tool result (the `image:` line), not the page URL, or a workspace path returned by save_images written as `![caption](<images/a b.jpg> "credit")`. Alt text is the caption; put source/author/license in the quoted title.',
      '- Place a picture next to the paragraph it illustrates. Put 2-4 related pictures on one line (no blank line between them) to show them as a gallery.',
      '- If you have no suitable picture and the answer would clearly benefit from one, you may call image_search or page_images first when available.',
      '- Never embed an image URL you did not get from a tool result or the user.',
      '',
      '### Generated images',
      `When ${GENERATED_IMAGE_TOOLS} return an inline image reference (\`genimg:<id>\`), show the picture inside your reply by embedding exactly that reference: \`![Gaussian surface around a point charge](genimg:<id>)\`. Alt text is the caption.`,
      '- Prefer it over linking the saved workspace file, and place it where it illustrates the text. It does not count toward the picture budget above.',
      '- A background job (`background: true`) shows as a placeholder that turns into the image when ready, even after your reply ends: embed it right away and keep writing; never wait or poll for it.',
    )
  }
  if (parts.length === 0) return ''
  return ['## Rich answer formatting (dsh-better-display)', '', ...parts].join('\n')
}

type TextBlock = { type: 'text', text: string }
type ContentBlocks = ReadonlyArray<{ type: string, text?: string }>
/** The parts of a `tools/post-execute` decision this plugin touches. */
type PostToolDecision = { kind: string, content?: ContentBlocks, value?: unknown }
type PostExecuteListener = (
  exec: { name: string },
  result: { isError: boolean, content: ContentBlocks },
  next: () => Promise<PostToolDecision>,
) => Promise<PostToolDecision>

const GENIMG_REFERENCE = /genimg:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/g

/**
 * Append the embed instruction to a successful dsh-image-gen result that carries `genimg:`
 * references; every other decision passes through unchanged.
 */
export function withEmbedHint(
  exec: { name: string },
  result: { isError: boolean, content: ContentBlocks },
  decision: PostToolDecision,
): PostToolDecision {
  if (!GENERATED_IMAGE_TOOL_NAMES.has(exec.name) || result.isError || decision.kind !== 'accept' || decision.value !== undefined) return decision
  const content = decision.content ?? result.content
  const text = content.map(block => block.type === 'text' ? block.text ?? '' : '').join('\n')
  const ids = [...new Set([...text.matchAll(GENIMG_REFERENCE)].map(match => match[1]))]
  if (ids.length === 0) return decision
  const examples = ids.map(id => `![<short caption>](genimg:${id})`).join(' ')
  const hint: TextBlock = {
    type: 'text',
    text: `Display: the user sees ${ids.length > 1 ? 'these images' : 'this image'} only if your reply text embeds ${examples} (rendered inline, at its real aspect ratio, by dsh-better-display). A file link, file card or deliverable does not show the picture, so embed it even when you also mention the saved file.`,
  }
  return { ...decision, content: [...content, hint] }
}

/** Browser-readable switches (see the `webServer` block in {@link apply}). */
export const STATE_PATH = '/plugins/better-display/state'

type RouteHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>
interface WebServer {
  register(route: { kind: 'exact' | 'prefix', path: string, handler: RouteHandler }): () => void
}

interface SystemPromptRegistry {
  section(section: { name: string, order: number, text: string }): () => void
}

/**
 * Keep the prompt section in sync with the (live) config.
 * @param ctx - host Cordis context.
 * @param config - config handed over by the Loader (volatile references on DSH 0.1.7+).
 */
export function apply(ctx: Context, config: unknown): void {
  const current = () => resolveConfig(config)
  let refresh = () => {}

  // systemPrompt is provided by the web/base profile; optional so the client entry still loads without it.
  ctx.inject(['systemPrompt'], (sctx) => {
    const registry = (sctx as unknown as { systemPrompt: SystemPromptRegistry }).systemPrompt
    let dispose: (() => void) | undefined
    let registered = ''
    refresh = () => {
      const value = current()
      const text = promptText(value)
      const key = `${value.sectionOrder}\n${text}`
      if (key === registered) return
      dispose?.()
      dispose = undefined
      registered = key
      if (text !== '') dispose = registry.section({ name: 'better-display:rich-answer', order: value.sectionOrder, text })
    }
    sctx.effect(() => {
      refresh()
      return () => {
        dispose?.()
        dispose = undefined
        registered = ''
        refresh = () => {}
      }
    }, 'dsh-better-display: rich answer prompt section')
  })

  // dsh-image-gen results: repeat the embed instruction right in the tool output, where the model
  // reliably reads it (a system-prompt rule alone loses to "hand over the saved file").
  ctx.inject(['tools'], (tctx) => {
    (tctx as unknown as { on(event: string, listener: PostExecuteListener): void })
      .on('tools/post-execute', async (exec, result, next) => {
        const decision = await next()
        return current().inlineImages ? withEmbedHint(exec, result, decision) : decision
      })
  })

  // Browser state (selection toolbar switch, side-question availability) and the image proxy the
  // "Add to chat" action uses for pictures from other sites.
  ctx.inject(['webServer'], (wctx) => {
    const server = (wctx as unknown as { webServer: WebServer }).webServer
    const route = (path: string, handler: RouteHandler) => {
      wctx.effect(() => server.register({ kind: 'exact', path, handler }), `dsh-better-display: ${path}`)
    }
    route(IMAGE_PROXY_PATH, imageProxyRoute())
    route(STATE_PATH, async (_req, res) => {
      const subagents = ctx.get('subagents') as Parameters<typeof sideQuestionsAvailable>[0]
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ selectionTools: current().selectionTools, sideQuestions: current().selectionTools && sideQuestionsAvailable(subagents) }))
    })
  })

  // Side questions: a tool-less fork answers a question about a quote (src/side-question.ts).
  ctx.inject(['commands', 'subagents', 'tools'], (sctx) => {
    // The tool guard and session events must see forks composed anywhere, so they hang off the root.
    const root = (sctx as unknown as { extend(meta: object): Context, root: { fiber: unknown } })
    const host = root.extend({ fiber: root.root.fiber }) as unknown as { tools: SideHost['tools'], on: SideHost['on'] }
    const scoped = sctx as unknown as SideHost
    setupSideQuestions({
      commands: scoped.commands,
      subagents: scoped.subagents,
      tools: host.tools,
      on: (event, listener) => host.on(event, listener),
      effect: (setup, label) => { sctx.effect(setup, label) },
      logger: { warn: message => { (sctx as unknown as { logger?: { warn(m: string): void } }).logger?.warn(message) } },
    })
  })

  // Settings edits land in place (volatile fields); re-render the section when ours change.
  ctx.inject(['settings'], (sctx) => {
    (sctx as unknown as { on(event: string, listener: (ns: unknown) => void): void })
      .on('settings/document-updated', (ns) => {
        if (String(ns) === ENTRY_ID) refresh()
      })
  })
}
