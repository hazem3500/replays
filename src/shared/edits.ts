import { normalizeCursor } from './cursor.ts';
import { type EditTimeline, editTimeline } from './edit-timeline.ts';
import { NO_EFFECTS, type PlaybackEffects, playbackEffects } from './effects.ts';
import { separateSpans } from './effect-room.ts';
import { renameSteps } from './step-names.ts';
import type { ReplayBundle, ReplayConsoleEntry, ReplayNetworkEntry, ReplayPerformanceEntry, ReplayStep } from './replay.ts';
import {
  changesTime,
  EDITS_VERSION,
  hasEffectEdits,
  isEmptyEdits,
  MAX_LABEL,
  type ReplayCut,
  type ReplayEdits,
  type StoredReplayEdits,
} from './edit-list.ts';

export {
  changesTime,
  EDITS_VERSION,
  EMPTY_EDITS,
  hasEffectEdits,
  isEmptyEdits,
  MAX_CUTS,
  MAX_HIGHLIGHTS,
  MAX_LABEL,
  MIN_EDIT_MS,
  type ReplayCut,
  type ReplayEdits,
  type ReplayHighlight,
  type ReplayPeriodHighlight,
  type ReplayPointHighlight,
  type StoredReplayEdits,
} from './edit-list.ts';
export { MAX_STEP_NAMES, renameSteps, stepNameKeys, withoutStepNames, withStepName } from './step-names.ts';
export { type EditTimeline, editTimeline, mergeRanges } from './edit-timeline.ts';
export { assertReplayEdits, assertStoredReplayEdits } from './edit-validation.ts';

/** The edit list of a stored sidecar (or a list), without revision and authorship. */
export function editListOf(stored: ReplayEdits | StoredReplayEdits): ReplayEdits {
  const sidecar: ReplayEdits & Partial<Pick<StoredReplayEdits, 'revision' | 'updatedBy' | 'updatedAt'>> = stored;
  const { revision: _revision, updatedBy: _by, updatedAt: _at, ...edits } = sidecar;
  return edits;
}

/** Only the edit list (no revision or authorship), with times rounded to whole ms and cuts in time order. */
export function normalizeEdits(edits: ReplayEdits): ReplayEdits {
  const round = Math.round;
  const cursor = normalizeCursor(edits.cursor);
  return {
    version: EDITS_VERSION,
    ...(edits.trim ? { trim: { start: round(edits.trim.start), end: round(edits.trim.end) } } : {}),
    cuts: edits.cuts
      .map((cut) => ({ id: cut.id, from: round(cut.from), to: round(cut.to), ...(cut.label ? { label: cut.label } : {}) }))
      .sort((a, b) => a.from - b.from || a.to - b.to || a.id.localeCompare(b.id)),
    ...effectLists(edits),
    ...(edits.highlights?.length
      ? {
          highlights: edits.highlights
            .map((highlight) =>
              highlight.kind === 'point'
                ? {
                    id: highlight.id,
                    kind: 'point' as const,
                    at: round(highlight.at),
                    ...(highlight.label?.trim() ? { label: highlight.label.trim() } : {}),
                  }
                : {
                    id: highlight.id,
                    kind: 'period' as const,
                    from: round(highlight.from),
                    to: round(highlight.to),
                    ...(highlight.label?.trim() ? { label: highlight.label.trim() } : {}),
                  },
            )
            .sort((a, b) => (a.kind === 'point' ? a.at : a.from) - (b.kind === 'point' ? b.at : b.from) || a.id.localeCompare(b.id)),
        }
      : {}),
    ...(cursor ? { cursor } : {}),
    ...stepNamesOf(edits),
  };
}

function stepNamesOf(edits: ReplayEdits): Pick<ReplayEdits, 'stepNames'> {
  const entries = Object.entries(edits.stepNames ?? {})
    .flatMap(([key, name]) => (name.trim() ? [[key, name.trim()] as const] : []))
    .sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }));
  return entries.length ? { stepNames: Object.fromEntries(entries) } : {};
}

const byTime = <T extends { from: number; to: number; id: string }>(a: T, b: T) =>
  a.from - b.from || a.to - b.to || a.id.localeCompare(b.id);
const frac = (value: number) => Math.round(value * 10_000) / 10_000;

/** The effect lists, normalized: whole ms, fractions to 4 places, in time order, empty lists left out. */
function effectLists(edits: ReplayEdits): Pick<ReplayEdits, 'zooms' | 'speeds' | 'blurs' | 'captions'> {
  const round = Math.round;
  const lists: Pick<ReplayEdits, 'zooms' | 'speeds' | 'blurs' | 'captions'> = {};
  if (edits.zooms?.length)
    lists.zooms = edits.zooms
      .map((zoom) => ({
        id: zoom.id,
        from: round(zoom.from),
        to: round(zoom.to),
        scale: Math.round(zoom.scale * 100) / 100,
        ...(zoom.x === undefined ? {} : { x: frac(zoom.x) }),
        ...(zoom.y === undefined ? {} : { y: frac(zoom.y) }),
      }))
      .sort(byTime);
  if (edits.speeds?.length)
    lists.speeds = edits.speeds
      .map((speed) => ({ id: speed.id, from: round(speed.from), to: round(speed.to), rate: speed.rate }))
      .sort(byTime);
  if (edits.blurs?.length)
    lists.blurs = edits.blurs
      .map((blur) => ({
        id: blur.id,
        from: round(blur.from),
        to: round(blur.to),
        x: frac(blur.x),
        y: frac(blur.y),
        width: frac(blur.width),
        height: frac(blur.height),
        ...(blur.style && blur.style !== 'blur' ? { style: blur.style } : {}),
      }))
      .sort(byTime);
  if (edits.captions?.length)
    // invariant: captions take turns; a list saved before that rule is separated here, on load and on every save.
    lists.captions = separateSpans(
      edits.captions.map((caption) => ({ id: caption.id, from: round(caption.from), to: round(caption.to), text: caption.text })),
    );
  return lists;
}

/** Same edits (ignoring revision, authorship, rounding and cut order). */
export function sameEdits(a: ReplayEdits, b: ReplayEdits) {
  return JSON.stringify(normalizeEdits(a)) === JSON.stringify(normalizeEdits(b));
}

/**
 * A short, stable version of an edit list's content (53-bit cyrb53 hash, base 36), '' for an empty list. Video
 * exports are cached per version (src/server/render-queue.ts), so an edited replay never gets a stale video and
 * the same edits never render twice. Synchronous and identical in Node and the browser.
 */
export function editsVersion(edits: ReplayEdits | undefined) {
  if (!edits || isEmptyEdits(edits)) return '';
  const text = JSON.stringify(normalizeEdits(edits));
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

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
export function applyEdits(source: ReplayBundle, edits: ReplayEdits | undefined): EditedBundle {
  const named = renameSteps(source.steps, edits?.stepNames);
  const bundle = named === source.steps ? source : { ...source, steps: [...named] };
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

/** Real time "Remove waits" leaves at both ends of a wait, so what led to it and what follows still read. */
export const WAIT_PAD_MS = 400;
/** A wait shorter than this (after padding) is not worth a cut. */
export const MIN_WAIT_CUT_MS = 500;

/**
 * "Remove waits": a cut for every `wait` step (the hourglass rows) from WAIT_PAD_MS after it starts to WAIT_PAD_MS
 * before the next step (or the end), when that leaves at least MIN_WAIT_CUT_MS to cut. Cuts already covering a
 * stretch are not proposed twice; `id` names each new cut.
 */
export function proposeWaitCuts(
  steps: readonly ReplayStep[],
  duration: number,
  existing: ReadonlyArray<{ from: number; to: number }> = [],
  id: (index: number) => string = (index) => `wait-${index}`,
): ReplayCut[] {
  const order = steps.map((step, index) => ({ step, index })).sort((a, b) => a.step.at - b.step.at || a.index - b.index);
  const cuts: ReplayCut[] = [];
  for (const [position, { step, index }] of order.entries()) {
    if (step.kind !== 'wait') continue;
    const next = order[position + 1]?.step.at ?? duration;
    const from = Math.round(step.at + WAIT_PAD_MS);
    const to = Math.round(Math.min(duration, next) - WAIT_PAD_MS);
    if (to - from < MIN_WAIT_CUT_MS) continue;
    if (existing.some((range) => range.from <= from && range.to >= to)) continue;
    cuts.push({ id: id(index), from, to, label: step.label.slice(0, MAX_LABEL) });
  }
  return cuts;
}
