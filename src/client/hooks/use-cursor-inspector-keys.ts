import { type RefObject, useEffect, useEffectEvent } from 'react';

/** Keeps cursor controls' keys out of the window-level editor shortcuts after React handles them. */
export function useCursorInspectorKeys(target: RefObject<HTMLElement | null>, embedded: boolean, onClose: () => void) {
  const handle = useEffectEvent((event: KeyboardEvent) => {
    if (!(event.target instanceof Node) || !target.current?.contains(event.target) || event.defaultPrevented) return;
    if (event.key === 'Escape' && !embedded) {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (!event.metaKey && !event.ctrlKey && !event.altKey) {
      event.stopPropagation();
    }
  });
  useEffect(() => {
    const document = target.current?.ownerDocument;
    if (!document) return;
    const listener = (event: KeyboardEvent) => handle(event);
    // why: document bubbling follows the controls' React handlers and precedes window-level shortcuts.
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, [target]);
}
