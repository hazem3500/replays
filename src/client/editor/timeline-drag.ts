import { createContext, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, useContext } from 'react';

/** Pointer travel before a press becomes a drag (below it, a press is a click: seek or select). */
const DRAG_PX = 3;
/** Arrow keys move an edge or a region by this much; Shift by NUDGE_LONG_MS. */
export const NUDGE_MS = 100;
export const NUDGE_LONG_MS = 1000;

/** The track's scale, shared by every lane: original ms ↔ px in the track column. */
export interface TimelineScale {
  duration: number;
  /** Usable px (the column minus PAD on both sides). */
  width: number;
  x(time: number): number;
  /** Original ms under a pointer's clientX. */
  timeAt(clientX: number): number;
}

export const ScaleContext = createContext<TimelineScale | null>(null);
export function useTimelineScale() {
  const scale = useContext(ScaleContext);
  if (!scale) throw new Error('useTimelineScale outside <Timeline>');
  return scale;
}

/**
 * A pointer drag on the window (so it keeps going outside the element): `move` gets the time under the pointer and
 * whether this is the first move of the drag (a new undo step) ; `end` says whether it moved at all (a click if not).
 */
export function startDrag(
  event: ReactPointerEvent,
  scale: TimelineScale,
  handlers: { move?: (time: number, first: boolean) => void; end?: (moved: boolean, time: number) => void },
) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  const startX = event.clientX;
  let moved = false;
  const onMove = (next: PointerEvent) => {
    if (!moved && Math.abs(next.clientX - startX) < DRAG_PX) return;
    const first = !moved;
    moved = true;
    handlers.move?.(scale.timeAt(next.clientX), first);
  };
  const onEnd = (next: PointerEvent) => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onEnd);
    window.removeEventListener('pointercancel', onEnd);
    document.documentElement.removeAttribute('data-timeline-dragging');
    handlers.end?.(moved, scale.timeAt(next.clientX));
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onEnd);
  window.addEventListener('pointercancel', onEnd);
  document.documentElement.setAttribute('data-timeline-dragging', '');
}

/** Arrow keys (Shift: longer), Home and End on a time control; `set` gets the new time. */
export function timeKeys(
  event: ReactKeyboardEvent,
  { value, min, max }: { value: number; min: number; max: number },
  set: (time: number) => void,
) {
  const step = event.shiftKey ? NUDGE_LONG_MS : NUDGE_MS;
  let next: number | undefined;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = value - step;
  else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = value + step;
  else if (event.key === 'Home') next = min;
  else if (event.key === 'End') next = max;
  if (next === undefined) return;
  event.preventDefault();
  event.stopPropagation();
  set(Math.min(max, Math.max(min, next)));
}
