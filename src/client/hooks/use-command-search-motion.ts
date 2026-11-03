import { animate } from 'motion/mini';
import { type RefObject, useLayoutEffect, useRef } from 'react';

import { useMediaQuery } from '../media.ts';

interface SearchPart {
  node: HTMLElement | SVGElement;
  properties: readonly (readonly [string, string])[];
  duration: number;
}

function parts(host: HTMLElement, compact: boolean): SearchPart[] {
  const field = host.querySelector<HTMLElement>('.command-field');
  if (!field) return [];
  const result: SearchPart[] = [{ node: field, properties: compact ? [['clip-path', 'clipPath']] : [['width', 'width']], duration: 0.24 }];
  const glyph = field.querySelector<SVGElement>(':scope > svg');
  const input = field.querySelector('input');
  if (glyph)
    result.push({ node: glyph, properties: compact ? [['translate', 'translate']] : [['transform', 'transform']], duration: 0.24 });
  const keycap = field.querySelector<HTMLElement>('.command-kbd');
  if (keycap) result.push({ node: keycap, properties: [['opacity', 'opacity']], duration: 0.12 });
  if (!compact) return result;
  if (input) result.push({ node: input, properties: [['opacity', 'opacity']], duration: 0.16 });
  for (const node of host
    .closest('.index-head')
    ?.querySelectorAll<HTMLElement>('.index-identity, .topbar-actions > :not(.command-search)') ?? [])
    result.push({
      node,
      properties: [
        ['opacity', 'opacity'],
        ['translate', 'translate'],
      ],
      duration: 0.16,
    });
  return result;
}

/** Search keeps its original DOM, focus and responsive CSS geometry; Motion interpolates the measured poses. */
export function useCommandSearchMotion(host: RefObject<HTMLElement | null>, compact: boolean, typing: boolean, hasValue: boolean) {
  const saved = useRef(new Map<Element, Record<string, string>>());
  const last = useRef({ at: Number.NEGATIVE_INFINITY, compact, typing, hasValue });
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  useLayoutEffect(() => {
    if (!host.current) return;
    const now = performance.now();
    const changed = typing !== last.current.typing || hasValue !== last.current.hasValue;
    const instant = reduced || compact !== last.current.compact || (changed && now - last.current.at < 120);
    last.current = { at: changed ? now : last.current.at, compact, typing, hasValue };
    const animations: ReturnType<typeof animate>[] = [];
    let active = true;
    for (const { node, properties, duration } of parts(host.current, compact)) {
      for (const [css] of properties) node.style.removeProperty(css);
      node.style.removeProperty('visibility');
      const computed = getComputedStyle(node);
      const target = Object.fromEntries(properties.map(([css, key]) => [key, computed.getPropertyValue(css)]));
      const previous = saved.current.get(node);
      saved.current.set(node, target);
      if (instant || !previous || typeof node.animate !== 'function') continue;
      if (Object.entries(target).every(([key, value]) => previous[key] === value)) continue;
      const visibility = computed.visibility;
      node.style.visibility = 'visible';
      const frames = Object.fromEntries(Object.entries(target).map(([key, value]) => [key, [previous[key] ?? value, value]]));
      const controls = animate([node], frames, { duration, ease: 'easeOut' });
      animations.push(controls);
      void controls.then(() => {
        if (active) node.style.visibility = visibility;
      });
    }
    return () => {
      active = false;
      for (const animation of animations) animation.cancel();
    };
  }, [compact, hasValue, host, reduced, typing]);
}
