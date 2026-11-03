import { useEffect, useState } from 'react';

import { useMediaQuery } from '../media.ts';
import { animatePanelLayout, cancelPanelMotion, type PanelAxis } from '../lib/panel-motion.ts';

/** Owns panel motion through component unmount while exposing a stable command for events and layout changes. */
export function usePanelMotion() {
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [scope] = useState(() => {
    const targets = new Set<HTMLElement>();
    return {
      animate: (target: HTMLElement, axis: PanelAxis) => {
        targets.add(target);
        animatePanelLayout(target, axis);
      },
      destroy: () => {
        for (const target of targets) cancelPanelMotion(target);
        targets.clear();
      },
    };
  });
  useEffect(() => {
    if (reduced) scope.destroy();
    return () => scope.destroy();
  }, [reduced, scope]);
  return scope.animate;
}
