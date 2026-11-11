import { Replayer } from 'rrweb';
import { type PlayerState, type PlayHold, type Viewport, type Speed, type Listener } from './types.ts';
import { TargetOutline } from './target-outline.ts';
import { rrwebEvents } from './rrweb-wire.ts';
import { settleAnimations } from './settle-animations.ts';

import { withDottedMasks } from '../../shared/mask-display.ts';
import type { ReplayBundle } from '../../shared/replay.ts';
import { NO_EFFECTS, type PlaybackEffects } from '../../shared/effects.ts';
import { EffectsLayer } from '../effects-layer.ts';
import { ReplayCursor } from '../replay-cursor.ts';
import { firstPaintOffset, renderOffset, type SnapshotGroup, snapshotGroups } from '../snapshots.ts';
import { clampTime } from '../timeline.ts';
import { type IdleGap, idleGaps, INACTIVE_SKIP_SPEED } from '../../shared/skip.ts';

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
  private readonly source: ReplayBundle['meta']['source'];
  /** Documents on the timeline; every seek renders the one on screen at the target time. */
  private readonly groups: SnapshotGroup[];
  /** Stretches without interaction that "skip inactive" fast-forwards (src/shared/skip.ts). */
  readonly idleGaps: IdleGap[];
  /** The frame shown for 0:00 while paused: the first paint, not the possibly unstyled first snapshot. */
  private readonly firstPaint: number;
  private replayer: Replayer | undefined;
  /** Zoom, blur and caption effects (src/shared/effects.ts); zoom and blur are drawn by `layer` while mounted. */
  private effects: PlaybackEffects;
  private layer: EffectsLayer | undefined;
  private cursor: ReplayCursor | undefined;
  private time = 0;
  private state: PlayerState = { status: 'paused', speed: 1, skipInactive: false };
  private viewport: Viewport;
  private frame = 0;
  private resumeAfterScrub = false;
  /** Play was asked for before the renderer was mounted: it starts as soon as `mount` lands. */
  private startOnMount = false;
  /** While a run switch is pending (suite workspace), play requests belong to the run being switched to. */
  private hold: PlayHold | undefined;
  /** While the scrubber is dragged: the rrweb render runs throttled, the playhead updates on every move. */
  private scrubbing = false;
  private scrubTimer = 0;
  private scrubRenderedAt = 0;
  private scrubRenderCost = 0;
  private readonly timeListeners = new Set<Listener>();
  private readonly seekListeners = new Set<Listener>();
  private readonly stateListeners = new Set<Listener>();
  private readonly viewportListeners = new Set<Listener>();
  /** The recorded viewport's height, the page the export places captions against (render/main.ts). */

  constructor(bundle: ReplayBundle, options: { effects?: PlaybackEffects } = {}) {
    this.effects = options.effects ?? NO_EFFECTS;
    this.events = bundle.events;
    this.source = bundle.meta.source;
    this.duration = eventSpan(bundle.events, bundle.meta.duration);
    this.groups = snapshotGroups(bundle.events, bundle.network);
    this.firstPaint = firstPaintOffset(bundle.performance, bundle.events, this.groups, this.duration);
    this.idleGaps = idleGaps(
      bundle.events.map((event) => ({
        type: typeof event.type === 'number' ? event.type : -1,
        timestamp: event.timestamp,
        data: event.data,
      })),
    );
    this.viewport = { ...bundle.meta.viewport };
  }

  /** Mounts an rrweb Replayer into `root`; returns the cleanup. */
  mount(root: HTMLElement) {
    if (this.replayer) throw new Error('A playback supports one mounted renderer');
    const ownsMarker = !root.hasAttribute('data-replays-playback');
    root.setAttribute('data-replays-playback', '');
    const replayer = new Replayer(rrwebEvents(withDottedMasks(this.events)), {
      root,
      speed: this.state.speed,
      skipInactive: false,
      mouseTail: false,
      showWarning: false,
      triggerFocus: false,
      UNSAFE_replayCanvas: false,
    });
    replayer.on('resize', (dimension) => {
      if (typeof dimension !== 'object' || dimension === null || !('width' in dimension) || !('height' in dimension)) return;
      const { width, height } = dimension;
      if (typeof width === 'number' && typeof height === 'number' && width > 0 && height > 0) this.setViewport({ width, height });
    });
    replayer.on('finish', () => {
      if (this.state.status === 'playing') this.finish();
    });
    this.replayer = replayer;
    this.pauseAt(this.time);
    const cursor = new ReplayCursor(replayer.wrapper, this.events, this.events[0]?.timestamp ?? 0, {
      settings: this.effects.cursor,
      source: this.source,
    });
    this.cursor = cursor;
    cursor.update(this.time);
    const unsubscribeCursor = this.subscribeTime(() => cursor.update(this.time));
    const layer = new EffectsLayer(replayer.wrapper, () => this.viewport);
    layer.set(this.effects, this.time);
    this.layer = layer;
    const unsubscribeLayer = this.subscribeTime(() => layer.update(this.time));
    if (this.startOnMount) {
      this.startOnMount = false;
      this.play();
    }
    return () => {
      if (this.replayer !== replayer) return;
      unsubscribeLayer();
      layer.destroy();
      this.layer = undefined;
      unsubscribeCursor();
      cursor.destroy();
      this.cursor = undefined;
      this.stopLoop();
      this.cancelScrubRender();
      this.scrubbing = false;
      if (this.state.status === 'playing') this.setState({ status: 'paused' });
      this.replayer = undefined;
      this.targetOutline.destroy();
      replayer.destroy();
      root.replaceChildren();
      if (ownsMarker) root.removeAttribute('data-replays-playback');
    };
  }

  /** The effects drawn over the replay; the editor swaps them as edits change. */
  getEffects() {
    return this.effects;
  }

  setEffects(effects: PlaybackEffects) {
    this.effects = effects;
    this.cursor?.setSettings(effects.cursor);
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

  private readonly targetOutline = new TargetOutline();

  /** Outlines a selector only when its recorded document is on screen. */
  readonly highlightTarget = (selector: string, at: number) =>
    this.targetOutline.show(this.replayer, selector, this.snapshotSegment(at) === this.snapshotSegment(this.time));

  /** Which full snapshot (rrweb type 2: a new document) is on screen at `time`. */
  private snapshotSegment(time: number) {
    const start = this.events[0]?.timestamp ?? 0;
    let segment = -1;
    for (const event of this.events) {
      if (event.timestamp - start > time) break;
      if (event.type === 2) segment += 1;
    }
    return segment;
  }

  readonly clearTarget = () => {
    this.targetOutline.clear();
  };

  /**
   * Starts playback. Before the renderer is mounted (a run that is still loading its frame) the request is kept and
   * `state.starting` is set, so the play button can show it; it starts the moment `mount` lands. While a run switch
   * is pending, the request is handed to the switch's owner instead (`setPlayHold`) and nothing starts here.
   */
  readonly play = () => {
    if (this.hold) {
      this.hold.request();
      this.setState({ starting: true });
      return;
    }
    if (!this.replayer) {
      this.startOnMount = true;
      this.setState({ starting: true });
      return;
    }
    if (this.state.status === 'ended' || this.time >= this.duration) this.setTime(0);
    this.replayer.play(this.offsetFor(this.time));
    this.setState({ status: 'playing', starting: false });
    this.startLoop();
  };

  /** Hands play requests to `hold` (a pending run switch), or takes them back with `undefined`. */
  readonly setPlayHold = (hold: PlayHold | undefined) => {
    this.hold = hold;
    if (!hold && this.state.starting && !this.startOnMount) this.setState({ starting: false });
  };

  readonly pause = () => {
    this.hold?.cancel();
    if (this.state.starting) {
      this.startOnMount = false;
      this.setState({ starting: false });
    }
    if (this.state.status !== 'playing') return;
    this.stopLoop();
    this.replayer?.pause();
    this.setTime(clampTime(this.replayer?.getCurrentTime() ?? this.time, this.duration));
    this.setState({ status: 'paused' });
  };

  readonly playPause = () => {
    if (this.state.status === 'playing' || this.state.starting) this.pause();
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
      this.pauseAt(at);
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
    if (this.scrubTimer) {
      this.cancelScrubRender();
      this.renderAt(this.time);
    }
    if (this.resumeAfterScrub) this.play();
    this.resumeAfterScrub = false;
  };

  readonly setSpeed = (speed: Speed) => {
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

  private pauseAt(time: number) {
    const replayer = this.replayer;
    if (!replayer) return;
    // invariant: only the picture changes; the playhead stays at `time`, and play() starts from it.
    replayer.pause(this.offsetFor(time === 0 ? this.firstPaint : time));
    settleAnimations(replayer.iframe.contentDocument);
  }

  private renderAt(time: number) {
    const started = performance.now();
    this.pauseAt(time);
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
