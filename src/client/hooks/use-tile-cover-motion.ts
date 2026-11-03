import { animate } from 'motion/mini';
import { useLayoutEffect, useRef } from 'react';

import { useMediaQuery } from '../media.ts';

/** The lightweight still hands over only after the iframe has painted. */
export function useTileCoverMotion(painted: boolean) {
  const cover = useRef<HTMLImageElement>(null);
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  useLayoutEffect(() => {
    const element = cover.current;
    if (!element) return;
    if (!painted) {
      element.hidden = false;
      element.style.opacity = '1';
      return;
    }
    if (element.hidden) return;
    if (reduced || typeof element.animate !== 'function') {
      element.style.opacity = '0';
      element.hidden = true;
      return;
    }
    const controls = animate([element], { opacity: [1, 0] }, { duration: reduced ? 0 : 0.16, ease: 'easeOut' });
    let live = true;
    void Promise.resolve(controls).then(() => {
      if (live) element.hidden = true;
    });
    return () => {
      live = false;
      controls.cancel();
    };
  }, [painted, reduced]);
  return cover;
}
