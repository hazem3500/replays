import { changesTime, hasEffectEdits, type ReplayEdits } from './edit-list.ts';
import { type EditTimeline, editTimeline } from './edit-timeline.ts';
import { NO_EFFECTS, type PlaybackEffects, playbackEffects } from './effects.ts';
import type { ReplayBundle, ReplayConsoleEntry, ReplayNetworkEntry, ReplayPerformanceEntry, ReplayStep } from './replay.ts';

type BundleEvent = ReplayBundle['events'][number];

const hasTimeOffset = (value: unknown): value is { timeOffset: number } =>
  typeof value === 'object' && value !== null && 'timeOffset' in value && typeof value.timeOffset === 'number';

/**
 * rrweb incremental data whose `positions[].timeOffset` are offsets back from their event (mouse/touch moves, drags): each
 * is remapped, so a collapsed stretch moves at once. Other data is returned as is.
 */
function remapPositions(data: unknown, remap: (offset: number) => number): unknown {
  if (typeof data !== 'object' || data === null || !('positions' in data) || !Array.isArray(data.positions)) return data;
  const positions: unknown[] = data.positions;
  return {
    ...data,
    positions: positions.map((position) => (hasTimeOffset(position) ? { ...position, timeOffset: remap(position.timeOffset) } : position)),
  };
}

/** rrweb's Custom event: marks the edited end so the replay's span (and its clock) matches the edited duration. */
const CUSTOM_EVENT = 5;
export const EDIT_END_TAG = 'replays-edit-end';

function mapEvents(events: ReplayBundle['events'], timeline: EditTimeline, end: number | undefined) {
  const first = events[0]?.timestamp ?? 0;
  const mapped: BundleEvent[] = [];
  for (const event of events) {
    const time = event.timestamp - first;
    if (end !== undefined && time > end) break;
    const edited = timeline.toEdited(time);
    const next: BundleEvent = { ...event, timestamp: first + edited };
    const data = edited === time ? event.data : remapPositions(event.data, (offset) => timeline.toEdited(time + offset) - edited);
    if (data !== event.data) next.data = data;
    mapped.push(next);
  }
  const last = mapped.at(-1)?.timestamp ?? first;
  if (first + timeline.duration > last || mapped.length < 2) {
    mapped.push({ type: CUSTOM_EVENT, timestamp: first + timeline.duration, data: { tag: EDIT_END_TAG, payload: {} } });
  }
  return mapped;
}

/**
 * Steps on the edited timeline. A step stays while any of its stretch (until the next step) is left: a step that
 * starts inside a cut but runs on past it moves to the cut point; one whose whole stretch is removed is dropped.
 * `indices` maps each kept step back to its index in the original list.
 */
export function editSteps(steps: readonly ReplayStep[], timeline: EditTimeline) {
  const kept: ReplayStep[] = [];
  const indices: number[] = [];
  const order = steps.map((step, index) => ({ step, index })).sort((a, b) => a.step.at - b.step.at || a.index - b.index);
  for (const [position, { step, index }] of order.entries()) {
    const nextAt = order[position + 1]?.step.at ?? timeline.originalDuration;
    const at = timeline.toEdited(step.at);
    if (timeline.isRemoved(step.at) && timeline.toEdited(nextAt) <= at) continue;
    kept.push({ ...step, at });
    indices.push(index);
  }
  return { steps: kept, indices };
}

function mapEntries<T extends { at: number }>(entries: readonly T[], timeline: EditTimeline, map?: (entry: T, at: number) => T) {
  const kept: T[] = [];
  for (const entry of entries) {
    if (timeline.isRemoved(entry.at)) continue;
    const at = timeline.toEdited(entry.at);
    kept.push(map ? map(entry, at) : { ...entry, at });
  }
  return kept;
}

/** The replay's own span: the rrweb track's length (as the player measures it), else meta.duration. */
export function bundleSpan(bundle: Pick<ReplayBundle, 'events' | 'meta'>) {
  const first = bundle.events[0]?.timestamp;
  const last = bundle.events.at(-1)?.timestamp;
  const span = first !== undefined && last !== undefined ? last - first : 0;
  return Math.max(1, span || bundle.meta.duration);
}

export interface EditedBundle {
  bundle: ReplayBundle;
  timeline: EditTimeline;
  /** Original index of each edited step. */
  stepIndices: number[];
  /** Zoom, blur and caption effects on the edited timeline (src/shared/effects.ts). */
  effects: PlaybackEffects;
}

/**
 * The bundle as the edits say it plays: events, steps, console, network and performance entries moved to the edited
 * timeline (trimmed and cut stretches collapse to one instant, so the page state after a cut is exactly the
 * original's) and rows inside removed stretches dropped. Pure; the input bundle is not changed. Viewer, editor
 * preview and the video export all use it, so they agree to the millisecond.
 */
export function applyEdits(bundle: ReplayBundle, edits: ReplayEdits | undefined): EditedBundle {
  const span = bundleSpan(bundle);
  const timeline = editTimeline(edits, span);
  if (!changesTime(edits)) {
    const effects = hasEffectEdits(edits) ? playbackEffects(edits, timeline, bundle.events) : NO_EFFECTS;
    return { bundle, timeline, stepIndices: bundle.steps.map((_, index) => index), effects };
  }
  const end = edits?.trim && edits.trim.end < span ? edits.trim.end : undefined;
  const { steps, indices } = editSteps(bundle.steps, timeline);
  const events = mapEvents(bundle.events, timeline, end);
  const edited: ReplayBundle = {
    ...bundle,
    meta: { ...bundle.meta, duration: Math.round(timeline.duration), eventCount: events.length },
    events,
    steps,
    console: mapEntries<ReplayConsoleEntry>(bundle.console, timeline),
    network: mapEntries<ReplayNetworkEntry>(bundle.network, timeline, (entry, at) => ({
      ...entry,
      at,
      duration: Math.max(0, timeline.toEdited(entry.at + entry.duration) - at),
    })),
  };
  if (bundle.performance) {
    edited.performance = { ...bundle.performance, entries: mapEntries<ReplayPerformanceEntry>(bundle.performance.entries, timeline) };
  }
  return { bundle: edited, timeline, stepIndices: indices, effects: playbackEffects(edits, timeline, events) };
}
