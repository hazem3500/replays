import { NO_EFFECTS, type PlaybackEffects } from '../../shared/effects.ts';
import type { Playback, PlayerState, ReplayController, Speed } from '../player.ts';
import type { SharedClock } from './clock.ts';

const NO_GAPS: ReplayController['idleGaps'] = [];

/**
 * The viewer's player while it compares recordings: transport calls (play, seek, speed, scrubbing) drive the
 * shared clock, and everything about one picture (viewport, wrapper, step target outline) is the focused
 * recording's. So the viewer's own transport, shortcuts, steps and inspector work unchanged, scoped to the
 * focused tile, on one timeline. Recordings all start at shared zero, so shared time is each one's own time.
 */
export class SharedPlayer implements Playback {
  readonly canSkipInactive = false;
  readonly idleGaps = NO_GAPS;
  private readonly clock: SharedClock;
  private focused: ReplayController;
  private state: PlayerState;
  private readonly viewportListeners = new Set<() => void>();
  private unsubscribeViewport: () => void;

  constructor(clock: SharedClock, focused: ReplayController) {
    this.clock = clock;
    this.focused = focused;
    this.state = this.readState();
    this.unsubscribeViewport = focused.subscribeViewport(this.notifyViewport);
  }

  get duration() {
    return this.clock.getSnapshot().duration;
  }

  get eventCount() {
    return this.focused.eventCount;
  }

  get wrapper() {
    return this.focused.wrapper;
  }

  /** The recording the chrome describes; a change notifies viewport listeners (its picture changed). */
  readonly focus = (controller: ReplayController) => {
    if (controller === this.focused) return;
    this.unsubscribeViewport();
    this.focused.clearTarget();
    this.focused = controller;
    this.unsubscribeViewport = controller.subscribeViewport(this.notifyViewport);
    this.notifyViewport();
  };

  readonly mount = (): (() => void) => {
    throw new Error('Compared recordings mount in their own tiles');
  };

  getEffects(): PlaybackEffects {
    return NO_EFFECTS;
  }

  setEffects() {}

  setZoomSuspended() {}

  readonly highlightTarget = (selector: string, at: number) => this.focused.highlightTarget(selector, at);
  readonly clearTarget = () => this.focused.clearTarget();

  readonly play = () => this.clock.play();
  readonly pause = () => this.clock.pause();
  readonly playPause = () => this.clock.toggle();
  readonly seek = (ms: number) => this.clock.seek(ms);
  readonly isScrubbing = () => this.clock.isScrubbing();
  readonly beginScrub = () => this.clock.beginScrub();
  readonly endScrub = () => this.clock.endScrub();
  readonly setSpeed = (speed: Speed) => this.clock.setSpeed(speed);
  readonly setSkipInactive = () => {};

  readonly getTime = () => this.clock.getTime();
  /** invariant: the same object until the clock's status or speed changes (useSyncExternalStore). */
  readonly getState = () => {
    const { status, speed } = this.clock.getSnapshot();
    if (status !== this.state.status || speed !== this.state.speed) this.state = this.readState();
    return this.state;
  };
  readonly getViewport = () => this.focused.getViewport();

  readonly subscribeTime = (listener: () => void) => this.clock.onTime(listener);
  readonly subscribeSeek = (listener: () => void) => this.clock.onSeek(listener);
  readonly subscribeState = (listener: () => void) => this.clock.subscribe(listener);
  readonly subscribeViewport = (listener: () => void) => {
    this.viewportListeners.add(listener);
    return () => void this.viewportListeners.delete(listener);
  };

  private readState(): PlayerState {
    const { status, speed } = this.clock.getSnapshot();
    return { status, speed, skipInactive: false };
  }

  private readonly notifyViewport = () => {
    for (const listener of this.viewportListeners) listener();
  };
}
