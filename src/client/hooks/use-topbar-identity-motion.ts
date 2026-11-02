import { useLayoutEffect, useRef } from 'react';

import { useMediaQuery } from '../media.ts';

/** Fades the current title and status together; rapid changes replace an in-flight fade instead of queuing it. */
export function useTopbarIdentityMotion(from: string | undefined, title: string) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const previous = useRef<{ text: string; at: number } | undefined>(undefined);
  const animation = useRef<Animation | undefined>(undefined);

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
    if (reduced || rapid || (!last && (!from || from === title)) || typeof element.animate !== 'function') return;
    animation.current = element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' });
  });

  useLayoutEffect(() => () => animation.current?.cancel(), []);
  return ref;
}
