import { animate } from 'motion/mini';
import { useImperativeHandle, useLayoutEffect, useRef, type Ref } from 'react';

/** Base UI supplies geometry; Motion interpolates only the indicator, never the tabs or their hit targets. */
export function useTabIndicatorMotion(forwardedRef: Ref<HTMLSpanElement> | undefined) {
  const element = useRef<HTMLSpanElement>(null);
  useImperativeHandle(forwardedRef, () => {
    if (!element.current) throw new Error('Tab indicator ref was read before mounting');
    return element.current;
  }, []);
  useLayoutEffect(() => {
    const node = element.current;
    if (!node) return;
    const geometry = () => {
      const style = getComputedStyle(node);
      return {
        left: style.getPropertyValue('--active-tab-left').trim() || '0px',
        width: style.getPropertyValue('--active-tab-width').trim() || '0px',
      };
    };
    let previous = geometry();
    let controls: ReturnType<typeof animate> | undefined;
    const observer = new MutationObserver(() => {
      const next = geometry();
      if (next.left === previous.left && next.width === previous.width) return;
      const current = getComputedStyle(node);
      const moving = controls?.state === 'running' || controls?.state === 'paused';
      const fromTranslate = moving ? current.translate : `${previous.left} 0`;
      const fromWidth = moving ? current.width : previous.width;
      controls?.stop();
      const place = () => {
        node.style.setProperty('translate', `${next.left} 0`);
        node.style.setProperty('width', next.width);
      };
      // why: the first geometry after mount is the indicator's placement, not a move (a run swap remounts the tabs).
      const placing = previous.width === '0px';
      if (
        placing ||
        typeof node.animate !== 'function' ||
        node.closest('[data-instant-switch]') ||
        matchMedia('(prefers-reduced-motion: reduce)').matches
      ) {
        place();
      } else {
        controls = animate(
          [node],
          { translate: [fromTranslate, `${next.left} 0`], width: [fromWidth, next.width] },
          { duration: 0.18, ease: [0.23, 1, 0.32, 1] },
        );
      }
      previous = next;
    });
    observer.observe(node, { attributes: true, attributeFilter: ['style'] });
    return () => {
      observer.disconnect();
      controls?.stop();
    };
  }, []);
  return element;
}
