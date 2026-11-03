import { animate } from 'motion/mini';
import { type Dispatch, type SetStateAction, useLayoutEffect, useRef } from 'react';

import { useMediaQuery } from '../media.ts';

export interface TextTrack {
  text: string;
  out: string | undefined;
  at: number;
  id: number;
}

/** Motion owns the measured label width and both visual layers; the accessible name stays a single final string. */
export function useTextMotion(track: TextTrack, morphing: boolean, setTrack: Dispatch<SetStateAction<TextTrack>>) {
  const wrapper = useRef<HTMLSpanElement>(null);
  const restWidth = useRef(0);
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  useLayoutEffect(() => {
    const element = wrapper.current;
    if (!element) return;
    if (!morphing) {
      element.style.removeProperty('width');
      restWidth.current = element.getBoundingClientRect().width;
      return;
    }
    const finish = () => setTrack((current) => (current.id === track.id ? { ...current, out: undefined } : current));
    if (reduced || typeof element.animate !== 'function') {
      finish();
      return;
    }
    const incoming = element.querySelector<HTMLElement>('[data-in]');
    const outgoing = element.querySelector<HTMLElement>('[data-out]');
    if (!incoming || !outgoing) return;
    const transition = { duration: 0.18, ease: 'easeOut' } as const;
    const animations = [
      animate(
        [element],
        { width: [`${restWidth.current || outgoing.getBoundingClientRect().width}px`, `${incoming.getBoundingClientRect().width}px`] },
        transition,
      ),
      animate(
        [incoming],
        { opacity: [0, 1], transform: ['translateY(3px)', 'translateY(0)'], filter: ['blur(2px)', 'blur(0px)'] },
        transition,
      ),
      animate(
        [outgoing],
        { opacity: [1, 0], transform: ['translateY(0)', 'translateY(-3px)'], filter: ['blur(0px)', 'blur(2px)'] },
        transition,
      ),
    ];
    void animations[0]?.then(finish);
    return () => {
      for (const animation of animations) animation.cancel();
    };
  }, [morphing, reduced, setTrack, track.id]);
  return wrapper;
}
