import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ANIMATED_ICON_NAMES, AnimatedIcon } from '../src/client/components/animated-icon.tsx';
import { ANIMATED_ICONS } from '../src/client/components/animated-icon-data.ts';
import {
  COALESCE_MS,
  createIconPlayer,
  createKeyWatcher,
  PLAYING_ATTRIBUTE,
  type PlayerEnvironment,
} from '../src/client/components/animated-icon-player.ts';

function fakeTarget() {
  const attributes = new Map<string, string>();
  let flushes = 0;
  return {
    attributes,
    get flushes() {
      return flushes;
    },
    setAttribute: (name: string, value: string) => void attributes.set(name, value),
    removeAttribute: (name: string) => void attributes.delete(name),
    getBoundingClientRect: () => {
      flushes += 1;
      return {};
    },
  };
}

function fakeEnvironment(overrides: Partial<{ reduced: boolean; keyRepeatAt: number }> = {}) {
  let now = 10_000;
  const timers = new Map<number, { at: number; callback: () => void }>();
  let nextId = 1;
  const state = { reduced: overrides.reduced ?? false, keyRepeatAt: overrides.keyRepeatAt ?? Number.NEGATIVE_INFINITY };
  const environment: PlayerEnvironment = {
    reducedMotion: () => state.reduced,
    now: () => now,
    lastKeyRepeatAt: () => state.keyRepeatAt,
    setTimeout: (callback, ms) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, callback });
      return id;
    },
    clearTimeout: (handle) => void timers.delete(handle as number),
  };
  const advance = (ms: number) => {
    now += ms;
    for (const [id, timer] of timers) {
      if (timer.at <= now) {
        timers.delete(id);
        timer.callback();
      }
    }
  };
  return { environment, advance, state, timers };
}

describe('icon player', () => {
  it('plays once: sets data-playing, then clears it after the gesture and never re-arms itself', () => {
    const target = fakeTarget();
    const { environment, advance, timers } = fakeEnvironment();
    const player = createIconPlayer(target, 300, environment);
    expect(player.play()).toBe(true);
    expect(target.attributes.has(PLAYING_ATTRIBUTE)).toBe(true);
    expect(target.flushes).toBe(1);
    advance(200);
    expect(player.play()).toBe(false); // no restart mid-gesture
    advance(200);
    expect(target.attributes.has(PLAYING_ATTRIBUTE)).toBe(false);
    expect(player.playing).toBe(false);
    expect(timers.size).toBe(0); // nothing scheduled: it does not loop
    expect(player.play()).toBe(true); // a later request plays again
  });

  it('stays static under reduced motion', () => {
    const target = fakeTarget();
    const { environment } = fakeEnvironment({ reduced: true });
    const player = createIconPlayer(target, 300, environment);
    expect(player.play()).toBe(false);
    expect(target.attributes.size).toBe(0);
  });

  it('stays still during key repeat', () => {
    const target = fakeTarget();
    const { environment, state, advance } = fakeEnvironment();
    const player = createIconPlayer(target, 300, environment);
    state.keyRepeatAt = environment.now() - 10;
    expect(player.play()).toBe(false);
    advance(COALESCE_MS);
    expect(player.play()).toBe(true);
  });

  it('coalesces rapid state changes', () => {
    const target = fakeTarget();
    const { environment, advance } = fakeEnvironment();
    const player = createIconPlayer(target, 100, environment);
    expect(player.play({ coalesce: true })).toBe(true);
    advance(150);
    expect(player.play({ coalesce: true })).toBe(false); // within COALESCE_MS of the previous change
    advance(COALESCE_MS);
    expect(player.play({ coalesce: true })).toBe(true);
  });

  it('cancel returns the icon to rest', () => {
    const target = fakeTarget();
    const { environment, timers } = fakeEnvironment();
    const player = createIconPlayer(target, 300, environment);
    player.play();
    player.cancel();
    expect(target.attributes.has(PLAYING_ATTRIBUTE)).toBe(false);
    expect(timers.size).toBe(0);
  });
});

describe('state trigger key watcher', () => {
  it('fires on key change only, not on mount or on an equal key', () => {
    const changed = createKeyWatcher(3);
    expect(changed(3)).toBe(false);
    expect(changed(4)).toBe(true);
    expect(changed(4)).toBe(false);
    expect(changed('4')).toBe(true);
    expect(changed(Number.NaN)).toBe(true);
    expect(changed(Number.NaN)).toBe(false);
  });

  it('does not fire when the key goes back to rest (false / null / undefined)', () => {
    const changed = createKeyWatcher(false);
    expect(changed(7)).toBe(true); // row became active
    expect(changed(false)).toBe(false); // row stopped being active
    expect(changed(7)).toBe(true); // active again later
    expect(changed(undefined)).toBe(false);
    expect(changed(null)).toBe(false);
  });
});

describe('AnimatedIcon markup', () => {
  it('renders every icon as a static lucide-shaped svg at rest', () => {
    for (const name of ANIMATED_ICON_NAMES) {
      const html = renderToStaticMarkup(createElement(AnimatedIcon, { name }));
      expect(html).toContain(`class="lucide lucide-${name} animated-icon"`);
      expect(html).toContain('viewBox="0 0 24 24"');
      expect(html).toContain('stroke="currentColor"');
      expect(html).toContain('stroke-width="2"');
      expect(html).toContain('aria-hidden="true"');
      expect(html).not.toContain(PLAYING_ATTRIBUTE);
      expect(ANIMATED_ICONS[name].ms).toBeLessThanOrEqual(400);
    }
  });

  it('passes size, class and trigger through', () => {
    const html = renderToStaticMarkup(
      createElement(AnimatedIcon, { name: 'download', size: 16, className: 'step-kind', trigger: 'state' }),
    );
    expect(html).toContain('width="16"');
    expect(html).toContain('class="lucide lucide-download animated-icon step-kind"');
    expect(html).toContain('data-trigger="state"');
  });
});
