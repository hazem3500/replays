import { animate } from 'motion/mini';
import { type RefObject, useEffect } from 'react';

import { useMediaQuery } from '../media.ts';

/** The mark's small hover lean composes with its independent scrub transform. */
export function useIndexMarkHover(button: RefObject<HTMLButtonElement | null>, svg: RefObject<SVGSVGElement | null>) {
  const enabled = useMediaQuery('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)');
  useEffect(() => {
    const element = button.current;
    const playhead = svg.current?.querySelector<SVGElement>('.mark-playhead');
    if (!element || !playhead || !enabled) return;
    let current: ReturnType<typeof animate> | undefined;
    const change = (over: boolean) => {
      const from = getComputedStyle(playhead).translate;
      current?.cancel();
      current = animate(
        [playhead],
        { translate: [from === 'none' ? '0px 0px' : from, over ? '0.5px 0px' : '0px 0px'] },
        { duration: 0.15, ease: 'easeOut' },
      );
    };
    const enter = () => change(true);
    const leave = () => change(false);
    element.addEventListener('pointerenter', enter);
    element.addEventListener('pointerleave', leave);
    return () => {
      element.removeEventListener('pointerenter', enter);
      element.removeEventListener('pointerleave', leave);
      current?.cancel();
      playhead.style.removeProperty('translate');
    };
  }, [button, svg, enabled]);
}
