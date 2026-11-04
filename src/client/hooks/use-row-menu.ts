import { type KeyboardEvent, type MouseEvent, useState } from 'react';

import { isTypingTarget } from '../shortcuts.ts';

type Anchor = Element | { getBoundingClientRect(): DOMRect };

interface Opened {
  open: boolean;
  anchor: Anchor | undefined;
  returnTo: HTMLElement | null;
}

export interface RowMenuState extends Opened {
  onOpenChange(open: boolean): void;
  onContextMenu(event: MouseEvent<HTMLElement>): void;
  onKeyDown(event: KeyboardEvent<HTMLElement>): void;
}

const point = (x: number, y: number): Anchor => ({ getBoundingClientRect: () => DOMRect.fromRect({ x, y, width: 0, height: 0 }) });

/**
 * The state of a row's right-click menu. A right click or the keyboard's menu key opens it at the pointer (or on the
 * focused control); touch long-press, Shift + right click and text fields keep the browser's own menu. Escape returns
 * focus to the row's link.
 */
export function useRowMenu(): RowMenuState {
  const [state, setState] = useState<Opened>({ open: false, anchor: undefined, returnTo: null });
  return {
    ...state,
    onOpenChange: (open) => setState((current) => ({ ...current, open })),
    onContextMenu: (event) => {
      const { currentTarget, target, nativeEvent } = event;
      // invariant: menus and dialogs of the row are portalled out of it, yet their events still bubble through React.
      if (event.defaultPrevented || !(target instanceof HTMLElement) || !currentTarget.contains(target)) return;
      const pointerType = nativeEvent instanceof PointerEvent ? nativeEvent.pointerType : '';
      if (pointerType === 'touch' || window.matchMedia('(hover: none)').matches || isTypingTarget(target)) return;
      const fromKeyboard = event.button === 0 && !event.ctrlKey;
      if (event.shiftKey && !fromKeyboard) return;
      event.preventDefault();
      setState({
        open: true,
        anchor: fromKeyboard ? target : point(event.clientX, event.clientY),
        returnTo: fromKeyboard ? target : currentTarget.querySelector<HTMLElement>('.row-target'),
      });
    },
    onKeyDown: (event) => {
      const { currentTarget, target } = event;
      if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return;
      if (!(target instanceof HTMLElement) || !currentTarget.contains(target) || isTypingTarget(target)) return;
      event.preventDefault();
      setState({ open: true, anchor: target, returnTo: target });
    },
  };
}
