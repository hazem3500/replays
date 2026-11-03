import { animate } from 'motion/mini';
import { type RefObject, useLayoutEffect } from 'react';

import { useMediaQuery } from '../media.ts';

const FINE = '(hover: hover) and (pointer: fine)';

/** The entire run-strip target raises its segments without changing its hit area. */
export function useRunStripMotion(root: RefObject<HTMLButtonElement | null>) {
  const enabled = useMediaQuery(`${FINE} and (prefers-reduced-motion: no-preference)`);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element || !enabled) return;
    let controls: ReturnType<typeof animate> | undefined;
    const change = (over: boolean) => {
      controls?.stop();
      const segments = [...element.querySelectorAll<HTMLElement>('.run-seg')];
      if (!segments.length) return;
      controls = animate(segments, { transform: over ? 'scaleY(1.34)' : 'scaleY(1)' }, { duration: 0.16, ease: 'easeOut' });
    };
    const enter = () => change(true);
    const leave = () => change(false);
    element.addEventListener('pointerenter', enter);
    element.addEventListener('pointerleave', leave);
    return () => {
      element.removeEventListener('pointerenter', enter);
      element.removeEventListener('pointerleave', leave);
      controls?.cancel();
      for (const segment of element.querySelectorAll<HTMLElement>('.run-seg')) segment.style.removeProperty('transform');
    };
  }, [root, enabled]);
}

/** Base UI's highlighted state drives the menu arrow for pointer and keyboard users alike. */
export function useRunMenuArrowMotion(root: RefObject<SVGSVGElement | null>) {
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  useLayoutEffect(() => {
    const arrow = root.current;
    const item = arrow?.closest('[data-slot="dropdown-menu-item"]');
    if (!arrow || !item) return;
    let controls: ReturnType<typeof animate> | undefined;
    const update = () => {
      controls?.stop();
      controls = animate(
        [arrow],
        { transform: item.hasAttribute('data-highlighted') && !reduced ? 'translateX(2px)' : 'translateX(0px)' },
        { duration: reduced ? 0 : 0.15, ease: 'easeOut' },
      );
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(item, { attributes: true, attributeFilter: ['data-highlighted'] });
    return () => {
      observer.disconnect();
      controls?.cancel();
    };
  }, [root, reduced]);
}

/** Keep is revealed with its card's pointer or keyboard focus, including on touch and during saving. */
export function useKeepButtonMotion(root: RefObject<HTMLButtonElement | null>, mounted: boolean) {
  const fine = useMediaQuery(FINE);
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  useLayoutEffect(() => {
    const element = root.current;
    const card = element?.closest('.feed-item');
    if (!mounted || !element || !card) return;
    let controls: ReturnType<typeof animate> | undefined;
    const update = () => {
      const visible = !fine || card.matches(':hover, :focus-within');
      controls?.stop();
      const opacity = element.disabled ? 0.6 : 1;
      controls = animate([element], { opacity: visible ? opacity : 0 }, { duration: reduced ? 0 : 0.12, ease: 'easeOut' });
    };
    update();
    for (const event of ['pointerenter', 'pointerleave', 'focusin', 'focusout']) card.addEventListener(event, update);
    const observer = new MutationObserver(update);
    observer.observe(element, { attributes: true, attributeFilter: ['disabled'] });
    return () => {
      for (const event of ['pointerenter', 'pointerleave', 'focusin', 'focusout']) card.removeEventListener(event, update);
      observer.disconnect();
      controls?.cancel();
    };
  }, [root, fine, reduced, mounted]);
}
