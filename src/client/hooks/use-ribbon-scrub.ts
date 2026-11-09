import { type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject, useRef } from 'react';

import type { Playback } from '../playback/types.ts';

/** One arrow press moves the playhead this far. */
export const KEY_STEP_MS = 1000;

export function ribbonTimeAt(clientX: number, left: number, width: number, span: number): number {
  return Math.min(span, Math.max(0, ((clientX - left) / Math.max(1, width)) * span));
}

export function keyedTime(key: string, time: number, span: number): number | undefined {
  if (key === 'ArrowLeft') return Math.max(0, time - KEY_STEP_MS);
  if (key === 'ArrowRight') return Math.min(span, time + KEY_STEP_MS);
  if (key === 'Home') return 0;
  if (key === 'End') return span;
  return undefined;
}

type ScrubPlayer = Pick<Playback, 'seek' | 'beginScrub' | 'endScrub' | 'getTime'>;

/** Pointer and key handlers for the ribbon's playhead handle: a drag scrubs like the main seek bar. */
export function useRibbonScrub(player: ScrubPlayer, span: number, strip: RefObject<HTMLElement | null>) {
  const active = useRef<number | null>(null);
  const seekTo = (clientX: number) => {
    const box = strip.current?.getBoundingClientRect();
    if (box) player.seek(ribbonTimeAt(clientX, box.left, box.width, span));
  };
  const end = (event: ReactPointerEvent<HTMLElement>) => {
    if (active.current !== event.pointerId) return;
    active.current = null;
    player.endScrub();
  };
  return {
    onPointerDown(event: ReactPointerEvent<HTMLElement>) {
      if (event.button !== 0) return;
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      active.current = event.pointerId;
      player.beginScrub();
      seekTo(event.clientX);
    },
    onPointerMove(event: ReactPointerEvent<HTMLElement>) {
      if (active.current === event.pointerId) seekTo(event.clientX);
    },
    onPointerUp: end,
    onPointerCancel: end,
    onKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
      const next = keyedTime(event.key, player.getTime(), span);
      if (next === undefined) return;
      event.preventDefault();
      player.seek(next);
    },
  };
}
