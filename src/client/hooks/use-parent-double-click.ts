import { type RefObject, useEffect, useEffectEvent } from 'react';

/**
 * Calls `onDoubleClick` when the parent of `host` is double-clicked on top of `target` (a selector inside `host`). The
 * host itself stays `pointer-events: none`, so a single click goes through to whatever is underneath (the player).
 */
export function useParentDoubleClick(host: RefObject<HTMLElement | null>, target: string, onDoubleClick: (() => void) | undefined) {
  const run = useEffectEvent(() => onDoubleClick?.());
  const enabled = onDoubleClick !== undefined;
  useEffect(() => {
    const parent = host.current?.parentElement;
    if (!parent || !enabled) return;
    const listener = (event: MouseEvent) => {
      const rect = host.current?.querySelector(target)?.getBoundingClientRect();
      if (!rect || event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)
        return;
      event.preventDefault();
      run();
    };
    parent.addEventListener('dblclick', listener);
    return () => parent.removeEventListener('dblclick', listener);
  }, [enabled, host, target]);
}
