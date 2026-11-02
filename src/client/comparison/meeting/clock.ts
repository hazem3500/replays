import type { Speed } from '../../player.ts';
import type { ComparisonClock, ComparisonPlayer } from '../coordinator.ts';

/** How much work a tile may cost: `live` plays, `thumb` is re-seeked at a low rate, `off` is left alone. */
export type Fidelity = 'live' | 'thumb' | 'off';
export type TileStatus = 'waiting' | 'active' | 'ended';
export type PlayStatus = 'paused' | 'playing' | 'ended';

export interface TileSnapshot {
  status: TileStatus;
  duration: number;
  /** Local recording time shown at shared zero. Negative: the tile waits that long before it starts. */
  offset: number;
}

/** Structural state only. The playhead is read with `getTime()` or `onFrame`, never through React state. */
export interface MeetingSnapshot {
  status: PlayStatus;
  speed: Speed;
  duration: number;
  tiles: Readonly<Record<string, TileSnapshot>>;
}

interface Tile {
  player: ComparisonPlayer;
  offset: number;
  syncedAt: number;
  scrubbing: boolean;
}

interface Scrubbable {
  beginScrub(): void;
  endScrub(): void;
}

export const LIVE_RECONCILE_MS = 250;
export const LIVE_DRIFT_MS = 120;
export const THUMB_INTERVAL_MS = 1000;

const clamp = (value: number, max: number) => Math.max(0, Math.min(max, value));

export function tileStatus(time: number, duration: number, offset: number): TileStatus {
  const local = time + offset;
  return local < 0 ? 'waiting' : local >= duration ? 'ended' : 'active';
}

const browserClock: ComparisonClock = {
  now: () => performance.now(),
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
};

/**
 * One transport for any number of replay tiles. A single animation frame loop advances the shared playhead and
 * calls frame listeners (DOM writers); React only hears about structural changes such as play/pause, speed,
 * offsets and tiles crossing their start or end. Players are reconciled at a bounded rate, per their fidelity.
 */
export class MeetingClock {
  private readonly tiles = new Map<string, Tile>();
  private readonly fidelity = new Map<string, Fidelity>();
  private readonly listeners = new Set<() => void>();
  private readonly frameListeners = new Set<(time: number) => void>();
  private readonly clock: ComparisonClock;
  private frame: number | undefined;
  private anchorTime = 0;
  private anchorNow = 0;
  private time = 0;
  private reconciledAt = -Infinity;
  private resumeAfterScrub = false;
  private scrubbing = false;
  private pendingTime: number | undefined;
  private snapshot: MeetingSnapshot = { status: 'paused', speed: 1, duration: 0, tiles: {} };

  constructor(clock: ComparisonClock = browserClock) {
    this.clock = clock;
  }

  readonly getSnapshot = () => this.snapshot;
  readonly getTime = () => this.time;
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
  /** Called with the shared time on every playing frame and after every seek. */
  readonly onFrame = (listener: (time: number) => void) => {
    this.frameListeners.add(listener);
    listener(this.time);
    return () => void this.frameListeners.delete(listener);
  };

  /** A tile joins the shared timeline when its player is ready, starting `offset` into its recording. */
  readonly attach = (id: string, player: ComparisonPlayer, offset = 0) => {
    if (!Number.isFinite(player.duration) || player.duration <= 0) return () => {};
    this.tiles.get(id)?.player?.pause();
    const tile: Tile = { player, offset: Math.round(offset), syncedAt: -Infinity, scrubbing: false };
    this.tiles.set(id, tile);
    player.setSkipInactive(false);
    player.setSpeed(this.snapshot.speed);
    this.publish(true);
    return () => {
      if (this.tiles.get(id) !== tile) return;
      player.pause();
      this.tiles.delete(id);
      this.publish(true);
    };
  };

  /** Kept across attach and detach, so visibility can be reported before a player is ready. */
  readonly setFidelity = (id: string, fidelity: Fidelity) => {
    if ((this.fidelity.get(id) ?? 'live') === fidelity) return;
    this.fidelity.set(id, fidelity);
    const tile = this.tiles.get(id);
    if (!tile) return;
    tile.syncedAt = -Infinity;
    if (fidelity !== 'live') tile.player.pause();
    this.syncTile(id, tile, true);
  };

  readonly getFidelity = (id: string): Fidelity => this.fidelity.get(id) ?? 'live';

  readonly setOffset = (id: string, offset: number) => {
    const tile = this.tiles.get(id);
    if (!tile || !Number.isFinite(offset)) return;
    tile.offset = Math.round(offset);
    this.publish(true);
  };

  /** Scenario starts: each tile's chosen moment becomes shared zero. Playback pauses at the new origin. */
  readonly align = (starts: Readonly<Record<string, number>>) => {
    this.pause();
    for (const [id, tile] of this.tiles) tile.offset = Math.round(starts[id] ?? 0);
    this.time = 0;
    this.reanchor();
    this.publish(true);
  };

  /** A shared link's playhead, applied once the first recording is ready. */
  readonly seekWhenReady = (time: number) => {
    if (Number.isFinite(time) && time > 0) this.pendingTime = time;
  };

  readonly seek = (time: number) => {
    if (!Number.isFinite(time)) return;
    this.time = clamp(time, this.snapshot.duration);
    this.reanchor();
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
  };

  /** While a scrubber is dragged, live players render throttled and thumbnails wait for the drop. */
  readonly beginScrub = () => {
    if (this.scrubbing) return;
    this.scrubbing = true;
    this.resumeAfterScrub = this.snapshot.status === 'playing';
    this.pause();
    for (const [id, tile] of this.tiles) {
      const player = tile.player as ComparisonPlayer & Partial<Scrubbable>;
      tile.scrubbing = this.getFidelity(id) === 'live' && Boolean(player.beginScrub);
      if (tile.scrubbing) player.beginScrub!();
    }
  };

  readonly endScrub = (resume = true) => {
    if (!this.scrubbing) return;
    this.scrubbing = false;
    for (const tile of this.tiles.values()) {
      if (tile.scrubbing) (tile.player as ComparisonPlayer & Scrubbable).endScrub();
      tile.scrubbing = false;
      tile.syncedAt = -Infinity;
    }
    this.publish(true);
    if (resume && this.resumeAfterScrub) this.play();
    this.resumeAfterScrub = false;
  };

  /** A tile's local recording time at the current shared time. */
  readonly localTime = (id: string) => {
    const tile = this.tiles.get(id);
    return tile ? this.time + tile.offset : 0;
  };

  private currentTime() {
    if (this.snapshot.status !== 'playing') return this.time;
    return clamp(this.anchorTime + Math.max(0, this.clock.now() - this.anchorNow) * this.snapshot.speed, this.snapshot.duration);
  }

  private reanchor() {
    this.anchorTime = this.time;
    this.anchorNow = this.clock.now();
  }

  /** Recomputes tiles and duration; notifies React only when something structural changed. */
  private publish(force: boolean, status: PlayStatus = this.snapshot.status) {
    const previous = this.snapshot;
    let duration = 0;
    const tiles: Record<string, TileSnapshot> = {};
    for (const tile of this.tiles.values()) duration = Math.max(duration, tile.player.duration - tile.offset);
    if (this.pendingTime !== undefined && duration > 0) {
      this.time = this.pendingTime;
      this.pendingTime = undefined;
      this.reanchor();
    }
    this.time = clamp(this.time, duration);
    for (const [id, tile] of this.tiles)
      tiles[id] = { duration: tile.player.duration, offset: tile.offset, status: tileStatus(this.time, tile.player.duration, tile.offset) };
    const next =
      duration === 0
        ? 'paused'
        : status === 'playing' && this.time >= duration
          ? 'ended'
          : status === 'ended' && this.time < duration
            ? 'paused'
            : status;
    if (next !== 'playing') this.cancelFrame();
    const changed =
      next !== previous.status ||
      duration !== previous.duration ||
      Object.keys(tiles).length !== Object.keys(previous.tiles).length ||
      Object.entries(tiles).some(([id, tile]) => {
        const before = previous.tiles[id];
        return !before || before.status !== tile.status || before.duration !== tile.duration || before.offset !== tile.offset;
      });
    if (changed) this.snapshot = { ...previous, status: next, duration, tiles };
    this.sync(force || changed);
    for (const listener of this.frameListeners) listener(this.time);
    if (changed) for (const listener of this.listeners) listener();
  }

  private sync(force: boolean) {
    const now = this.clock.now();
    if (!force && now - this.reconciledAt < LIVE_RECONCILE_MS) {
      for (const [id, tile] of this.tiles) if (this.getFidelity(id) === 'thumb') this.syncTile(id, tile, false);
      return;
    }
    this.reconciledAt = now;
    for (const [id, tile] of this.tiles) this.syncTile(id, tile, force);
  }

  private syncTile(id: string, tile: Tile, force: boolean) {
    const { player } = tile;
    const fidelity = this.getFidelity(id);
    if (fidelity === 'off') return;
    const target = clamp(this.time + tile.offset, player.duration);
    if (fidelity === 'thumb') {
      if (this.scrubbing) return;
      const now = this.clock.now();
      if (!force && now - tile.syncedAt < THUMB_INTERVAL_MS) return;
      tile.syncedAt = now;
      if (player.getState().status === 'playing') player.pause();
      if (Math.abs(player.getTime() - target) > 1) player.seek(target);
      return;
    }
    const shouldPlay = this.snapshot.status === 'playing' && tileStatus(this.time, player.duration, tile.offset) === 'active';
    if (!shouldPlay && player.getState().status === 'playing') player.pause();
    if (force || Math.abs(player.getTime() - target) > LIVE_DRIFT_MS) player.seek(target);
    if (shouldPlay && player.getState().status !== 'playing') player.play();
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
