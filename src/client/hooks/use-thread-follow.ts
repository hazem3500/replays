import { type RefObject, useEffect, useLayoutEffect, useRef } from 'react';

function scrollToThread(container: HTMLElement | null, id: string) {
  const item = container?.querySelector<HTMLElement>(`[data-thread-id="${CSS.escape(id)}"]`);
  if (!item || !container) return;
  const box = item.getBoundingClientRect();
  const view = container.getBoundingClientRect();
  if (box.top >= view.top && box.bottom <= view.bottom) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  container.scrollBy({ top: box.top - view.top - 8, behavior: reduce ? 'auto' : 'smooth' });
}

/**
 * Keeps the comments list on what matters: the thread at the playhead follows playback (once per thread, and never
 * while someone types a reply in the list), and a selected thread (marker click, permalink, a comment just written)
 * scrolls into view before paint. Items carry `data-thread-id`.
 */
export function useThreadFollow(container: RefObject<HTMLElement | null>, activeId: string | undefined, selectedId: string | undefined) {
  const followed = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!activeId || followed.current === activeId) return;
    followed.current = activeId;
    const focused = document.activeElement;
    if (focused?.tagName === 'TEXTAREA' && container.current?.contains(focused)) return;
    scrollToThread(container.current, activeId);
  }, [activeId, container]);
  useLayoutEffect(() => {
    if (selectedId) scrollToThread(container.current, selectedId);
  }, [selectedId, container]);
}
