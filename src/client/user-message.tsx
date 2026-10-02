/**
 * The user's own message bubbles rendered as Markdown. The built-in bubble keeps doing everything
 * else (attachments, copy and time actions, reference chips): it renders as usual and only its
 * text box is swapped for a rendered twin, so host features keep working without being copied.
 */
import { memo, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ComponentType } from 'react'
import { createPortal } from 'react-dom'
import { MarkstreamMarkdown } from './renderer.tsx'

interface UserNodeProps {
  node: { kind: string, data: { content?: ReadonlyArray<{ type: string, text?: string }>, referenceLabels?: readonly string[], skillNames?: readonly string[] } }
}

/** Whether the "render my messages" setting is on (read from the Host; on until it says otherwise). */
export const userMarkdownSetting = (() => {
  let value = true
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set(next: boolean) {
      if (next === value) return
      value = next
      for (const listener of listeners) listener()
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
})()

function messageText(props: UserNodeProps): string {
  return (props.node.data.content ?? []).filter(block => block.type === 'text').map(block => block.text ?? '').join('')
}

/** Plain prose stays in the built-in bubble; anything with Markdown or TeX syntax is rendered. */
export function looksLikeMarkdown(text: string): boolean {
  return /\$[^$\n]+\$|\$\$|\\\(|\\\[|\*\*|__|`|^\s{0,3}(?:#{1,6}\s|>|[-*+]\s|\d+[.)]\s|\|.*\|)|\[[^\]]+\]\([^)]+\)/m.test(text)
}

/**
 * Keep the user's line breaks: in Markdown a single newline joins lines, in a chat message it
 * means a new line. Fenced code and display math are left alone.
 */
export function hardBreaks(text: string): string {
  let fenced = false
  let math = false
  const lines = text.split('\n')
  return lines.map((line, index) => {
    const trimmed = line.trim()
    if (/^(`{3,}|~{3,})/.test(trimmed)) fenced = !fenced
    else if (!fenced && trimmed === '$$') math = !math
    const next = lines[index + 1]
    const breaks = !fenced && !math && trimmed !== '' && next !== undefined && next.trim() !== '' && !/^(`{3,}|~{3,})/.test(trimmed) && trimmed !== '$$'
    return breaks ? `${line}  ` : line
  }).join('\n')
}

/** The built-in bubble's text box (CSS-module class `…_bubble`). */
function findBubble(root: Element): HTMLElement | undefined {
  for (const element of root.querySelectorAll<HTMLElement>('div')) {
    if ([...element.classList].some(name => /(?:^|_)bubble$/.test(name))) return element
  }
  return undefined
}

function RenderedBubble({ Builtin, props, text }: { Builtin: ComponentType<UserNodeProps>, props: UserNodeProps, text: string }) {
  const host = useRef<HTMLDivElement>(null)
  const [target, setTarget] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => {
    const bubble = host.current === null ? undefined : findBubble(host.current)
    if (bubble === undefined) return
    const twin = document.createElement('div')
    twin.className = `${bubble.className} dsh-better-display__user-markdown`
    bubble.after(twin)
    bubble.setAttribute('data-better-display-replaced', '')
    setTarget(twin)
    return () => {
      twin.remove()
      bubble.removeAttribute('data-better-display-replaced')
      setTarget(null)
    }
  }, [text])
  return (
    <div ref={host} className="dsh-better-display__user">
      <Builtin {...props} />
      {target !== null && createPortal(<MarkstreamMarkdown text={hardBreaks(text)} streaming={false} />, target)}
    </div>
  )
}

/**
 * Renderer for the `user` / `steering` keys of `conversation.chat.node`.
 * @param builtin - the built-in renderer for a node kind (shadowed by this one).
 */
export function createUserMessageView(builtin: (kind: string) => ComponentType<UserNodeProps> | undefined) {
  return memo(function BetterUserMessageView(props: UserNodeProps) {
    const enabled = useSyncExternalStore(userMarkdownSetting.subscribe, userMarkdownSetting.get, userMarkdownSetting.get)
    const Builtin = builtin(props.node.kind)
    const text = messageText(props)
    if (Builtin === undefined) {
      return <div className="dsh-better-display__user-fallback"><MarkstreamMarkdown text={hardBreaks(text)} streaming={false} /></div>
    }
    const chips = (props.node.data.referenceLabels?.length ?? 0) > 0 || (props.node.data.skillNames?.length ?? 0) > 0
    if (!enabled || chips || !looksLikeMarkdown(text)) return <Builtin {...props} />
    return <RenderedBubble Builtin={Builtin} props={props} text={text} />
  })
}
