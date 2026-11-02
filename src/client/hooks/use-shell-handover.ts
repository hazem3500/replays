import { useLayoutEffect, useRef } from 'react';

const HANDOVER_DELAY_MS = 150;
const HANDOVER_MS = 700;
let handoverTimer = 0;

/**
 * Marks the document while a loading layout hands over to the ready page, so the page's regions arrive one by one
 * where their placeholders were (viewer-loading.css, `html[data-shell-handover]`) instead of the whole page at once.
 * Only when the loading layout was on screen past the skeleton delay: a fast load hands over with no motion.
 * `regions` names what the layout drew for each region (`steps`/`panel`: stand-ins that fade in from nothing;
 * `steps-data`/`panel-data`: real rows that only settle). Set in a layout-effect cleanup, i.e. in the commit that
 * mounts the ready page and before it paints.
 */
export function useShellHandover(regions: string) {
  const latest = useRef(regions);
  useLayoutEffect(() => {
    latest.current = regions;
  });
  useLayoutEffect(() => {
    const mounted = performance.now();
    return () => {
      if (performance.now() - mounted < HANDOVER_DELAY_MS) return;
      const root = document.documentElement;
      root.dataset.shellHandover = latest.current;
      window.clearTimeout(handoverTimer);
      handoverTimer = window.setTimeout(() => delete root.dataset.shellHandover, HANDOVER_MS);
    };
  }, []);
}
