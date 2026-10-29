import { type PointerEvent as ReactPointerEvent, useRef, useState } from 'react';

export interface BrushRange {
  from: number;
  to: number;
}

/** Below this a press is a click, not a drag. */
const DRAG_PX = 4;

/**
 * Pointer handling for a strip that maps x to time over `span` ms: a click calls `onClick(time)`; a drag shows a live
 * `brush` and ends in `onRange`. Pointer capture keeps the drag going outside the strip.
 */
export function useRibbonBrush(span: number, onClick: (time: number) => void, onRange: (range: BrushRange) => void) {
  const drag = useRef<{ x: number; left: number; width: number; from: number } | null>(null);
  const [brush, setBrush] = useState<BrushRange | null>(null);
  const timeAt = (clientX: number, left: number, width: number) =>
    Math.min(span, Math.max(0, ((clientX - left) / Math.max(1, width)) * span));
  const cancel = () => {
    drag.current = null;
    setBrush(null);
  };
  return {
    brush,
    handlers: {
      onPointerDown(event: ReactPointerEvent<HTMLElement>) {
        if (event.button !== 0) return;
        const box = event.currentTarget.getBoundingClientRect();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, left: box.left, width: box.width, from: timeAt(event.clientX, box.left, box.width) };
      },
      onPointerMove(event: ReactPointerEvent<HTMLElement>) {
        const start = drag.current;
        if (!start || Math.abs(event.clientX - start.x) < DRAG_PX) return;
        const to = timeAt(event.clientX, start.left, start.width);
        setBrush({ from: Math.min(start.from, to), to: Math.max(start.from, to) });
      },
      onPointerUp(event: ReactPointerEvent<HTMLElement>) {
        const start = drag.current;
        cancel();
        if (!start) return;
        if (Math.abs(event.clientX - start.x) < DRAG_PX) onClick(start.from);
        else if (brush) onRange(brush);
      },
      onPointerCancel: cancel,
    },
  };
}
