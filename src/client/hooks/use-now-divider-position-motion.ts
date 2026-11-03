import { animate } from 'motion/mini';
import { useLayoutEffect, useRef, type RefObject } from 'react';

interface DividerPosition {
  shown: number;
  reached: number;
  playing: boolean;
  viewTop: number;
  viewHeight: number;
  pinned: boolean;
  dragging: boolean;
}

interface DividerSprings {
  y: { stop: () => void; set: (value: number, instant?: boolean) => void };
}

/** Adjacent playback boundaries retain a short UI glide; seeks and direct manipulation land exactly. */
export function useNowDividerPositionMotion(
  line: RefObject<HTMLDivElement | null>,
  drag: RefObject<unknown>,
  springs: RefObject<DividerSprings | undefined>,
  { shown, reached, playing, viewTop, viewHeight, pinned, dragging }: DividerPosition,
) {
  const previous = useRef({ shown: -1, reached, viewTop: 0, viewHeight: 0 });
  const running = useRef<ReturnType<typeof animate> | null>(null);
  const cancel = () => {
    running.current?.stop();
    running.current = null;
  };
  useLayoutEffect(() => {
    const element = line.current;
    const last = previous.current;
    const position = springs.current?.y;
    if (!element || !position || drag.current || dragging) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const steps = Math.abs(reached - last.reached);
    const glide =
      last.shown >= 0 &&
      playing &&
      steps > 0 &&
      steps <= 3 &&
      viewTop === last.viewTop &&
      viewHeight === last.viewHeight &&
      !pinned &&
      !reduced.matches;
    const from = getComputedStyle(element).transform;
    const to = `translateY(${shown.toFixed(1)}px)`;
    position.stop();
    position.set(shown, true);
    previous.current = { shown, reached, viewTop, viewHeight };
    if (!glide || typeof element.animate !== 'function') return;
    const controls = animate([element], { transform: [from, to] }, { duration: 0.15, ease: [0.22, 1, 0.36, 1] });
    running.current = controls;
    const finish = () => {
      if (!reduced.matches) return;
      controls.stop();
      position.set(shown, true);
    };
    reduced.addEventListener('change', finish);
    return () => {
      reduced.removeEventListener('change', finish);
      controls.stop();
      if (running.current === controls) running.current = null;
    };
  }, [line, drag, springs, shown, reached, playing, viewTop, viewHeight, pinned, dragging]);
  return cancel;
}
