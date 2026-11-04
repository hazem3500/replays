// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';

import { ReplayCursor } from '../src/client/replay-cursor.ts';

const events = [
  { type: 4, timestamp: 1000, data: { width: 800, height: 600 } },
  { type: 3, timestamp: 1100, data: { source: 1, positions: [{ x: 100, y: 100, timeOffset: 0 }] } },
  { type: 5, timestamp: 6000, data: { tag: 'end' } },
];

function fittedHost(fit: string | undefined, measuredWidth: number) {
  const host = document.createElement('div');
  const wrapper = document.createElement('div');
  host.append(wrapper);
  document.body.append(host);
  if (fit !== undefined) host.style.setProperty('--player-scale', fit);
  Object.defineProperty(wrapper, 'offsetWidth', { configurable: true, value: 100 });
  vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, measuredWidth, 60));
  return { host, wrapper };
}

describe('cursor fit in animated replay layouts', () => {
  it('ignores ancestor projection scale while preserving the saved cursor size', () => {
    const { host, wrapper } = fittedHost('0.5', 15);
    const cursor = new ReplayCursor(wrapper, events, 1000, { settings: { size: 1.5, hideWhenIdle: false, clickFeedback: false } });
    try {
      cursor.update(200);
      expect(wrapper.querySelector<HTMLElement>('.replay-cursor')?.style.transform).toContain('scale(3.0000)');
    } finally {
      cursor.destroy();
      host.remove();
      vi.restoreAllMocks();
    }
  });

  it('updates a paused cursor when its host fit changes without a replay time change', async () => {
    const { host, wrapper } = fittedHost('0.5', 50);
    const cursor = new ReplayCursor(wrapper, events, 1000, { settings: { hideWhenIdle: false, clickFeedback: false } });
    try {
      cursor.update(200);
      expect(wrapper.querySelector<HTMLElement>('.replay-cursor')?.style.transform).toContain('scale(2.0000)');
      host.style.setProperty('--player-scale', '0.25');
      await expect.poll(() => wrapper.querySelector<HTMLElement>('.replay-cursor')?.style.transform).toContain('scale(4.0000)');
    } finally {
      cursor.destroy();
      host.remove();
      vi.restoreAllMocks();
    }
  });

  it('uses a compact comparison cursor while retaining the saved size multiplier', () => {
    const { host, wrapper } = fittedHost('0.25', 25);
    host.style.setProperty('--player-cursor-size', '0.5625');
    const cursor = new ReplayCursor(wrapper, events, 1000, { settings: { hideWhenIdle: false, clickFeedback: false } });
    try {
      cursor.update(200);
      const glyph = wrapper.querySelector<HTMLElement>('.replay-cursor');
      expect(glyph?.style.width).toBe('32px');
      expect(glyph?.style.transform).toContain('scale(2.2500)');
      cursor.setSettings({ size: 1.5, hideWhenIdle: false, clickFeedback: false });
      expect(glyph?.style.transform).toContain('scale(3.3750)');
    } finally {
      cursor.destroy();
      host.remove();
      vi.restoreAllMocks();
    }
  });

  it('retains measured fit for standalone hosts without a published stage scale', () => {
    const { host, wrapper } = fittedHost(undefined, 50);
    const cursor = new ReplayCursor(wrapper, events, 1000, { settings: { hideWhenIdle: false, clickFeedback: false } });
    try {
      cursor.update(200);
      expect(wrapper.querySelector<HTMLElement>('.replay-cursor')?.style.transform).toContain('scale(2.0000)');
    } finally {
      cursor.destroy();
      host.remove();
      vi.restoreAllMocks();
    }
  });
});
