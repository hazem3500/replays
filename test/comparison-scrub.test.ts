import { describe, expect, it, vi } from 'vitest';
import { ComparisonCoordinator } from '../src/client/comparison/coordinator.ts';
import { ComparisonScrub } from '../src/client/comparison/scrub.ts';
import type { Speed } from '../src/client/player.ts';

function player() {
  return {
    duration: 10000,
    time: 0,
    status: 'paused' as 'paused' | 'playing',
    getTime() {
      return this.time;
    },
    getState() {
      return { status: this.status };
    },
    seek(time: number) {
      this.time = time;
    },
    play() {
      this.status = 'playing';
    },
    pause() {
      this.status = 'paused';
    },
    setSpeed(_speed: Speed) {},
    setSkipInactive(_skip: boolean) {},
    beginScrub: vi.fn<() => void>(),
    endScrub: vi.fn<() => void>(),
  };
}

function setup() {
  const coordinator = new ComparisonCoordinator({ now: () => 0, request: () => 1, cancel: () => {} });
  const a = player(),
    b = player();
  a.beginScrub.mockImplementation(() => expect(a.status).toBe('paused'));
  b.beginScrub.mockImplementation(() => expect(b.status).toBe('paused'));
  coordinator.attach('a', a);
  coordinator.attach('b', b);
  const scrub = new ComparisonScrub(coordinator, () => [a, b]);
  return { coordinator, a, b, scrub };
}

describe('comparison scrub ownership', () => {
  it('pauses the pair before beginning throttled renders and resumes once through the coordinator', () => {
    const { coordinator, a, b, scrub } = setup();
    coordinator.play();
    scrub.begin();
    scrub.begin();
    expect(coordinator.getSnapshot().status).toBe('paused');
    expect(a.beginScrub).toHaveBeenCalledTimes(1);
    coordinator.seek(4000);
    expect([a.time, b.time]).toEqual([4000, 4000]);
    scrub.finish();
    scrub.finish();
    expect(a.endScrub).toHaveBeenCalledTimes(1);
    expect(b.endScrub).toHaveBeenCalledTimes(1);
    expect(coordinator.getSnapshot().status).toBe('playing');
    coordinator.dispose();
  });

  it('keeps a paused comparison paused and cancels resume on window blur/unmount', () => {
    const { coordinator, a, scrub } = setup();
    scrub.begin();
    scrub.finish();
    expect(coordinator.getSnapshot().status).toBe('paused');
    coordinator.play();
    scrub.begin();
    scrub.finish(false);
    expect(coordinator.getSnapshot().status).toBe('paused');
    expect(a.endScrub).toHaveBeenCalledTimes(2);
    coordinator.dispose();
  });
});
