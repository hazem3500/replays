import { useEffect, useRef } from 'react';

import type { CursorTheme } from '../cursor-themes.ts';

/**
 * Draws `theme`'s real glyph (the player's renderer) into the returned host element, redrawn when the theme or tint
 * changes, so the picker shows exactly what the replay will.
 */
export function useCursorGlyph(theme: CursorTheme, color: string | undefined) {
  const host = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const glyph = theme.create(node.ownerDocument, color);
    node.replaceChildren(...glyph.nodes);
    node.style.width = `${glyph.width}px`;
    node.style.height = `${glyph.height}px`;
    return () => node.replaceChildren();
  }, [theme, color]);
  return host;
}
