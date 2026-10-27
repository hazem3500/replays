import { describe, expect, it } from 'vitest';
import {
  ComparisonCoordinator,
  comparisonPosition,
  type ComparisonClock,
  type ComparisonPlayer,
} from '../src/client/comparison/coordinator.ts';
import type { Speed } from '../src/client/player.ts';

class Clock implements ComparisonClock {
  time = 0;
  next = 0;
  callbacks = new Map<number, () => void>();
  now = () => this.time;
  request = (callback: () => void) => {
    const id = this.next++;
    this.callbacks.set(id, callback);
    return id;
  };
  cancel = (id: number) => {
    this.callbacks.delete(id);
  };
  advance(ms: number) {
    this.time += ms;
    const callbacks = [...this.callbacks.values()];
    this.callbacks.clear();
    for (const callback of callbacks) callback();
  }
}

class Player implements ComparisonPlayer {
  time = 0;
  status: 'paused' | 'playing' | 'ended' = 'paused';
  speed: Speed = 1;
  skipInactive = true;
  seeks: number[] = [];
  playCount = 0;
  private anchor = 0;
  readonly duration: number;
  private clock: Clock;
  constructor(duration: number, clock: Clock) {
    this.duration = duration;
    this.clock = clock;
  }
  getTime = () =>
    this.status === 'playing' ? Math.min(this.duration, this.time + (this.clock.time - this.anchor) * this.speed) : this.time;
  getState = () => ({ status: this.status });
  play = () => {
    this.time = this.getTime();
    this.anchor = this.clock.time;
    this.status = 'playing';
    this.playCount++;
  };
  pause = () => {
    this.time = this.getTime();
    this.status = 'paused';
  };
  seek = (time: number) => {
    this.time = time;
    this.anchor = this.clock.time;
    this.seeks.push(time);
  };
  setSpeed = (speed: Speed) => {
    this.time = this.getTime();
    this.anchor = this.clock.time;
    this.speed = speed;
  };
  setSkipInactive = (skip: boolean) => {
    this.skipInactive = skip;
  };
}

function setup(aDuration = 1000, bDuration = 2000) {
  const clock = new Clock();
  const coordinator = new ComparisonCoordinator(clock);
  const a = new Player(aDuration, clock),
    b = new Player(bDuration, clock);
  const detachA = coordinator.attach('a', a);
  const detachB = coordinator.attach('b', b);
  return { clock, coordinator, a, b, detachA, detachB };
}

describe('shared elapsed comparison transport', () => {
  it('clamps each side independently without stretching its duration', () => {
    expect(comparisonPosition(800, 500)).toBe(500);
    expect(comparisonPosition(100, 1000, -300)).toBe(0);
    const { coordinator, a, b } = setup();
    coordinator.seek(1500);
    expect(a.getTime()).toBe(1000);
    expect(b.getTime()).toBe(1500);
    expect(coordinator.getSnapshot()).toMatchObject({ duration: 2000, time: 1500, a: { status: 'ended' }, b: { status: 'active' } });
    expect([a.skipInactive, b.skipInactive]).toEqual([false, false]);
  });

  it('holds the shorter side without restarting it while the longer side continues', () => {
    const { coordinator, a, b, clock } = setup();
    coordinator.play();
    clock.advance(1000);
    expect(coordinator.getSnapshot().status).toBe('playing');
    expect(a.getState().status).toBe('paused');
    expect(a.getTime()).toBe(1000);
    expect(b.getState().status).toBe('playing');
    clock.advance(500);
    expect(a.playCount).toBe(1);
    expect(coordinator.getSnapshot().time).toBe(1500);
    clock.advance(500);
    expect(coordinator.getSnapshot().status).toBe('ended');
    expect(b.getTime()).toBe(2000);
    expect(clock.callbacks.size).toBe(0);
    coordinator.play();
    expect([a.getTime(), b.getTime()]).toEqual([0, 0]);
    expect(coordinator.getSnapshot().status).toBe('playing');
  });

  it('waits at the start for a negative B offset and starts that player on crossing its boundary', () => {
    const { coordinator, clock, a, b } = setup();
    coordinator.setOffsetB(-500);
    expect(coordinator.getSnapshot().duration).toBe(2500);
    coordinator.play();
    clock.advance(250);
    expect(coordinator.getSnapshot().b.status).toBe('waiting');
    expect(b.getTime()).toBe(0);
    expect(b.playCount).toBe(0);
    clock.advance(250);
    expect(b.getState().status).toBe('playing');
    clock.advance(100);
    expect(b.getTime()).toBe(100);
    expect(a.getTime()).toBe(600);
  });

  it('maps positive offsets and marker seeks in elapsed milliseconds', () => {
    const { coordinator, a, b } = setup();
    coordinator.setOffsetB(500);
    expect(coordinator.getSnapshot().duration).toBe(1500);
    expect([a.getTime(), b.getTime()]).toEqual([0, 500]);
    coordinator.seek(900 - coordinator.getSnapshot().offsetB);
    expect([a.getTime(), b.getTime()]).toEqual([400, 900]);
  });

  it('reanchors speed, pause, seek and offset changes without a clock jump', () => {
    const { coordinator, clock, a, b } = setup(5000, 5000);
    coordinator.play();
    clock.advance(200);
    coordinator.setSpeed(2);
    clock.advance(100);
    expect(coordinator.getSnapshot().time).toBe(400);
    coordinator.pause();
    clock.advance(1000);
    expect(coordinator.getSnapshot().time).toBe(400);
    coordinator.seek(700);
    coordinator.setOffsetB(100);
    expect([a.getTime(), b.getTime()]).toEqual([700, 800]);
    coordinator.play();
    clock.advance(100);
    expect(coordinator.getSnapshot().time).toBe(900);
    expect([a.getTime(), b.getTime()]).toEqual([900, 1000]);
  });

  it('does not seek every display frame, but corrects material drift at a bounded interval', () => {
    const { coordinator, clock, a, b } = setup(5000, 5000);
    coordinator.play();
    const initialSeeks = a.seeks.length;
    for (let i = 0; i < 10; i++) clock.advance(16);
    expect(a.seeks.length).toBe(initialSeeks);
    b.time = 0;
    // Simulate a slow renderer's clock falling behind, rather than regular monotonic playback.
    b.pause();
    b.seek(0);
    clock.advance(100);
    expect(b.getTime()).toBe(260);
    expect(a.seeks.length).toBe(initialSeeks);
  });

  it('supports one unavailable side, replacement, and disposal with no scheduled work left', () => {
    const { coordinator, clock, detachA, detachB, a, b } = setup();
    detachB();
    coordinator.play();
    clock.advance(100);
    expect(coordinator.getSnapshot()).toMatchObject({ time: 100, duration: 1000, b: { status: 'unavailable' } });
    const replacement = new Player(3000, clock);
    coordinator.attach('b', replacement);
    expect(replacement.getTime()).toBe(100);
    expect(replacement.status).toBe('playing');
    detachB(); // Stale cleanup must not detach the replacement.
    expect(coordinator.getSnapshot().b.status).toBe('active');
    detachA();
    coordinator.dispose();
    expect(clock.callbacks.size).toBe(0);
    expect([a.status, b.status, replacement.status]).toEqual(['paused', 'paused', 'paused']);
    expect(() => coordinator.attach('a', a)).toThrow('disposed');
  });

  it('rejects invalid side durations and ignores non-finite controls', () => {
    const { coordinator, a, clock } = setup();
    expect(() => coordinator.attach('a', a)).toThrow('already attached');
    coordinator.seek(NaN);
    coordinator.setOffsetB(Infinity);
    expect(coordinator.getSnapshot()).toMatchObject({ time: 0, offsetB: 0 });
    const empty = new ComparisonCoordinator(clock);
    expect(() => empty.attach('a', new Player(0, clock))).toThrow('positive duration');
    empty.play();
    expect(empty.getSnapshot().status).toBe('paused');
  });
  it('aligns confirmed scenario starts without stretching time or losing the remaining-duration difference', () => {
    const { coordinator, a, b, clock } = setup(10000, 8000);
    expect(coordinator.setScenarioStarts(2000, 3000)).toBe(true);
    expect(coordinator.getSnapshot()).toMatchObject({ time: 0, duration: 8000, offsetA: 2000, offsetB: 3000 });
    expect([a.getTime(), b.getTime()]).toEqual([2000, 3000]);
    coordinator.play();
    clock.advance(1000);
    expect([a.getTime(), b.getTime()]).toEqual([3000, 4000]);
    coordinator.seek(6000);
    expect([a.getTime(), b.getTime()]).toEqual([8000, 8000]);
    expect(coordinator.getSnapshot()).toMatchObject({ a: { status: 'active' }, b: { status: 'ended' } });
  });

  it('rejects invalid or end-only origins without mutating an existing alignment', () => {
    const { coordinator } = setup();
    coordinator.setScenarioStarts(100, 200);
    const before = coordinator.getSnapshot();
    for (const [a, b] of [
      [-1, 0],
      [0, Infinity],
      [1000, 0],
      [0, 2000],
    ]) {
      expect(coordinator.setScenarioStarts(a!, b!)).toBe(false);
      expect(coordinator.getSnapshot()).toBe(before);
    }
    coordinator.resetAlignment();
    expect(coordinator.getSnapshot()).toMatchObject({ time: 0, duration: 2000, offsetA: 0, offsetB: 0, status: 'paused' });
  });
});
