import { animate } from 'motion/mini';
import { useImperativeHandle, useLayoutEffect, useRef, type Ref } from 'react';

/** Animate visual offsets while Base UI retains the live geometry used by drag, keyboard and accessibility. */
export function useSliderMotion(forwardedRef: Ref<HTMLDivElement> | undefined, kind: 'indicator' | 'thumb') {
  const element = useRef<HTMLDivElement>(null);
  useImperativeHandle(forwardedRef, () => {
    if (!element.current) throw new Error('Slider ref was read before mounting');
    return element.current;
  }, []);
  useLayoutEffect(() => {
    const node = element.current;
    const slider = node?.closest('[data-slot="slider"]');
    if (!node || !slider) return;
    const geometry = () => {
      const style = getComputedStyle(node);
      return { left: Number.parseFloat(style.left) || 0, width: Number.parseFloat(style.width) || 0 };
    };
    const baselineTransform = getComputedStyle(node).transform;
    const baseOffset = transformOffset(baselineTransform);
    const thumbTransform = (offset: number) => `${baselineTransform === 'none' ? '' : baselineTransform} translateX(${offset}px)`;
    let previous = geometry();
    let controls: ReturnType<typeof animate> | undefined;
    const observer = new MutationObserver(() => {
      const next = geometry();
      const instant = slider.hasAttribute('data-dragging') || matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (next.left === previous.left && next.width === previous.width && !instant) return;
      const offset = transformOffset(getComputedStyle(node).transform) - baseOffset;
      const scale = next.width > 0 ? node.getBoundingClientRect().width / next.width : 1;
      controls?.stop();
      controls = undefined;
      if (instant || typeof node.animate !== 'function') {
        const property = 'transform';
        const value = kind === 'thumb' ? baselineTransform : 'scaleX(1)';
        if (node.style.getPropertyValue(property) !== value) node.style.setProperty(property, value);
      } else if (kind === 'thumb') {
        controls = animate(
          [node],
          { transform: [thumbTransform(previous.left + offset - next.left), thumbTransform(0)] },
          { duration: 0.14, ease: 'easeOut' },
        );
      } else if (next.width > 0) {
        controls = animate(
          [node],
          { transform: [`scaleX(${(previous.width * scale) / next.width})`, 'scaleX(1)'] },
          { duration: 0.14, ease: 'easeOut' },
        );
      }
      previous = next;
    });
    observer.observe(slider, { subtree: true, attributes: true, attributeFilter: ['style', 'data-dragging'] });
    return () => {
      observer.disconnect();
      controls?.stop();
    };
  }, [kind]);
  return element;
}

function transformOffset(transform: string) {
  const matrix = /^matrix\(([^)]+)\)$/.exec(transform);
  if (matrix) return Number.parseFloat(matrix[1]?.split(',')[4] ?? '0') || 0;
  const translation = /translateX\((-?[\d.]+)px\)/.exec(transform);
  return Number.parseFloat(translation?.[1] ?? '0') || 0;
}
