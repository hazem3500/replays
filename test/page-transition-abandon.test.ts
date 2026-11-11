// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { abandon, afterPageTransition, currentTransition, follow, type PageTransition } from '../src/client/transitions/state.ts';

function stuckTransition(): PageTransition {
  return { ready: new Promise(() => {}), finished: new Promise(() => {}), skipTransition: () => {} };
}

describe('abandoning a page transition that never finishes', () => {
  it('releases what waits on it and forgets it', async () => {
    const transition = stuckTransition();
    follow(transition);
    expect(currentTransition()).toBe(transition);
    const released = afterPageTransition();
    abandon(transition);
    await expect(released).resolves.toBeUndefined();
    expect(currentTransition()).toBeUndefined();
  });

  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(document, 'activeViewTransition');
  });

  it("stops waiting on the browser's own transition that never finishes", async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'activeViewTransition', { value: stuckTransition(), configurable: true });
    let settled = false;
    void afterPageTransition().then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(2900);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(settled).toBe(true);
  });
});
