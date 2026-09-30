/** Pure helpers for inline citation markers such as `[1](https://example.com "Title")`. */

/** One cited source, deduplicated by URL in order of first appearance. */
export interface Citation {
  /** Label the model used for the first occurrence (e.g. `1`). */
  label: string
  url: string
  title?: string | undefined
  host: string
}

const LABEL_PATTERN = /^\[?\^?(\d{1,3})\]?$/
// [n](url) / [[n]](url) / [^n](url), optional "title"; url stops at whitespace or `)`.
const CITATION_PATTERN = /\[\[?\^?(\d{1,3})\]?\]\((https?:\/\/[^\s)]+)(?:\s+"([^"]*)")?\)/g

/**
 * Return the numeric label when a link's visible text is a citation marker.
 * @param text - link text as rendered.
 */
export function citationLabel(text: string): string | undefined {
  return LABEL_PATTERN.exec(text.trim())?.[1]
}

/** Accept only http(s) targets for citations. */
export function safeHttpUrl(url: string): string | undefined {
  try {
    const protocol = new URL(url).protocol
    return protocol === 'http:' || protocol === 'https:' ? url : undefined
  } catch {
    return undefined
  }
}

/** Host name without a leading `www.`, or the raw input when it cannot be parsed. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/**
 * Collect citation markers from assistant Markdown.
 * @param text - assistant Markdown source.
 * @returns unique sources in order of first appearance.
 */
export function extractCitations(text: string): Citation[] {
  const byUrl = new Map<string, Citation>()
  for (const match of text.matchAll(CITATION_PATTERN)) {
    const [, label, rawUrl, title] = match
    if (label === undefined || rawUrl === undefined) continue
    const url = safeHttpUrl(rawUrl)
    if (url === undefined) continue
    const existing = byUrl.get(url)
    if (existing !== undefined) {
      if (existing.title === undefined && title) existing.title = title
      continue
    }
    byUrl.set(url, { label, url, title: title || undefined, host: hostOf(url) })
  }
  return [...byUrl.values()]
}

