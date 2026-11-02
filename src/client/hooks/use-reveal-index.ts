import { useLayoutEffect } from 'react';

/** Calls `reveal(index)` whenever `index` changes to a real row (a selection made elsewhere: a click, an error jump). */
export function useRevealIndex(index: number, reveal: (index: number) => void) {
  useLayoutEffect(() => {
    if (index >= 0) reveal(index);
    // oxlint-disable-next-line react/exhaustive-deps -- why: only a new index should scroll; `reveal` is a fresh closure each render.
  }, [index]);
}
