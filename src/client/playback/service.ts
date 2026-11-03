import { assertReplayBundle, type ReplayBundle } from '../../shared/replay.ts';
import type { PlaybackEffects } from '../../shared/effects.ts';
import { ReplayController } from './controller.ts';
import { SPEEDS, type PlayerState, type Speed, type Viewport } from './types.ts';

export interface PlaybackSnapshot {
  readonly phase: 'empty' | 'ready' | 'destroyed';
  readonly bundle: ReplayBundle | null;
  readonly time: number;
  readonly duration: number;
  readonly state: Readonly<PlayerState>;
  readonly viewport: Readonly<Viewport>;
}

export interface PlaybackLoadOptions {
  effects?: PlaybackEffects;
}

export interface PlaybackActions {
  play(): void;
  pause(): void;
  playPause(): void;
  seek(ms: number): void;
  setSpeed(speed: Speed): void;
  setSkipInactive(enabled: boolean): void;
  setEffects(effects: PlaybackEffects): void;
}

/** Independent playback lifecycle and external store; the host supplies data, DOM and UI. */
export interface ReplayPlayback {
  readonly actions: PlaybackActions;
  getSnapshot(): PlaybackSnapshot;
  subscribe(listener: () => void): () => void;
  /** Replaces data and resets time/effects; an existing mount follows the new recording. */
  load(bundle: ReplayBundle, options?: PlaybackLoadOptions): void;
  /** Owns only this mount; cleanup from an older mount cannot remove a newer one. */
  mount(root: HTMLElement): () => void;
  /** Idempotent terminal cleanup; the final snapshot remains readable. */
  destroy(): void;
}

const EMPTY_STATE: Readonly<PlayerState> = Object.freeze({ status: 'paused', speed: 1, skipInactive: true });
const EMPTY_VIEWPORT: Readonly<Viewport> = Object.freeze({ width: 0, height: 0 });

class PlaybackService implements ReplayPlayback {
  private controller: ReplayController | undefined;
  private bundle: ReplayBundle | null = null;
  private root: HTMLElement | undefined;
  private unmount: (() => void) | undefined;
  private mountOwner: symbol | undefined;
  private subscriptions: (() => void)[] = [];
  private readonly listeners = new Set<() => void>();
  private snapshot: PlaybackSnapshot = Object.freeze({
    phase: 'empty',
    bundle: null,
    time: 0,
    duration: 0,
    state: EMPTY_STATE,
    viewport: EMPTY_VIEWPORT,
  });

  readonly actions: PlaybackActions = Object.freeze({
    play: () => this.requireController().play(),
    pause: () => this.requireController().pause(),
    playPause: () => this.requireController().playPause(),
    seek: (ms: number) => this.requireController().seek(ms),
    setSpeed: (speed: Speed) => {
      if (!SPEEDS.includes(speed)) throw new RangeError('Unsupported playback speed');
      this.requireController().setSpeed(speed);
    },
    setSkipInactive: (enabled: boolean) => this.requireController().setSkipInactive(enabled),
    setEffects: (effects: PlaybackEffects) => this.requireController().setEffects(effects),
  });

  readonly getSnapshot = () => this.snapshot;

  readonly subscribe = (listener: () => void) => {
    this.assertLive();
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly load = (bundle: ReplayBundle, options: PlaybackLoadOptions = {}) => {
    this.assertLive();
    assertReplayBundle(bundle);
    const controller = new ReplayController(bundle, options);
    this.detach();
    this.controller = controller;
    this.bundle = bundle;
    this.subscriptions = [
      controller.subscribeTime(this.publish),
      controller.subscribeState(this.publish),
      controller.subscribeViewport(this.publish),
    ];
    if (this.root) this.unmount = controller.mount(this.root);
    this.publish();
  };

  readonly mount = (root: HTMLElement) => {
    const controller = this.requireController();
    this.unmount?.();
    this.root = root;
    const owner = Symbol();
    this.mountOwner = owner;
    this.unmount = controller.mount(root);
    return () => {
      if (owner !== this.mountOwner) return;
      this.unmount?.();
      this.unmount = undefined;
      this.root = undefined;
      this.mountOwner = undefined;
    };
  };

  readonly destroy = () => {
    if (this.snapshot.phase === 'destroyed') return;
    this.detach();
    this.controller = undefined;
    this.bundle = null;
    this.root = undefined;
    this.mountOwner = undefined;
    this.snapshot = Object.freeze({
      ...this.snapshot,
      phase: 'destroyed',
      bundle: null,
      state: Object.freeze({ ...this.snapshot.state, status: 'paused', skipping: undefined }),
    });
    for (const listener of this.listeners) listener();
    this.listeners.clear();
  };

  private readonly publish = () => {
    const controller = this.controller;
    if (!controller) return;
    this.snapshot = Object.freeze({
      phase: 'ready',
      bundle: this.bundle,
      time: controller.getTime(),
      duration: controller.duration,
      state: Object.freeze({ ...controller.getState() }),
      viewport: Object.freeze({ ...controller.getViewport() }),
    });
    for (const listener of this.listeners) listener();
  };

  private detach() {
    for (const unsubscribe of this.subscriptions) unsubscribe();
    this.subscriptions = [];
    this.controller?.pause();
    this.unmount?.();
    this.unmount = undefined;
  }

  private assertLive() {
    if (this.snapshot.phase === 'destroyed') throw new Error('Playback has been destroyed');
  }

  private requireController() {
    this.assertLive();
    if (!this.controller) throw new Error('Load a recording before controlling playback');
    return this.controller;
  }
}

/** Creates a store without DOM, fetching, credentials, routing or application state. */
export function createReplayPlayback(bundle?: ReplayBundle, options?: PlaybackLoadOptions): ReplayPlayback {
  const playback = new PlaybackService();
  if (bundle) playback.load(bundle, options);
  return playback;
}
