import { useEffect } from 'react';
import type { RefObject } from 'react';
import { focusReturn, trapFocus } from '@hazem3500/replays/recorder/kit';
export function useDialogFocus(root: RefObject<HTMLDivElement | null>, onCancel: () => void): void {
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const previous = focusReturn();
    const release = trapFocus(node);
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCancel();
      }
    };
    node.addEventListener('keydown', key);
    node.querySelector<HTMLElement>('[data-initial-focus]')?.focus();
    return () => {
      node.removeEventListener('keydown', key);
      release();
      previous.restore();
    };
  }, [root, onCancel]);
}
