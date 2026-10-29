/** Only delegate down the shadowing chain; never call a higher-ranked wrapper back. */
export interface InspectableEntry {
  component: unknown
  options: { key?: string, priority?: number }
  // These seats belong to the native entry; a nested React element cannot recreate them.
  inject?: unknown
  store?: unknown
  children?: unknown
}

/** React component values accepted by the native slot renderer (including memo/forwardRef). */
export function isSlotComponent(value: unknown): boolean {
  if (typeof value === 'function') return true
  if (typeof value !== 'object' || value === null) return false
  const tag = (value as { $$typeof?: unknown }).$$typeof
  return tag === Symbol.for('react.memo') || tag === Symbol.for('react.forward_ref') || tag === Symbol.for('react.lazy')
}

export function shadowedComponent(entries: readonly InspectableEntry[], priority: number, key?: string): unknown {
  return entries
    .filter(entry => entry.options.key === key && (entry.options.priority ?? 0) > priority && isSlotComponent(entry.component)
      && entry.inject === undefined && entry.store === undefined && entry.children === undefined)
    .sort((a, b) => (a.options.priority ?? 0) - (b.options.priority ?? 0))[0]?.component
}

interface ShadowSlots {
  entries?(name: string): readonly InspectableEntry[]
  subscribe?(name: string, listener: () => void): () => void
  register(options: { name: string, key?: string, priority?: number, locale?: string }, component: unknown): () => void
}

/** Wait for a usable native entry, and withdraw when it goes away. Owned by slots.inject. */
export function registerShadow(slots: ShadowSlots, options: { name: string, key?: string, priority: number, locale: string }, component: unknown): () => void {
  let dispose: (() => void) | undefined
  let closed = false
  const refresh = () => {
    if (closed) return
    const native = shadowedComponent(slots.entries?.(options.name) ?? [], options.priority, options.key)
    if (native !== undefined && dispose === undefined) dispose = slots.register(options, component)
    else if (native === undefined && dispose !== undefined) {
      const remove = dispose
      dispose = undefined
      remove()
    }
  }
  const unsubscribe = slots.subscribe?.(options.name, refresh)
  refresh()
  return () => {
    closed = true
    unsubscribe?.()
    dispose?.()
    dispose = undefined
  }
}
