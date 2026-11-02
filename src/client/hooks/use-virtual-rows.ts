import { useVirtualizer } from '@tanstack/react-virtual';
import type { RefObject } from 'react';

/**
 * The rows of a long list that are in view, for a list whose rows share one height. TanStack Virtual's instance is
 * mutable, so it stays inside this hook; callers get plain values for this render.
 */
export function useVirtualRows(scroller: RefObject<HTMLElement | null>, keys: readonly string[], rowHeight: number) {
  // oxlint-disable-next-line react/incompatible-library -- why: the virtualizer is a mutable instance the compiler can't memoise; only its plain outputs leave this hook.
  const virtualizer = useVirtualizer({
    count: keys.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => rowHeight,
    overscan: 8,
    getItemKey: (index) => keys[index] ?? index,
  });
  return {
    items: virtualizer.getVirtualItems().map((item) => ({ index: item.index, key: String(item.key), start: item.start })),
    totalSize: virtualizer.getTotalSize(),
    scrollToIndex: (index: number) => virtualizer.scrollToIndex(index, { align: 'auto' }),
  };
}
