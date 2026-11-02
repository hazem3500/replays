import { describe, expect, it } from 'vitest';

import { MeetingClock, THUMB_INTERVAL_MS } from '../src/client/comparison/meeting/clock.ts';

function fakeClock() {
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

describe('MeetingClock', () => {
  it('runs any number of tiles from one frame loop and holds ended tiles', () => {
    const time = fakeClock();
    const clock = new MeetingClock(time.clock);
    const tiles = [player(4000), player(8000), player(6000)];
    tiles.forEach((tile, index) => clock.attach(`t${index}`, tile));
    expect(clock.getSnapshot().duration).toBe(8000);
    clock.play();
    expect(time.pending()).toBe(1);
    time.advance(5000);
    expect(clock.getTime()).toBe(5000);
    expect(clock.getSnapshot().tiles.t0?.status).toBe('ended');
    expect(tiles[0]!.status).toBe('paused');
    expect(tiles[0]!.time).toBe(4000);
    expect(tiles[1]!.status).toBe('playing');
    time.advance(4000);
    expect(clock.getSnapshot().status).toBe('ended');
    expect(time.pending()).toBe(0);
  });

  it('holds a tile with a negative offset at its first frame until it starts', () => {
    const time = fakeClock();
    const clock = new MeetingClock(time.clock);
    const late = player(3000);
    clock.attach('a', player(5000));
    clock.attach('b', late, -1200);
    expect(clock.getSnapshot().tiles.b?.status).toBe('waiting');
    clock.play();
    time.advance(1000);
    expect(late.status).toBe('paused');
    time.advance(300);
    expect(clock.getSnapshot().tiles.b?.status).toBe('active');
    expect(late.status).toBe('playing');
  });

  it('notifies React only on structural changes, frame listeners every frame', () => {
    const time = fakeClock();
    const clock = new MeetingClock(time.clock);
    clock.attach('a', player(10_000));
    let renders = 0;
    let frames = 0;
    clock.subscribe(() => renders++);
    clock.onFrame(() => frames++);
    clock.play();
    for (let index = 0; index < 30; index++) time.advance(16);
    expect(renders).toBe(1);
    expect(frames).toBeGreaterThanOrEqual(31);
  });

  it('re-seeks thumbnails at a low rate and leaves off-screen tiles alone', () => {
    const time = fakeClock();
    const clock = new MeetingClock(time.clock);
    const thumb = player(20_000);
    const off = player(20_000);
    clock.attach('thumb', thumb);
    clock.attach('off', off);
    clock.setFidelity('thumb', 'thumb');
    clock.setFidelity('off', 'off');
    const offSeeks = off.seeks;
    clock.play();
    const seeks = thumb.seeks;
    for (let index = 0; index < 120; index++) time.advance(16);
    expect(thumb.status).toBe('paused');
    expect(thumb.seeks - seeks).toBeLessThanOrEqual(Math.ceil((120 * 16) / THUMB_INTERVAL_MS) + 1);
    expect(off.seeks).toBe(offSeeks);
    expect(off.status).toBe('paused');
    clock.setFidelity('off', 'live');
    expect(off.time).toBeCloseTo(clock.getTime(), -1);
    expect(off.status).toBe('playing');
  });

  it('aligns scenario starts as shared zero and keeps detached tiles out of the duration', () => {
    const clock = new MeetingClock(fakeClock().clock);
    const a = player(10_000);
    const b = player(6000);
    clock.attach('a', a);
    const detach = clock.attach('b', b);
    clock.seek(3000);
    clock.align({ a: 4000, b: 1000 });
    expect(clock.getTime()).toBe(0);
    expect(a.time).toBe(4000);
    expect(b.time).toBe(1000);
    expect(clock.getSnapshot().duration).toBe(6000);
    detach();
    expect(clock.getSnapshot().tiles.b).toBeUndefined();
  });

  it('scrubs live players throttled and resumes after the drop', () => {
    const time = fakeClock();
    const clock = new MeetingClock(time.clock);
    const live = player(9000);
    clock.attach('a', live);
    clock.play();
    clock.beginScrub();
    expect(live.scrubs).toBe(1);
    expect(clock.getSnapshot().status).toBe('paused');
    clock.seek(4000);
    clock.endScrub();
    expect(clock.getSnapshot().status).toBe('playing');
    expect(live.time).toBe(4000);
  });
});
