import { animate } from 'motion/mini';
import { useLayoutEffect, useRef } from 'react';

/** Region handles follow hover, focus and selection without introducing React renders during pointer movement. */
export function useRegionFeedback(selected: boolean) {
  const element = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = element.current;
    if (!root) return;
    const controls = new Map<Element, ReturnType<typeof animate>>();
    let focused = root.contains(document.activeElement);
    let hovered = matchMedia('(hover: hover) and (pointer: fine)').matches && root.matches(':hover');
    const update = () => {
      const target = selected || focused || hovered ? 1 : 0;
      const instant =
        document.documentElement.hasAttribute('data-timeline-dragging') || matchMedia('(prefers-reduced-motion: reduce)').matches;
      for (const node of root.querySelectorAll<HTMLElement>('.tl-region-edge-mark, .tl-region-remove')) {
        const from = getComputedStyle(node).opacity;
        // invariant: never animate or stop an element that is not rendered (a short clip hides its ×); Motion's stop
        // commits styles and throws on it, which took the whole editor down.
        const rendered = node.getClientRects().length > 0;
        if (rendered) controls.get(node)?.stop();
        controls.delete(node);
        if (!rendered || instant || typeof node.animate !== 'function') node.style.setProperty('opacity', String(target));
        else controls.set(node, animate([node], { opacity: [Number(from), target] }, { duration: 0.16, ease: [0.23, 1, 0.32, 1] }));
      }
    };
    const enter = () => {
      hovered = matchMedia('(hover: hover) and (pointer: fine)').matches;
      update();
    };
    const leave = () => {
      hovered = false;
      update();
    };
    const focus = () => {
      focused = true;
      update();
    };
    const blur = (event: FocusEvent) => {
      focused = event.relatedTarget instanceof Node && root.contains(event.relatedTarget);
      update();
    };
    root.addEventListener('pointerenter', enter);
    root.addEventListener('pointerleave', leave);
    root.addEventListener('focusin', focus);
    root.addEventListener('focusout', blur);
    update();
    return () => {
      root.removeEventListener('pointerenter', enter);
      root.removeEventListener('pointerleave', leave);
      root.removeEventListener('focusin', focus);
      root.removeEventListener('focusout', blur);
      for (const [node, animation] of controls) if (node.getClientRects().length > 0) animation.stop();
    };
  }, [selected]);
  return element;
}
