import { useLayoutEffect, useRef } from 'react';
import { animate } from 'motion/mini';

import { useMediaQuery } from '../media.ts';
import { pageTransitionRunning, swappingInPlace } from '../transitions/state.ts';

function initialIdentity(last: { text: string; at: number } | null, from: string | undefined, title: string) {
  return !last && (!from || from === title);
}

/** Fades the current title and status together; rapid changes replace an in-flight fade instead of queuing it. */
export function useTopbarIdentityMotion(from: string | undefined, title: string) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const previous = useRef<{ text: string; at: number } | null>(null);
  const animation = useRef<ReturnType<typeof animate> | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const text = element.textContent ?? '';
    const last = previous.current;
    if (reduced) animation.current?.cancel();
    if (last?.text === text) return;
    const now = performance.now();
    previous.current = { text, at: now };
    animation.current?.cancel();
    const rapid = last && now - last.at < 120;
    if (
      reduced ||
      rapid ||
      pageTransitionRunning() ||
      swappingInPlace() ||
      initialIdentity(last, from, title) ||
      typeof element.animate !== 'function'
    )
      return;
    animation.current = animate([element], { opacity: [0, 1] }, { duration: 0.16, ease: 'easeOut' });
  });

  useLayoutEffect(() => () => animation.current?.cancel(), []);
  return ref;
}
