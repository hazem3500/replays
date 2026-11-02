import { type RefObject, useEffect } from 'react';

/** Scrolls `element` into view (nearest edge) when `reveal` turns on: a lane just given content by a key or a menu. */
export function useReveal(element: RefObject<HTMLElement | null>, reveal: boolean) {
  useEffect(() => {
    if (reveal) element.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [element, reveal]);
}
