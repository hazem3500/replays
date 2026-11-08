import { useEffect, useRef } from 'react';

/** Opens secondary caption options without turning a touch hold into a toggle. */
export function useCaptionOptions(open: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const held = useRef(false);
  const origin = useRef({ x: 0, y: 0 });
  useEffect(() => () => clearTimeout(timer.current), []);
  const cancel = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
  };
  return {
    onContextMenu(event: React.MouseEvent) {
      event.preventDefault();
      cancel();
      open();
    },
    onKeyDown(event: React.KeyboardEvent) {
      if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
      event.preventDefault();
      event.stopPropagation();
      open();
    },
    onPointerDown(event: React.PointerEvent) {
      held.current = false;
      cancel();
      if (event.pointerType !== 'touch') return;
      origin.current = { x: event.clientX, y: event.clientY };
      timer.current = setTimeout(() => {
        held.current = true;
        open();
      }, 550);
    },
    onPointerMove(event: React.PointerEvent) {
      if (Math.hypot(event.clientX - origin.current.x, event.clientY - origin.current.y) > 10) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onClickCapture(event: React.MouseEvent) {
      if (!held.current) return;
      event.preventDefault();
      event.stopPropagation();
      held.current = false;
    },
  };
}
