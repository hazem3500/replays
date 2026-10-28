import { useEffect, useState } from 'react';

export type Presence<T> = { item: T; exiting: boolean };

/**
 * Keeps items that left the list rendered, flagged `exiting`, at the index they left from, until their exit
 * transition calls `settle(id)` (from `transitionend`), or `fallbackMs` passes. Items are compared by `id`;
 * a changed `value` updates the item in place.
 */
export function usePresence<T extends { id: string; value: string }>(items: readonly T[], fallbackMs: number) {
  const signature = items.map((item) => `${item.id}=${item.value}`).join('|');
  const [state, setState] = useState(() => ({ signature, previous: items, exiting: [] as Array<{ item: T; index: number }> }));
  let { exiting } = state;
  if (state.signature !== signature) {
    // why: adjusting state during render (not in an effect) keeps a departed item on screen in this very frame.
    const ids = new Set(items.map((item) => item.id));
    const left = state.previous.flatMap((item, index) => (ids.has(item.id) ? [] : [{ item, index }]));
    exiting = [...state.exiting.filter((entry) => !ids.has(entry.item.id)), ...left];
    setState({ signature, previous: items, exiting });
  }
  const settle = (id?: string) =>
    setState((current) => ({ ...current, exiting: id ? current.exiting.filter((entry) => entry.item.id !== id) : [] }));
  const pending = exiting.length > 0;
  useEffect(() => {
    if (!pending) return;
    const clear = () => setState((current) => ({ ...current, exiting: [] }));
    // why: a transition can be held (a view transition pauses rendering) or never run (reduced motion); don't wait forever.
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      clear();
      return;
    }
    const timer = window.setTimeout(clear, fallbackMs);
    return () => window.clearTimeout(timer);
  }, [pending, fallbackMs]);
  const rendered = items.map((item): Presence<T> => ({ item, exiting: false }));
  for (const entry of exiting) rendered.splice(Math.min(entry.index, rendered.length), 0, { item: entry.item, exiting: true });
  return { rendered, settle };
}
