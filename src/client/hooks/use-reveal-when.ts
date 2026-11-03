import { type RefObject, useEffect } from 'react';

/** Scrolls the element into view, nearest edge only, each time `reveal` turns true. */
export function useRevealWhen(target: RefObject<HTMLElement | null>, reveal: boolean) {
  useEffect(() => {
    if (reveal) target.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [target, reveal]);
}
