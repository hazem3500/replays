import { animate } from 'motion/mini';
import { useLayoutEffect, useRef } from 'react';

import type { CaptionPresence } from './use-caption-presence.ts';
import { CAPTION_MOVE_MS } from './use-caption-presence.ts';
import { useMediaQuery } from '../media.ts';

function captionDuration(active: boolean, reduced: boolean) {
  if (reduced) return 0;
  return active ? 0.2 : CAPTION_MOVE_MS / 1000;
}

function captionDrop(element: HTMLElement) {
  const pill = element.querySelector('.step-caption-text');
  const scale = pill ? (Number.parseFloat(getComputedStyle(pill).fontSize) || 15) / 15 : 1;
  return 4 * scale;
}

/** Only the browser caption's appearance uses wall-clock motion; its content still follows replay time. */
export function useCaptionMotion(caption: CaptionPresence) {
  const ref = useRef<HTMLDivElement>(null);
  const appearance = useRef<number | undefined>(undefined);
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const { active, appearance: currentAppearance } = caption;
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const drop = captionDrop(element);
    if (typeof element.animate !== 'function') {
      element.style.opacity = active ? '1' : '0';
      element.style.transform = 'none';
      return;
    }
    if (active && appearance.current !== currentAppearance) {
      element.style.opacity = '0';
      element.style.transform = reduced ? 'none' : `translateY(${drop}px)`;
    }
    appearance.current = currentAppearance;
    const animation = animate(
      [element],
      {
        opacity: active ? 1 : 0,
        transform: reduced || active ? 'translateY(0px)' : `translateY(${drop}px)`,
      },
      { duration: captionDuration(active, reduced), ease: [0.23, 1, 0.32, 1] },
    );
    return () => animation.stop();
  }, [active, currentAppearance, reduced]);
  return ref;
}

/** A line swap stays in its stable accessible host without per-character animation work. */
export function useCaptionTextMotion(reduced: boolean) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (reduced || typeof element.animate !== 'function') {
      element.style.removeProperty('opacity');
      element.style.removeProperty('transform');
      return;
    }
    const drop = ((Number.parseFloat(getComputedStyle(element).fontSize) || 15) * 2) / 15;
    const animation = animate(
      [element],
      { opacity: [0, 1], transform: [`translateY(${drop}px)`, 'translateY(0px)'] },
      {
        duration: 0.16,
        ease: [0.23, 1, 0.32, 1],
      },
    );
    return () => animation.stop();
  }, [reduced]);
  return ref;
}
