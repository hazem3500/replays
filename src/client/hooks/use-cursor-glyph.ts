import { useEffect, useRef } from 'react';

import type { CursorGlyph, CursorTheme } from '../cursor-themes.ts';

interface Mounted {
  glyph: CursorGlyph;
  frame?: number | undefined;
}

const mountedGlyphs = new WeakMap<Element, Mounted>();

/** The preview hop in, then the theme's own click feedback (the player's press window). */
const HOP_MS = 300;
const FEEDBACK_MS = 550;

/**
 * Draws `theme`'s real glyph (the player's renderer) into the returned host span, redrawn when the theme or tint
 * changes. Lazy themes are left alone: a picker must not load a CUA theme's player just to preview it.
 */
export function useCursorGlyph(theme: CursorTheme, color: string | undefined, label: string) {
  const host = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const node = host.current;
    if (!node || theme.lazy) return;
    const glyph = theme.create({ document: node.ownerDocument, color: theme.tintable ? color : undefined, label });
    node.replaceChildren(...glyph.nodes);
    node.style.width = `${glyph.width}px`;
    node.style.height = `${glyph.height}px`;
    const mounted: Mounted = { glyph };
    mountedGlyphs.set(node, mounted);
    return () => {
      if (mounted.frame !== undefined) cancelAnimationFrame(mounted.frame);
      mountedGlyphs.delete(node);
      glyph.destroy?.();
      node.replaceChildren();
    };
  }, [theme, color, label]);
  return host;
}

/**
 * Plays a mounted preview once: the glyph hops in, then shows its click feedback. With `restart` false a play under
 * way is left to finish (hover); callers skip it under reduced motion and while the controls are disabled.
 */
export function playCursorGlyph(host: Element | null | undefined, restart: boolean) {
  const mounted = host ? mountedGlyphs.get(host) : undefined;
  if (!host || !mounted || typeof (host as HTMLElement).animate !== 'function') return;
  if (!restart && mounted.frame !== undefined) return;
  if (mounted.frame !== undefined) cancelAnimationFrame(mounted.frame);
  for (const animation of host.getAnimations()) animation.cancel();
  (host as HTMLElement).animate(
    [
      { translate: '-7px 5px', opacity: 0.4 },
      { translate: '0 0', opacity: 1 },
    ],
    { duration: HOP_MS, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' },
  );
  const start = performance.now();
  const tick = (now: number) => {
    const age = now - start - HOP_MS;
    mounted.glyph.feedback(age >= 0 && age < FEEDBACK_MS ? age : -1);
    mounted.frame = age < FEEDBACK_MS ? requestAnimationFrame(tick) : undefined;
  };
  mounted.frame = requestAnimationFrame(tick);
}
