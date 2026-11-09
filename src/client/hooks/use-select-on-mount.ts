import { type RefObject, useEffect } from 'react';

/** Focuses the input and selects its text once, when it appears. */
export function useSelectOnMount(target: RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    target.current?.focus({ preventScroll: true });
    target.current?.select();
  }, [target]);
}
