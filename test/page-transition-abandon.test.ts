// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';

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
});
