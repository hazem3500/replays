import { type RefObject, useEffect, useState } from 'react';

/**
 * The dock's rendered height and its content's natural height (what it would take uncapped: its timeline scrolls
 * when the dock is capped). Kept current as lanes come and go and as the window resizes.
 */
export function useDockHeights(dock: RefObject<HTMLElement | null>, fallback: number) {
  const [heights, setHeights] = useState({ rendered: fallback, natural: fallback });
  useEffect(() => {
    const node = dock.current;
    if (!node) return;
    const measure = () => {
      const timeline = node.querySelector<HTMLElement>('.timeline');
      const rendered = Math.round(node.offsetHeight) || fallback;
      const natural = timeline ? rendered - timeline.clientHeight + timeline.scrollHeight : rendered;
      setHeights((current) => (current.rendered === rendered && current.natural === natural ? current : { rendered, natural }));
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(node);
    // why: a lane added while the dock is capped grows only the timeline's scroll height, which no box reports.
    const lanes = new MutationObserver(measure);
    lanes.observe(node, { childList: true, subtree: true });
    return () => {
      resize.disconnect();
      lanes.disconnect();
    };
  }, [dock, fallback]);
  return heights;
}
