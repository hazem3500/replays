import { animate } from 'motion/mini';
import { cancelFrame, frame } from 'motion';
import { type RefObject, useEffect, useLayoutEffect, useRef } from 'react';

import { useMediaQuery } from '../media.ts';

function posterAlpha(image: boolean, element: HTMLElement) {
  if (!image) return 0;
  return element.classList.contains('back-poster') ? 0.85 : 1;
}

/** Poster media keeps its fade independent of the card's hover and thumbnail-plane transforms. */
export function usePosterMotion(phase: 'loading' | 'ready' | 'none') {
  const root = useRef<HTMLSpanElement>(null);
  const alpha = useRef(new WeakMap<HTMLElement, number>());
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const previousAlpha = alpha.current;
    const image = element.querySelector<HTMLImageElement>(':scope > img');
    const placeholder = element.querySelector<HTMLElement>(':scope > .poster-placeholder');
    const targets = [image, placeholder].filter((target) => target !== null);
    const animations: ReturnType<typeof animate>[] = [];
    for (const target of targets) {
      const isImage = target === image;
      let to = isImage ? 0 : 1;
      if (phase === 'ready') to = posterAlpha(isImage, element);
      const from = previousAlpha.get(target) ?? (isImage ? 0 : 1);
      if (reduced || from === to) target.style.opacity = String(to);
      else animations.push(animate([target], { opacity: [from, to] }, { duration: 0.2, ease: 'easeOut' }));
    }
    const breath = element.querySelector<HTMLElement>(':scope > .poster-breath');
    if (breath && !reduced)
      animations.push(
        animate([breath], { transform: ['translateX(-100%)', 'translateX(100%)'] }, { duration: 1.6, ease: 'easeInOut', repeat: Infinity }),
      );
    return () => {
      for (const target of targets) previousAlpha.set(target, Number(getComputedStyle(target).opacity || '0'));
      for (const animation of animations) animation.cancel();
    };
  }, [phase, reduced]);
  return root;
}

/** The media's readiness drives a Motion fade, while its time drives the progress value directly. */
export function usePreviewMotion(
  video: RefObject<HTMLVideoElement | null>,
  bar: RefObject<HTMLSpanElement | null>,
  shown: boolean,
  onHalf: () => void,
) {
  const progress = useRef<HTMLSpanElement>(null);
  const half = useRef(onHalf);
  useLayoutEffect(() => {
    half.current = onHalf;
  });
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  useLayoutEffect(() => {
    const targets = [video.current, progress.current].filter((target) => target !== null);
    if (targets.length === 0) return;
    const animation = animate(targets, { opacity: shown ? 1 : 0 }, { duration: reduced ? 0 : 0.16, ease: 'easeOut' });
    return () => animation.cancel();
  }, [video, shown, reduced]);
  useEffect(() => {
    if (!shown) return;
    let warmed = false;
    const tick = () => {
      const element = video.current;
      if (!element || !bar.current || !(element.duration > 0)) return;
      const position = element.currentTime / element.duration;
      bar.current.style.setProperty('transform', `scaleX(${position})`);
      if (!warmed && position > 0.5) {
        warmed = true;
        half.current();
      }
    };
    frame.update(tick, true);
    return () => cancelFrame(tick);
  }, [video, bar, shown]);
  return progress;
}
