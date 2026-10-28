import { describe, expect, it } from 'vitest';

import { SharedClock, THUMB_INTERVAL_MS } from '../src/client/compare/clock.ts';

function fakeFrames() {
  let now = 0;
  let next = 1;
  const frames = new Map<number, () => void>();
  return {
    clock: {
      now: () => now,
      request: (callback: () => void) => (frames.set(next, callback), next++),
      cancel: (handle: number) => void frames.delete(handle),
    },
    advance(ms: number) {
      now += ms;
      const due = [...frames.values()];
      frames.clear();
      for (const callback of due) callback();
    },
    pending: () => frames.size,
  };
}

function player(duration: number) {
  return {
    duration,
    time: 0,
    status: 'paused' as 'paused' | 'playing' | 'ended',
    seeks: 0,
    scrubs: 0,
    getTime() {
      return this.time;
    },
    getState() {
      return { status: this.status };
    },
    play() {
      this.status = 'playing';
    },
    pause() {
      this.status = 'paused';
    },
    seek(time: number) {
      this.time = time;
      this.seeks++;
    },
    setSpeed() {},
    setSkipInactive() {},
    beginScrub() {
      this.scrubs++;
    },
    endScrub() {},
  };
}

function liveClock(frames: ReturnType<typeof fakeFrames>, durations: number[]) {
  const clock = new SharedClock(frames.clock);
  const players = durations.map((duration, index) => {
    const tile = player(duration);
    clock.add(`t${index}`, tile);
    clock.setFidelity(`t${index}`, 'live');
    return tile;
  });
  return { clock, players };
}

describe('SharedClock playback', () => {
  it('runs every recording from one frame loop and holds one that has ended at its last frame', () => {
    const frames = fakeFrames();
    const { clock, players } = liveClock(frames, [4000, 8000, 6000]);
    expect(clock.getSnapshot().duration).toBe(8000);
    clock.play();
    expect(frames.pending()).toBe(1);
    frames.advance(5000);
    expect(clock.getTime()).toBe(5000);
    expect(clock.getSnapshot().ended.has('t0')).toBe(true);
    const [short, long] = players;
    expect(short?.status).toBe('paused');
    expect(long?.status).toBe('playing');
    frames.advance(4000);
    expect(clock.getSnapshot().status).toBe('ended');
    expect(frames.pending()).toBe(0);
  });

  it('counts a recording’s length as soon as it is added, before its tile mounts', () => {
    const clock = new SharedClock(fakeFrames().clock);
    const unmounted = player(7000);
    clock.add('a', unmounted);
    expect(clock.getSnapshot().duration).toBe(7000);
    clock.seek(3000);
    expect(unmounted.seeks).toBe(0);
    clock.setFidelity('a', 'live');
    expect(unmounted.time).toBe(3000);
  });

  it('notifies React only on structural changes and time listeners on every frame', () => {
    const frames = fakeFrames();
    const { clock } = liveClock(frames, [10_000]);
    let renders = 0;
    let ticks = 0;
    clock.subscribe(() => renders++);
    clock.onTime(() => ticks++);
    clock.play();
    for (let index = 0; index < 30; index++) frames.advance(16);
    expect(renders).toBe(1);
    expect(ticks).toBeGreaterThanOrEqual(30);
  });

  it('tells seek listeners about jumps but not about playback', () => {
    const frames = fakeFrames();
    const { clock } = liveClock(frames, [10_000]);
    let seeks = 0;
    clock.onSeek(() => seeks++);
    clock.play();
    frames.advance(500);
    expect(seeks).toBe(0);
    clock.seek(2000);
    expect(seeks).toBe(1);
  });

});

describe('SharedClock tiles', () => {
  it('re-seeks thumbnails at a low rate and leaves hidden tiles alone', () => {
    const frames = fakeFrames();
    const clock = new SharedClock(frames.clock);
    const thumb = player(20_000);
    const off = player(20_000);
    clock.add('thumb', thumb);
    clock.add('off', off);
    clock.setFidelity('thumb', 'thumb');
    clock.play();
    const seeks = thumb.seeks;
    for (let index = 0; index < 120; index++) frames.advance(16);
    expect(thumb.status).toBe('paused');
    expect(thumb.seeks - seeks).toBeLessThanOrEqual(Math.ceil((120 * 16) / THUMB_INTERVAL_MS) + 1);
    expect(off.seeks).toBe(0);
    clock.setFidelity('off', 'live');
    expect(off.time).toBeCloseTo(clock.getTime(), -1);
    expect(off.status).toBe('playing');
  });

  it('applies a shared link’s playhead once a recording’s length is known', () => {
    const clock = new SharedClock(fakeFrames().clock);
    clock.seekWhenReady(2500);
    expect(clock.getTime()).toBe(0);
    clock.add('a', player(6000));
    expect(clock.getTime()).toBe(2500);
  });

  it('shortens the timeline when a recording leaves', () => {
    const clock = new SharedClock(fakeFrames().clock);
    const long = player(9000);
    clock.add('a', player(4000));
    clock.add('b', long);
    clock.seek(8000);
    clock.remove('b');
    expect(clock.getSnapshot().duration).toBe(4000);
    expect(clock.getTime()).toBe(4000);
    expect(long.status).toBe('paused');
  });

  it('scrubs live players throttled and resumes after the drop', () => {
    const frames = fakeFrames();
    const {
      clock,
      players: [live],
    } = liveClock(frames, [9000]);
    clock.play();
    clock.beginScrub();
    expect(live?.scrubs).toBe(1);
    expect(clock.getSnapshot().status).toBe('paused');
    clock.seek(4000);
    clock.endScrub();
    expect(clock.getSnapshot().status).toBe('playing');
    expect(live?.time).toBe(4000);
  });

  it('restarts from the beginning when played after the end', () => {
    const frames = fakeFrames();
    const { clock } = liveClock(frames, [1000]);
    clock.play();
    frames.advance(1200);
    expect(clock.getSnapshot().status).toBe('ended');
    clock.play();
    expect(clock.getTime()).toBe(0);
    expect(clock.getSnapshot().status).toBe('playing');
  });
});
