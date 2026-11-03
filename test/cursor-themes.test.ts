// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';

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
      const glyph = theme.create(document);
      expect(glyph.hotspot.x).toBeGreaterThanOrEqual(0);
      expect(glyph.hotspot.x).toBeLessThanOrEqual(glyph.width);
      expect(glyph.hotspot.y).toBeGreaterThanOrEqual(0);
      expect(glyph.hotspot.y).toBeLessThanOrEqual(glyph.height);
    }
  });

  it('keeps the default arrow to the press squish, with no click ring', () => {
    expect(cursorTheme().id).toBe('arrow');
    expect(effectOf(cursorTheme('arrow').create(document).nodes)).toBeUndefined();
  });

  it('draws a ripple or pulse only while a press is under way', () => {
    for (const id of ['classic-arrow', 'hand', 'dot', 'ring'] as const) {
      const glyph = cursorTheme(id).create(document);
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

  it('draws the chosen click effect instead of the default of its style', () => {
    expect(effectOf(cursorTheme('arrow').create(document, { effect: 'ripple' }).nodes)).toBeDefined();
    expect(effectOf(cursorTheme('ring').create(document, { effect: 'press' }).nodes)).toBeUndefined();
  });

  it('tints the glyph with the saved color', () => {
    const path = cursorTheme('arrow').create(document, { color: '#1f7445' }).nodes[0]?.querySelector('path');
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

describe('cursor click feedback', () => {
  it('restores the same click frame after seeking and clears feedback when disabled or reduced', () => {
    for (const effect of ['ripple', 'pulse'] as const) {
      const host = document.createElement('div');
      const cursor = new ReplayCursor(host, events, 1000, { clickEffect: effect, hideWhenIdle: false });
      try {
        cursor.update(760);
        const element = host.querySelector<HTMLElement>('.replay-cursor')!;
        const feedback = element.querySelector<SVGElement>('svg[style*="position"]')!;
        const frame = feedback.outerHTML;
        const geometry = [element.style.width, element.style.height, element.style.marginLeft, element.style.marginTop];
        cursor.update(0);
        expect(feedback.style.display).toBe('none');
        cursor.update(3000);
        expect(feedback.style.display).toBe('none');
        cursor.update(760);
        expect(feedback.outerHTML).toBe(frame);
        expect([element.style.width, element.style.height, element.style.marginLeft, element.style.marginTop]).toEqual(geometry);
        cursor.setSettings({ clickEffect: effect, clickFeedback: false });
        expect(feedback.style.display).toBe('none');
        vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
        const reduced = new ReplayCursor(host, events, 1000, { clickEffect: effect });
        try {
          reduced.update(760);
          expect(host.lastElementChild?.querySelector<SVGElement>('svg[style*="position"]')?.style.display).toBe('none');
        } finally {
          reduced.destroy();
          vi.unstubAllGlobals();
        }
      } finally {
        cursor.destroy();
      }
    }
  });
});
