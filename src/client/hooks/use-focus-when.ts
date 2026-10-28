import { type RefObject, useEffect } from 'react';

/** Moves focus to the referenced element each time `active` turns on, without scrolling the page. */
export function useFocusWhen(target: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (active) target.current?.focus({ preventScroll: true });
  }, [active, target]);
}
