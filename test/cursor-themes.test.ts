// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';

import { CURSOR_APPEARANCES } from '../src/shared/cursor.ts';
import { CURSOR_THEMES, cursorTheme } from '../src/client/cursor-themes.ts';
import { ReplayCursor } from '../src/client/replay-cursor.ts';

const effectOf = (nodes: Element[]) => nodes.find((node) => node instanceof SVGElement && node.style.position === 'absolute');

const events = [
  { type: 4, timestamp: 1000, data: { width: 800, height: 600 } },
  { type: 3, timestamp: 1100, data: { source: 1, positions: [{ x: 100, y: 100, timeOffset: 0 }] } },
  { type: 3, timestamp: 1700, data: { source: 2, type: 2, x: 100, y: 100 } },
];

describe('cursor themes', () => {
  it('offers a theme for every saved appearance, with its hotspot inside its box', () => {
    expect(CURSOR_THEMES.map((theme) => theme.id)).toEqual([...CURSOR_APPEARANCES]);
    for (const theme of CURSOR_THEMES) {
      const glyph = theme.create(document, undefined);
      expect(glyph.hotspot.x).toBeGreaterThanOrEqual(0);
      expect(glyph.hotspot.x).toBeLessThanOrEqual(glyph.width);
      expect(glyph.hotspot.y).toBeGreaterThanOrEqual(0);
      expect(glyph.hotspot.y).toBeLessThanOrEqual(glyph.height);
    }
  });

  it('keeps the default arrow to the press squish, with no click ring', () => {
    expect(cursorTheme(undefined).id).toBe('arrow');
    expect(effectOf(cursorTheme('arrow').create(document, undefined).nodes)).toBeUndefined();
  });

  it('draws a ripple or pulse only while a press is under way', () => {
    for (const id of ['classic-arrow', 'hand', 'dot', 'ring'] as const) {
      const glyph = cursorTheme(id).create(document, undefined);
      const effect = effectOf(glyph.nodes);
      if (!(effect instanceof SVGElement)) throw new Error(`${id} has no click effect`);
      glyph.feedback(-1);
      expect(effect.style.display).toBe('none');
      glyph.feedback(100);
      expect(effect.style.display).toBe('block');
      glyph.feedback(600);
      expect(effect.style.display).toBe('none');
    }
  });

  it('tints the glyph with the saved color', () => {
    const path = cursorTheme('arrow').create(document, '#1f7445').nodes[0]?.querySelector('path');
    expect(path?.style.fill).toBe('#1f7445');
  });

  it('draws the saved theme on the player and swaps it when settings change', () => {
    const host = document.createElement('div');
    const cursor = new ReplayCursor(host, events, 1000, { appearance: 'ring' });
    try {
      cursor.update(760);
      const element = host.querySelector<HTMLElement>('.replay-cursor');
      expect(host.querySelectorAll('.replay-cursor')).toHaveLength(1);
      expect(element?.querySelectorAll('circle').length).toBeGreaterThan(0);
      cursor.setSettings(undefined);
      expect(element?.querySelectorAll('circle')).toHaveLength(0);
      expect(element?.querySelectorAll('path')).toHaveLength(1);
    } finally {
      cursor.destroy();
    }
  });
});
