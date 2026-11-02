import type { Speed } from '../player.ts';

/** How much work a tile may cost: `live` plays, `thumb` is re-seeked at a low rate, `off` is left alone. */
export type Fidelity = 'live' | 'thumb' | 'off';
export type PlayStatus = 'paused' | 'playing' | 'ended';

/** The part of a ReplayController the shared clock drives. */
export interface ClockPlayer {
  readonly duration: number;
  getTime(): number;
  getState(): { status: PlayStatus };
  play(): void;
  pause(): void;
  seek(time: number): void;
  setSpeed(speed: Speed): void;
  setSkipInactive(skip: boolean): void;
  beginScrub(): void;
  endScrub(): void;
}

export interface FrameClock {
  now(): number;
  request(callback: () => void): number;
  cancel(handle: number): void;
}

/** Structural state only. The playhead is read with `getTime()` or `onTime`, never through React state. */
export interface ClockSnapshot {
  status: PlayStatus;
  speed: Speed;
  duration: number;
  /** Tiles whose recording has played to its end at the current time. */
  ended: ReadonlySet<string>;
}

interface Tile {
  player: ClockPlayer;
  syncedAt: number;
  scrubbing: boolean;
}

export const LIVE_RECONCILE_MS = 250;
export const LIVE_DRIFT_MS = 120;
export const THUMB_INTERVAL_MS = 1000;

const clamp = (value: number, max: number) => Math.max(0, Math.min(max, value));

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every((id) => b.has(id));

/** What playback becomes at `time`: playing past the end ends it, a seek back from the end pauses it. */
function nextStatus(status: PlayStatus, time: number, duration: number): PlayStatus {
  if (duration === 0) return 'paused';
  if (status === 'playing' && time >= duration) return 'ended';
  if (status === 'ended' && time < duration) return 'paused';
  return status;
}

const browserClock: FrameClock = {
  now: () => performance.now(),
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
};

/**
 * One transport for any number of recordings that all start at shared zero. A single animation frame loop
 * advances the playhead and calls time listeners (DOM writers, the viewer's transport); React only hears about
 * structural changes: play/pause, speed, duration and tiles reaching their end. Players are reconciled at a
 * bounded rate, per their fidelity, so N tiles never rebuild N documents on every frame.
 */
export class SharedClock {
  private readonly tiles = new Map<string, Tile>();
  private readonly fidelity = new Map<string, Fidelity>();
  private readonly listeners = new Set<() => void>();
  private readonly timeListeners = new Set<() => void>();
  private readonly seekListeners = new Set<() => void>();
  private readonly clock: FrameClock;
  private frame: number | undefined;
  private anchorTime = 0;
  private anchorNow = 0;
  private time = 0;
  private reconciledAt = -Infinity;
  private resumeAfterScrub = false;
  private scrubbing = false;
  private pendingTime: number | undefined;
  /** The one animation frame that carries a scrub's latest position to every tile (several moves, one seek each). */
  private scrubFrame: number | undefined;
  private snapshot: ClockSnapshot = { status: 'paused', speed: 1, duration: 0, ended: new Set() };

  constructor(clock: FrameClock = browserClock) {
    this.clock = clock;
  }

  readonly getSnapshot = () => this.snapshot;
  readonly getTime = () => this.time;
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
  /** Every playing frame and every seek. */
  readonly onTime = (listener: () => void) => {
    this.timeListeners.add(listener);
    return () => void this.timeListeners.delete(listener);
  };
  /** Explicit jumps (keys, steps, rows, scrubbing), not the playback clock. */
  readonly onSeek = (listener: () => void) => {
    this.seekListeners.add(listener);
    return () => void this.seekListeners.delete(listener);
  };

  /** A recording joins the shared timeline (its length counts at once); it is driven once it has a fidelity. */
  readonly add = (id: string, player: ClockPlayer) => {
    if (this.tiles.get(id)?.player === player) return;
    this.tiles.get(id)?.player.pause();
    this.tiles.set(id, { player, syncedAt: -Infinity, scrubbing: false });
    player.setSkipInactive(false);
    player.setSpeed(this.snapshot.speed);
    this.publish(true);
  };

  readonly remove = (id: string) => {
    const tile = this.tiles.get(id);
    if (!tile) return;
    tile.player.pause();
    this.tiles.delete(id);
    this.fidelity.delete(id);
    this.publish(true);
  };

  /** A mounted tile reports `live` or `thumb`; an unmounted, hidden or off-screen one `off`. */
  readonly setFidelity = (id: string, fidelity: Fidelity) => {
    if (this.getFidelity(id) === fidelity) return;
    this.fidelity.set(id, fidelity);
    const tile = this.tiles.get(id);
    if (!tile) return;
    tile.syncedAt = -Infinity;
    if (fidelity !== 'live') tile.player.pause();
    this.syncTile(id, true);
  };

  readonly getFidelity = (id: string): Fidelity => this.fidelity.get(id) ?? 'off';

  /** A shared link's playhead, applied once the recordings' length is known. */
  readonly seekWhenReady = (time: number) => {
    if (!Number.isFinite(time) || time <= 0) return;
    if (this.snapshot.duration > 0) this.seek(time);
    else this.pendingTime = time;
  };

  readonly seek = (time: number) => {
    if (!Number.isFinite(time)) return;
    this.time = clamp(time, this.snapshot.duration);
    this.reanchor();
    for (const listener of this.seekListeners) listener();
    this.publish(true);
  };

  readonly play = () => {
    if (this.snapshot.duration === 0 || this.snapshot.status === 'playing') return;
    if (this.time >= this.snapshot.duration) this.time = 0;
    this.reanchor();
    this.publish(true, 'playing');
    this.schedule();
  };

  readonly pause = () => {
    if (this.snapshot.status !== 'playing') return;
    this.time = this.currentTime();
    this.cancelFrame();
    this.publish(true, 'paused');
  };

  readonly toggle = () => (this.snapshot.status === 'playing' ? this.pause() : this.play());

  readonly setSpeed = (speed: Speed) => {
    if (!Number.isFinite(speed) || speed <= 0) return;
    this.time = this.currentTime();
    this.reanchor();
    for (const tile of this.tiles.values()) tile.player.setSpeed(speed);
    this.snapshot = { ...this.snapshot, speed };
    this.publish(true);
    for (const listener of this.listeners) listener();
  };

  readonly isScrubbing = () => this.scrubbing;

  /**
   * While a scrubber is dragged every tile on the stage follows it: each renders throttled (a tile that can't keep up
   * shows its last frame and catches up), and the latest position reaches each one once per frame.
   */
  readonly beginScrub = () => {
    if (this.scrubbing) return;
    this.resumeAfterScrub = this.snapshot.status === 'playing';
    this.pause();
    this.scrubbing = true;
    for (const [id, tile] of this.tiles) {
      tile.scrubbing = this.getFidelity(id) !== 'off';
      if (tile.scrubbing) tile.player.beginScrub();
    }
  };

  readonly endScrub = () => {
    if (!this.scrubbing) return;
    this.scrubbing = false;
    this.cancelScrubFrame();
    for (const tile of this.tiles.values()) {
      if (tile.scrubbing) tile.player.endScrub();
      tile.scrubbing = false;
      tile.syncedAt = -Infinity;
    }
    this.publish(true);
    if (this.resumeAfterScrub) this.play();
    this.resumeAfterScrub = false;
  };

  private currentTime() {
    if (this.snapshot.status !== 'playing') return this.time;
    return clamp(this.anchorTime + Math.max(0, this.clock.now() - this.anchorNow) * this.snapshot.speed, this.snapshot.duration);
  }

  private reanchor() {
    this.anchorTime = this.time;
    this.anchorNow = this.clock.now();
  }

  private longest() {
    let duration = 0;
    for (const tile of this.tiles.values()) duration = Math.max(duration, tile.player.duration);
    return duration;
  }

  private endedAt(time: number) {
    const ended = new Set<string>();
    for (const [id, tile] of this.tiles) if (time >= tile.player.duration) ended.add(id);
    return ended;
  }

  /** Recomputes the duration and ended tiles; notifies React only when something structural changed. */
  private publish(force: boolean, status: PlayStatus = this.snapshot.status) {
    const previous = this.snapshot;
    const duration = this.longest();
    if (this.pendingTime !== undefined && duration > 0) {
      this.time = this.pendingTime;
      this.pendingTime = undefined;
      this.reanchor();
    }
    this.time = clamp(this.time, duration);
    const ended = this.endedAt(this.time);
    const next = nextStatus(status, this.time, duration);
    if (next !== 'playing') this.cancelFrame();
    const changed = next !== previous.status || duration !== previous.duration || !sameSet(ended, previous.ended);
    if (changed) this.snapshot = { ...previous, status: next, duration, ended };
    if (this.scrubbing) this.scheduleScrubSync();
    else this.sync(force || changed);
    for (const listener of this.timeListeners) listener();
    if (changed) for (const listener of this.listeners) listener();
  }

  private sync(force: boolean) {
    const now = this.clock.now();
    if (!force && now - this.reconciledAt < LIVE_RECONCILE_MS) {
      for (const id of this.tiles.keys()) if (this.getFidelity(id) === 'thumb') this.syncTile(id, false);
      return;
    }
    this.reconciledAt = now;
    for (const id of this.tiles.keys()) this.syncTile(id, force);
  }

  private syncTile(id: string, force: boolean) {
    const tile = this.tiles.get(id);
    const fidelity = this.getFidelity(id);
    if (!tile || fidelity === 'off') return;
    if (fidelity === 'thumb') this.syncThumb(id, force);
    else this.syncLive(tile.player, force);
  }

  /** A thumbnail stays paused and is re-seeked at most once a second (never mid-scrub). */
  private syncThumb(id: string, force: boolean) {
    const tile = this.tiles.get(id);
    const now = this.clock.now();
    if (!tile || this.scrubbing || (!force && now - tile.syncedAt < THUMB_INTERVAL_MS)) return;
    tile.syncedAt = now;
    const { player } = tile;
    const target = clamp(this.time, player.duration);
    if (player.getState().status === 'playing') player.pause();
    if (Math.abs(player.getTime() - target) > 1) player.seek(target);
  }

  /** A live player plays while the clock does and its recording lasts, re-seeked when it drifts. */
  private syncLive(player: ClockPlayer, force: boolean) {
    const target = clamp(this.time, player.duration);
    const shouldPlay = this.snapshot.status === 'playing' && this.time < player.duration;
    const playing = player.getState().status === 'playing';
    if (!shouldPlay && playing) player.pause();
    if (force || Math.abs(player.getTime() - target) > LIVE_DRIFT_MS) player.seek(target);
    if (shouldPlay && !playing) player.play();
  }

  private scheduleScrubSync() {
    if (this.scrubFrame !== undefined) return;
    this.scrubFrame = this.clock.request(() => {
      this.scrubFrame = undefined;
      if (this.scrubbing) this.syncScrub();
    });
  }

  private cancelScrubFrame() {
    if (this.scrubFrame !== undefined) this.clock.cancel(this.scrubFrame);
    this.scrubFrame = undefined;
  }

  /** One seek per scrubbing tile to the latest position; a tile already there (one that has ended) is left alone. */
  private syncScrub() {
    for (const tile of this.tiles.values()) {
      if (!tile.scrubbing) continue;
      const target = clamp(this.time, tile.player.duration);
      if (Math.abs(tile.player.getTime() - target) > 1) tile.player.seek(target);
    }
  }

  private readonly tick = () => {
    this.frame = undefined;
    if (this.snapshot.status !== 'playing') return;
    this.time = this.currentTime();
    this.publish(false);
    this.schedule();
  };

  private schedule() {
    if (this.snapshot.status === 'playing' && this.frame === undefined) this.frame = this.clock.request(this.tick);
  }

  private cancelFrame() {
    if (this.frame !== undefined) this.clock.cancel(this.frame);
    this.frame = undefined;
  }
}
