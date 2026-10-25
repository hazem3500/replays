import { PLAYBACK_SPEEDS } from '../shared/render-variant.ts';
import { createContext, useContext, useSyncExternalStore } from 'react';
import { Replayer } from 'rrweb';
import 'rrweb/dist/style.css';

import { withDottedMasks } from '../shared/mask-display.ts';
import type { ReplayBundle } from '../shared/replay.ts';
import { NO_EFFECTS, type PlaybackEffects } from '../shared/effects.ts';
import { EffectsLayer } from './effects-layer.ts';
import { ReplayCursor } from './replay-cursor.ts';
import { renderOffset, type SnapshotGroup, snapshotGroups } from './snapshots.ts';
import { clampTime } from './timeline.ts';
import { type IdleGap, idleGaps, INACTIVE_SKIP_SPEED } from '../shared/skip.ts';

export const SPEEDS = PLAYBACK_SPEEDS;
export type Speed = (typeof SPEEDS)[number];
export type PlaybackStatus = 'paused' | 'playing' | 'ended';

export interface PlayerState {
  status: PlaybackStatus;
  /** The chosen speed; a skip's fast-forward never changes it. */
  speed: Speed;
  skipInactive: boolean;
  /** The idle gap being fast-forwarded right now, if any. */
  skipping?: IdleGap | undefined;
}

export interface Viewport {
  width: number;
  height: number;
}

type Listener = () => void;

/** Longest pause between replay renders while the scrubber is dragged (the playhead itself follows every move). */
const SCRUB_RENDER_MAX_WAIT = 150;

/** Duration of the rrweb track; the replayer's own clock runs over the same span. */
export function eventSpan(events: ReplayBundle['events'], fallback: number) {
  const first = events[0]?.timestamp;
  const last = events.at(-1)?.timestamp;
  const span = first !== undefined && last !== undefined ? last - first : 0;
  return Math.max(1, span || fallback);
}

/**
 * Owns playback for one replay bundle. Time and state are separate external
 * stores so only the components that show the playhead re-render per frame.
 * This is the player API later features (shortcuts, permalinks, error
 * markers) build on: play, pause, playPause, seek(ms), setSpeed, setSkipInactive.
 */
export class ReplayController {
  readonly duration: number;
  private readonly events: ReplayBundle['events'];
  /** Documents on the timeline; every seek renders the one on screen at the target time. */
  private readonly groups: SnapshotGroup[];
  /** Stretches without interaction that "skip inactive" fast-forwards (src/shared/skip.ts). */
  readonly idleGaps: IdleGap[];
  private replayer: Replayer | undefined;
  /** Zoom, blur and caption effects (src/shared/effects.ts); zoom and blur are drawn by `layer` while mounted. */
  private effects: PlaybackEffects;
  private layer: EffectsLayer | undefined;
  private time = 0;
  private state: PlayerState = { status: 'paused', speed: 1, skipInactive: true };
  private viewport: Viewport;
  private frame = 0;
  private resumeAfterScrub = false;
  /** While the scrubber is dragged: the rrweb render runs throttled, the playhead updates on every move. */
  private scrubbing = false;
  private scrubTimer = 0;
  private scrubRenderedAt = 0;
  private scrubRenderCost = 0;
  private readonly timeListeners = new Set<Listener>();
  private readonly seekListeners = new Set<Listener>();
  private readonly stateListeners = new Set<Listener>();
  private readonly viewportListeners = new Set<Listener>();

  constructor(bundle: ReplayBundle, options: { effects?: PlaybackEffects } = {}) {
    this.effects = options.effects ?? NO_EFFECTS;
    this.events = bundle.events;
    this.duration = eventSpan(bundle.events, bundle.meta.duration);
    this.groups = snapshotGroups(bundle.events, bundle.network);
    this.idleGaps = idleGaps(bundle.events as unknown as Array<{ type: number; timestamp: number; data?: unknown }>);
    this.viewport = { ...bundle.meta.viewport };
  }

  /** Mounts an rrweb Replayer into `root`; returns the cleanup. */
  mount(root: HTMLElement) {
    // Masked fields show as password dots, not rrweb's asterisks (display only).
    const replayer = new Replayer(withDottedMasks(this.events) as never, {
      root,
      speed: this.state.speed,
      // Our own skip (see updateSkip): rrweb's waits for 10 s gaps and then takes ~5 s to cross any of them.
      skipInactive: false,
      mouseTail: false,
      showWarning: false,
      triggerFocus: false,
      UNSAFE_replayCanvas: false,
    });
    replayer.on('resize', (dimension) => {
      const { width, height } = dimension as Viewport;
      if (width > 0 && height > 0) this.setViewport({ width, height });
    });
    // rrweb also reports 'finish' when a paused seek lands after the last event; only playback can end.
    replayer.on('finish', () => {
      if (this.state.status === 'playing') this.finish();
    });
    this.replayer = replayer;
    replayer.pause(this.offsetFor(this.time));
    // Replay cursor: our own overlay (rrweb's mouse is hidden in CSS), a pure function of the playhead.
    const cursor = new ReplayCursor(replayer.wrapper, this.events, this.events[0]?.timestamp ?? 0);
    cursor.update(this.time);
    const unsubscribeCursor = this.subscribeTime(() => cursor.update(this.time));
    const layer = new EffectsLayer(replayer.wrapper, () => this.viewport);
    layer.set(this.effects, this.time);
    this.layer = layer;
    const unsubscribeLayer = this.subscribeTime(() => layer.update(this.time));
    return () => {
      unsubscribeLayer();
      layer.destroy();
      this.layer = undefined;
      unsubscribeCursor();
      cursor.destroy();
      this.stopLoop();
      this.cancelScrubRender();
      this.scrubbing = false;
      if (this.state.status === 'playing') this.setState({ status: 'paused' });
      this.replayer = undefined;
      replayer.destroy();
      root.replaceChildren();
    };
  }

  /** The effects drawn over the replay; the editor swaps them as edits change. */
  getEffects() {
    return this.effects;
  }

  setEffects(effects: PlaybackEffects) {
    this.effects = effects;
    this.layer?.set(effects, this.time);
  }

  /** Holds the zoom at 1× (the editor, while a blur box is being placed). */
  setZoomSuspended(suspended: boolean) {
    this.layer?.setZoomSuspended(suspended, this.time);
  }

  /** Recorded events: how heavy a mount (and the first render) will be. */
  get eventCount() {
    return this.events.length;
  }

  get wrapper() {
    return this.replayer?.wrapper;
  }

  private targetOutline: HTMLElement | undefined;

  /**
   * Outlines what `selector` matches in the replayed page right now (the first match), in the replay's own
   * coordinates, so it scales with the player like the cursor. Read-only: one querySelectorAll on the
   * replay document, inside try/catch; nothing from the recording runs. Returns the match count (0: nothing).
   */
  readonly highlightTarget = (selector: string, at: number) => {
    const replayer = this.replayer;
    const document = replayer?.iframe.contentDocument;
    // Only when the step's page is the one on screen: both times fall in the same full-snapshot segment.
    if (!replayer || !document || this.snapshotSegment(at) !== this.snapshotSegment(this.time)) {
      this.clearTarget();
      return 0;
    }
    let matches: Element[] = [];
    try {
      matches = Array.from(document.querySelectorAll(selector));
    } catch {
      matches = [];
    }
    const first = matches.find((element) => element.getBoundingClientRect().width > 0 || element.getBoundingClientRect().height > 0);
    if (!first) {
      this.clearTarget();
      return 0;
    }
    const box = first.getBoundingClientRect();
    let outline = this.targetOutline;
    if (!outline || !outline.isConnected) {
      outline = replayer.wrapper.ownerDocument.createElement('div');
      outline.className = 'target-outline';
      outline.setAttribute('aria-hidden', 'true');
      outline.dataset.testid = 'target-outline';
      replayer.wrapper.append(outline);
      this.targetOutline = outline;
    }
    outline.style.transform = `translate(${box.left}px, ${box.top}px)`;
    outline.style.width = `${box.width}px`;
    outline.style.height = `${box.height}px`;
    outline.dataset.visible = '';
    return matches.length;
  };

  /** Which full snapshot (rrweb type 2: a new document) is on screen at `time`. */
  private snapshotSegment(time: number) {
    const start = this.events[0]?.timestamp ?? 0;
    let segment = -1;
    for (const event of this.events) {
      if (event.timestamp - start > time) break;
      if ((event as { type?: number }).type === 2) segment += 1;
    }
    return segment;
  }

  readonly clearTarget = () => {
    if (this.targetOutline) delete this.targetOutline.dataset.visible;
  };

  readonly play = () => {
    if (!this.replayer) return;
    if (this.state.status === 'ended' || this.time >= this.duration) this.setTime(0);
    this.replayer.play(this.offsetFor(this.time));
    this.setState({ status: 'playing' });
    this.startLoop();
  };

  readonly pause = () => {
    if (this.state.status !== 'playing') return;
    this.stopLoop();
    this.replayer?.pause();
    this.setTime(clampTime(this.replayer?.getCurrentTime() ?? this.time, this.duration));
    this.setState({ status: 'paused' });
  };

  readonly playPause = () => {
    if (this.state.status === 'playing') this.pause();
    else this.play();
  };

  /**
   * Jumps to `ms` and keeps the current play/pause state. Outside a scrub the replay renders the target
   * synchronously; during a scrub the playhead moves at once and the rrweb render is throttled (renderScrub).
   */
  readonly seek = (ms: number) => {
    const at = clampTime(ms, this.duration);
    this.setTime(at);
    for (const listener of this.seekListeners) listener();
    if (this.scrubbing && this.state.status !== 'playing') {
      this.scheduleScrubRender();
      return;
    }
    if (this.state.status === 'playing') {
      this.replayer?.play(this.offsetFor(at));
    } else {
      this.replayer?.pause(this.offsetFor(at));
      if (this.state.status === 'ended') this.setState({ status: 'paused' });
    }
  };

  /** True while a scrubber (or the inspector's now divider) is being dragged. */
  readonly isScrubbing = () => this.scrubbing;

  /** Pauses while the scrubber is dragged so the replayer is not rebuilt on every input event. */
  readonly beginScrub = () => {
    this.resumeAfterScrub = this.state.status === 'playing';
    this.pause();
    this.scrubbing = true;
    this.scrubRenderedAt = 0;
  };

  readonly endScrub = () => {
    if (!this.scrubbing) return;
    this.scrubbing = false;
    // Land exactly where the drag stopped before playback resumes.
    if (this.scrubTimer) {
      this.cancelScrubRender();
      this.renderAt(this.time);
    }
    if (this.resumeAfterScrub) this.play();
    this.resumeAfterScrub = false;
  };

  readonly setSpeed = (speed: Speed) => {
    // Mid-skip the fast-forward keeps going; the new speed applies when it ends.
    if (!this.state.skipping) this.replayer?.setConfig({ speed });
    this.setState({ speed });
  };

  readonly setSkipInactive = (skipInactive: boolean) => {
    this.setState({ skipInactive });
    if (!skipInactive) this.endSkip();
  };

  /**
   * Called every playback frame: inside an idle gap (with skip inactive on) the replayer runs at
   * INACTIVE_SKIP_SPEED until the gap's end, then back at the chosen speed. Time always comes from rrweb's
   * own clock (getCurrentTime), so the scrubber, steps, inspector and cursor follow the fast-forward exactly.
   */
  private updateSkip() {
    const time = this.time;
    const gap = this.state.skipInactive ? this.idleGaps.find((item) => time >= item.from && time < item.to) : undefined;
    if (gap === this.state.skipping) return;
    if (!gap) return this.endSkip();
    this.replayer?.setConfig({ speed: Math.max(this.state.speed, INACTIVE_SKIP_SPEED) });
    this.setState({ skipping: gap });
  }

  private endSkip() {
    if (!this.state.skipping) return;
    this.replayer?.setConfig({ speed: this.state.speed });
    this.setState({ skipping: undefined });
  }

  readonly getTime = () => this.time;
  readonly getState = () => this.state;
  readonly getViewport = () => this.viewport;

  readonly subscribeTime = (listener: Listener) => subscribe(this.timeListeners, listener);
  /** Explicit jumps (keys, steps, errors, scrubbing), not the playback clock. */
  readonly subscribeSeek = (listener: Listener) => subscribe(this.seekListeners, listener);
  readonly subscribeState = (listener: Listener) => subscribe(this.stateListeners, listener);
  readonly subscribeViewport = (listener: Listener) => subscribe(this.viewportListeners, listener);

  /** rrweb offset that shows the document on screen at `time` (see renderOffset). */
  private offsetFor(time: number) {
    return renderOffset(this.groups, time);
  }

  /**
   * Leading render when the replay has been idle, then at most one trailing render per wait. The wait
   * follows the last render's cost (twice it, capped), so cheap replays still render every frame while
   * a heavy one keeps the main thread free for the playhead between renders.
   */
  private scheduleScrubRender() {
    if (this.scrubTimer) return;
    const wait = Math.min(SCRUB_RENDER_MAX_WAIT, this.scrubRenderCost * 2) - (performance.now() - this.scrubRenderedAt);
    if (wait <= 0) {
      this.renderAt(this.time);
      return;
    }
    this.scrubTimer = window.setTimeout(() => {
      this.scrubTimer = 0;
      this.renderAt(this.time);
    }, wait);
  }

  private cancelScrubRender() {
    window.clearTimeout(this.scrubTimer);
    this.scrubTimer = 0;
  }

  private renderAt(time: number) {
    const started = performance.now();
    this.replayer?.pause(this.offsetFor(time));
    this.scrubRenderedAt = performance.now();
    this.scrubRenderCost = this.scrubRenderedAt - started;
    if (this.state.status === 'ended') this.setState({ status: 'paused' });
  }

  private finish() {
    this.stopLoop();
    this.setTime(this.duration);
    this.setState({ status: 'ended' });
  }

  private startLoop() {
    this.stopLoop();
    const tick = () => {
      if (!this.replayer || this.state.status !== 'playing') return;
      const current = this.replayer.getCurrentTime();
      if (Number.isFinite(current)) this.setTime(clampTime(current, this.duration));
      this.updateSkip();
      if (this.time >= this.duration) {
        this.finish();
        return;
      }
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private stopLoop() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    // Paused, seeking or finished: no fast-forward carries over.
    this.endSkip();
  }

  private setTime(time: number) {
    if (time === this.time) return;
    this.time = time;
    for (const listener of this.timeListeners) listener();
  }

  private setState(patch: Partial<PlayerState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.stateListeners) listener();
  }

  private setViewport(viewport: Viewport) {
    if (viewport.width === this.viewport.width && viewport.height === this.viewport.height) return;
    this.viewport = viewport;
    for (const listener of this.viewportListeners) listener();
  }
}

function subscribe(listeners: Set<Listener>, listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const PlayerContext = createContext<ReplayController | null>(null);

export function usePlayer() {
  const player = useContext(PlayerContext);
  if (!player) throw new Error('usePlayer needs a PlayerContext provider');
  return player;
}

/**
 * Subscribes to the playhead. Pass a selector that returns a primitive (an
 * index, a count) so the component re-renders only when that value changes.
 */
export function usePlayhead(): number;
export function usePlayhead<T>(select: (time: number) => T): T;
export function usePlayhead<T>(select?: (time: number) => T) {
  const player = usePlayer();
  return useSyncExternalStore(player.subscribeTime, () => (select ? select(player.getTime()) : player.getTime()));
}

export function usePlayerState() {
  const player = usePlayer();
  return useSyncExternalStore(player.subscribeState, player.getState);
}

export function useViewport() {
  const player = usePlayer();
  return useSyncExternalStore(player.subscribeViewport, player.getViewport);
}
