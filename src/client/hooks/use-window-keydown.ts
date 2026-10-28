import { useEffect, useEffectEvent } from 'react';

/** A window-level keydown handler that always sees the caller's latest render. */
export function useWindowKeydown(handler: (event: KeyboardEvent) => void) {
  const onKeyDown = useEffectEvent(handler);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
}
