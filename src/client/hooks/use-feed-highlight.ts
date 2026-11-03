import { animate } from 'motion/mini';
import { type RefObject, useEffect } from 'react';

import { useMediaQuery } from '../media.ts';

/** Router and upload markers share a Motion highlight without replacing the link's immediate focus ring. */
export function useFeedHighlight(root: RefObject<HTMLElement | null>) {
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const running = new Map<Element, ReturnType<typeof animate>>();
    const reveal = (item: Element) => {
      const glow = item.querySelector<HTMLElement>(':scope > .feed-highlight');
      const arrived = item.hasAttribute('data-arrived');
      if (!glow || (!arrived && !item.hasAttribute('data-returned'))) return;
      running.get(item)?.cancel();
      if (reduced) {
        glow.style.opacity = '0';
        return;
      }
      const controls = animate([glow], { opacity: [1, 0] }, { duration: arrived ? 1.2 : 0.9, delay: arrived ? 0.2 : 0.3, ease: 'easeOut' });
      running.set(item, controls);
      void Promise.resolve(controls).then(() => {
        if (running.get(item) === controls) running.delete(item);
      });
    };
    const selector = '.feed-item:is([data-returned], [data-arrived])';
    for (const item of element.querySelectorAll(selector)) reveal(item);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'attributes' && record.target instanceof Element) reveal(record.target);
        for (const added of record.addedNodes) {
          if (!(added instanceof Element)) continue;
          if (added.matches(selector)) reveal(added);
          for (const item of added.querySelectorAll(selector)) reveal(item);
        }
      }
    });
    observer.observe(element, { attributes: true, attributeFilter: ['data-returned', 'data-arrived'], childList: true, subtree: true });
    return () => {
      observer.disconnect();
      for (const controls of running.values()) controls.cancel();
    };
  }, [root, reduced]);
}
