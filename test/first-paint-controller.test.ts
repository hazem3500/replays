// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';

import { replay } from './fixtures.ts';

const pauses: number[] = [];
vi.mock('rrweb', () => ({
  Replayer: class {
    wrapper = document.createElement('div');
    iframe = document.createElement('iframe');
    constructor() {
      this.wrapper.append(this.iframe);
    }
    on() {}
    pause(offset: number) {
      pauses.push(offset);
    }
    play() {}
    setConfig() {}
    getCurrentTime() {
      return 0;
    }
    destroy() {}
  },
}));

const { ReplayController } = await import('../src/client/player.ts');

describe('the paused frame at 0:00', () => {
  it('shows the first paint while the playhead stays at 0', () => {
    const bundle = replay();
    bundle.meta.duration = 3000;
    bundle.events = [
      { type: 4, timestamp: 1000, data: { href: 'https://a.test/' } },
      { type: 2, timestamp: 1010, data: {} },
      { type: 3, timestamp: 4000, data: {} },
    ];
    bundle.performance = { supported: [], entries: [{ at: 600, kind: 'first-contentful-paint', value: 600 }] };
    pauses.length = 0;
    const player = new ReplayController(bundle);
    const unmount = player.mount(document.createElement('div'));
    expect(pauses.at(-1)).toBe(601);
    expect(player.getTime()).toBe(0);
    player.seek(1500);
    expect(pauses.at(-1)).toBe(1501);
    unmount();
  });
});
