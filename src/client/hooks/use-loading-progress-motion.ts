import { animate } from 'motion/mini';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { useMediaQuery } from '../media.ts';

/** The loading delay is state, so disabling animation cannot prevent the hint appearing. */
export function useLoadingProgressMotion(share: number | undefined) {
  const [visible, setVisible] = useState(false);
  const track = useRef<HTMLSpanElement>(null);
  const bar = useRef<HTMLSpanElement>(null);
  const previous = useRef(share);
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), 1200);
    return () => window.clearTimeout(timer);
  }, []);
  useLayoutEffect(() => {
    const element = track.current;
    if (!element || !visible || reduced || typeof element.animate !== 'function') return;
    const animation = animate([element], { opacity: [0, 1] }, { duration: 0.24, ease: 'easeOut' });
    return () => animation.stop();
  }, [visible, reduced]);
  useLayoutEffect(() => {
    const element = bar.current;
    const from = previous.current;
    previous.current = share;
    if (!element) return;
    if (reduced || typeof element.animate !== 'function') {
      element.style.transform = share === undefined ? 'none' : `scaleX(${share})`;
      return;
    }
    if (!visible) return;
    const animation =
      share === undefined
        ? animate(
            [element],
            { transform: ['translateX(-100%)', 'translateX(360%)'] },
            {
              duration: 1.4,
              repeat: Infinity,
              ease: [0.45, 0, 0.55, 1],
            },
          )
        : animate(
            [element],
            { transform: [`scaleX(${from ?? share})`, `scaleX(${share})`] },
            {
              duration: 0.2,
              ease: [0.23, 1, 0.32, 1],
            },
          );
    return () => animation.stop();
  }, [share, visible, reduced]);
  return { track, bar, visible };
}

/** Animates known progress without replacing Base UI's accessible value model. */
export function useProgressValueMotion(value: number | undefined) {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef(value);
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  useLayoutEffect(() => {
    const element = ref.current;
    const from = previous.current;
    previous.current = value;
    if (!element || value === undefined) return;
    if (from === undefined || reduced || typeof element.animate !== 'function') {
      element.style.width = `${value}%`;
      return;
    }
    const animation = animate(
      [element],
      { width: [`${from}%`, `${value}%`] },
      {
        duration: 0.2,
        ease: [0.23, 1, 0.32, 1],
      },
    );
    return () => animation.stop();
  }, [value, reduced]);
  return ref;
}
