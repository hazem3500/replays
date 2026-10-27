import type { Speed } from '../player.ts';

export type ComparisonSide = 'a' | 'b';
export interface ComparisonPlayer {
  readonly duration: number;
  getTime(): number;
  getState(): { status: 'paused' | 'playing' | 'ended' };
  play(): void;
  pause(): void;
  seek(time: number): void;
  setSpeed(speed: Speed): void;
  setSkipInactive(skip: boolean): void;
}

export interface ComparisonClock {
  now(): number;
  request(callback: () => void): number;
  cancel(handle: number): void;
}

export interface ComparisonState {
  time: number;
  duration: number;
  speed: Speed;
  status: 'paused' | 'playing' | 'ended';
  offsetA: number;
  offsetB: number;
  a: { time: number; duration: number; status: 'unavailable' | 'waiting' | 'active' | 'ended' };
  b: { time: number; duration: number; status: 'unavailable' | 'waiting' | 'active' | 'ended' };
}

const clamp = (value: number, max: number) => Math.max(0, Math.min(max, value));

/** Offset is elapsed milliseconds, never a proportional stretch of the shorter recording. */
export function comparisonPosition(time: number, duration: number, offset = 0) {
  return clamp(time + offset, duration);
}

/** A side which has not started or has ended holds its boundary frame. */
export function comparisonSideState(time: number, duration: number, offset = 0) {
  const local = time + offset;
  return {
    time: comparisonPosition(time, duration, offset),
    duration,
    status: local < 0 ? ('waiting' as const) : local >= duration ? ('ended' as const) : ('active' as const),
  };
}

const browserClock: ComparisonClock = {
  now: () => performance.now(),
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
};

/**
 * One monotonic transport for independent replay players. rrweb renders normally; reconciliation is bounded
 * to 250ms intervals and >120ms drift, rather than rebuilding both recordings on each display frame.
 * Inactive skipping is disabled: independent fast-forwards cannot share an elapsed-time ruler.
 */
export class ComparisonCoordinator {
  private readonly players: Partial<Record<ComparisonSide, ComparisonPlayer>> = {};
  private readonly listeners = new Set<() => void>();
  private frame: number | undefined;
  private anchorTime = 0;
  private anchorNow = 0;
  private reconciledAt = -Infinity;
  private disposed = false;
  private snapshot: ComparisonState = {
    time: 0,
    duration: 0,
    speed: 1,
    status: 'paused',
    offsetA: 0,
    offsetB: 0,
    a: { time: 0, duration: 0, status: 'unavailable' },
    b: { time: 0, duration: 0, status: 'unavailable' },
  };

  private readonly clock: ComparisonClock;

  constructor(clock: ComparisonClock = browserClock) {
    this.clock = clock;
  }

  readonly getSnapshot = () => this.snapshot;
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  attach(side: ComparisonSide, player: ComparisonPlayer) {
    if (this.disposed) throw new Error('Comparison is disposed');
    if (!Number.isFinite(player.duration) || player.duration <= 0)
      throw new Error('A comparison recording needs a finite positive duration');
    if (this.players[side]) throw new Error(`Comparison side ${side} is already attached`);
    this.players[side] = player;
    player.setSkipInactive(false);
    player.setSpeed(this.snapshot.speed);
    this.update(this.currentTime());
    this.sync(true);
    return () => {
      if (this.players[side] !== player) return;
      player.pause();
      delete this.players[side];
      this.update(this.currentTime());
      this.reanchor();
      this.sync(true);
    };
  }

  readonly seek = (time: number) => {
    if (this.disposed || !Number.isFinite(time)) return;
    this.update(clamp(time, this.snapshot.duration));
    this.reanchor();
    this.sync(true);
  };

  readonly play = () => {
    if (this.disposed || this.snapshot.duration === 0 || this.snapshot.status === 'playing') return;
    const time = this.snapshot.time >= this.snapshot.duration ? 0 : this.snapshot.time;
    this.update(time, 'playing');
    this.reanchor();
    this.sync(true);
    this.schedule();
  };

  readonly pause = () => {
    if (this.disposed) return;
    this.update(this.currentTime(), 'paused');
    this.reanchor();
    this.cancelFrame();
    this.sync(true);
  };

  readonly toggle = () => (this.snapshot.status === 'playing' ? this.pause() : this.play());

  readonly setSpeed = (speed: Speed) => {
    if (this.disposed || !Number.isFinite(speed) || speed <= 0) return;
    const time = this.currentTime();
    this.snapshot = { ...this.snapshot, speed };
    for (const player of Object.values(this.players)) player.setSpeed(speed);
    this.update(time);
    this.reanchor();
    this.sync(true);
  };

  readonly setOffsetB = (offsetB: number) => {
    if (this.disposed || !Number.isFinite(offsetB)) return;
    const time = this.currentTime();
    this.snapshot = { ...this.snapshot, offsetB };
    this.update(time);
    this.reanchor();
    this.sync(true);
  };

  /** Explicit scenario origins. No time stretching or inferred step matching. */
  readonly setScenarioStarts = (a: number, b: number) => {
    if (
      this.disposed ||
      !this.players.a ||
      !this.players.b ||
      !Number.isFinite(a) ||
      !Number.isFinite(b) ||
      a < 0 ||
      b < 0 ||
      a >= this.players.a.duration ||
      b >= this.players.b.duration
    )
      return false;
    this.pause();
    this.snapshot = { ...this.snapshot, offsetA: a, offsetB: b };
    this.update(0, 'paused');
    this.reanchor();
    this.sync(true);
    return true;
  };

  readonly resetAlignment = () => {
    if (this.disposed) return;
    this.pause();
    this.snapshot = { ...this.snapshot, offsetA: 0, offsetB: 0 };
    this.update(0, 'paused');
    this.reanchor();
    this.sync(true);
  };

  dispose() {
    this.cancelFrame();
    for (const player of Object.values(this.players)) player.pause();
    delete this.players.a;
    delete this.players.b;
    this.disposed = true;
    this.listeners.clear();
  }

  private currentTime() {
    return this.snapshot.status === 'playing'
      ? clamp(this.anchorTime + Math.max(0, this.clock.now() - this.anchorNow) * this.snapshot.speed, this.snapshot.duration)
      : this.snapshot.time;
  }

  private reanchor() {
    this.anchorTime = this.snapshot.time;
    this.anchorNow = this.clock.now();
  }

  private update(time: number, status = this.snapshot.status) {
    const duration = Math.max(
      0,
      this.players.a ? this.players.a.duration - this.snapshot.offsetA : 0,
      this.players.b ? this.players.b.duration - this.snapshot.offsetB : 0,
    );
    const at = clamp(time, duration);
    const nextStatus = duration === 0 ? 'paused' : at >= duration ? 'ended' : status === 'ended' ? 'paused' : status;
    const side = (id: ComparisonSide) =>
      this.players[id]
        ? comparisonSideState(at, this.players[id]!.duration, id === 'b' ? this.snapshot.offsetB : this.snapshot.offsetA)
        : { time: 0, duration: 0, status: 'unavailable' as const };
    this.snapshot = { ...this.snapshot, time: at, duration, status: nextStatus, a: side('a'), b: side('b') };
    if (nextStatus !== 'playing') this.cancelFrame();
    for (const listener of this.listeners) listener();
  }

  private sync(force: boolean) {
    const now = this.clock.now();
    if (!force && now - this.reconciledAt < 250) return;
    this.reconciledAt = now;
    for (const side of ['a', 'b'] as const) {
      const player = this.players[side];
      if (!player) continue;
      const target = this.snapshot[side];
      const shouldPlay = this.snapshot.status === 'playing' && target.status === 'active';
      if (!shouldPlay) player.pause();
      if (force || Math.abs(player.getTime() - target.time) > 120) player.seek(target.time);
      if (shouldPlay && player.getState().status !== 'playing') player.play();
    }
  }

  private readonly tick = () => {
    this.frame = undefined;
    if (this.disposed || this.snapshot.status !== 'playing') return;
    const previous = this.snapshot;
    this.update(this.currentTime());
    const boundary =
      previous.a.status !== this.snapshot.a.status || previous.b.status !== this.snapshot.b.status || this.snapshot.status !== 'playing';
    this.sync(boundary);
    this.schedule();
  };

  private schedule() {
    if (!this.disposed && this.snapshot.status === 'playing' && this.frame === undefined) this.frame = this.clock.request(this.tick);
  }

  private cancelFrame() {
    if (this.frame !== undefined) this.clock.cancel(this.frame);
    this.frame = undefined;
  }
}
