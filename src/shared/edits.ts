/**
 * Non-destructive replay edits: a small JSON edit list stored next to the replay (`<id>/edits.json`,
 * src/server/store.ts), never inside the bundle. The viewer, the editor and the video export all read the
 * original bundle plus this list and apply it with `applyEdits`, so an edit can always be undone and the
 * original is always one click away.
 *
 * Every time in an edit list is on the ORIGINAL replay timeline (ms from the first rrweb event, the
 * timeline steps, console, network and performance entries already share). `editTimeline` maps it to the
 * EDITED timeline (trimmed, cuts removed) that playback, the scrubber, deep links and exports use.
 *
 * The format is deliberately plain (versioned, no derived data) so it can be handed to another tool later.
 */

import { assertCaptionStyle, normalizeCaptionStyle, type ReplayCaptionStyle } from './caption-style.ts';
import { assertReplayCursor, normalizeCursor, type ReplayCursorSettings } from './cursor.ts';
import {
  MAX_CAPTION,
  MAX_EFFECTS,
  MAX_ZOOM_SCALE,
  MIN_BLUR_SIZE,
  MIN_ZOOM_SCALE,
  NO_EFFECTS,
  type PlaybackEffects,
  playbackEffects,
  type ReplayBlur,
  type ReplayCaption,
  type ReplaySpeedRange,
  type ReplayZoomRegion,
  SPEED_RATES,
} from './effects.ts';
import type { ReplayBundle, ReplayConsoleEntry, ReplayNetworkEntry, ReplayPerformanceEntry, ReplayStep } from './replay.ts';

export const EDITS_VERSION = 1;
/** Most cuts one replay can hold. */
export const MAX_CUTS = 200;
/** Shortest stretch an edit may leave (and the shortest trim): anything shorter is a slip of the mouse. */
export const MIN_EDIT_MS = 100;
/** Longest free-form label. */
export const MAX_LABEL = 120;
/** Playback navigation annotations kept in the edits sidecar, never drawn into exports. */
export const MAX_HIGHLIGHTS = 200;

export interface ReplayPointHighlight {
  id: string;
  kind: 'point';
  at: number;
  label?: string;
}

export interface ReplayPeriodHighlight {
  id: string;
  kind: 'period';
  from: number;
  to: number;
  label?: string;
}

export type ReplayHighlight = ReplayPointHighlight | ReplayPeriodHighlight;

/** A stretch of the original replay that playback and exports skip. */
export interface ReplayCut {
  /** Stable within the list (`[a-z0-9-]`), so undo, selection and links can name a cut. */
  id: string;
  /** Original ms; `from < to`. */
  from: number;
  to: number;
  /** Optional note, e.g. the wait step it came from (free-form: sanitized by the server). */
  label?: string;
}

/** The edit list as the editor sends it (`PUT /api/replays/<id>/edits`). */
export interface ReplayEdits {
  version: typeof EDITS_VERSION;
  /** What remains of the original: [start, end) in original ms. Absent: the whole replay. */
  trim?: { start: number; end: number };
  cuts: ReplayCut[];
  /** Effects (src/shared/effects.ts), each a list of stretches on the original timeline; absent when empty. */
  zooms?: ReplayZoomRegion[];
  speeds?: ReplaySpeedRange[];
  blurs?: ReplayBlur[];
  captions?: ReplayCaption[];
  /** Playback navigation marks on the original timeline; not burned into MP4s. */
  highlights?: ReplayHighlight[];
  cursor?: ReplayCursorSettings;
  /** How the captions above look (src/shared/caption-style.ts); absent means the defaults. */
  captionStyle?: ReplayCaptionStyle;
}

/** As stored and served: the edit list plus who saved it last, and when. */
export interface StoredReplayEdits extends ReplayEdits {
  /** Bumped on every saved change (1 for the first save); 0 when nothing was ever saved. */
  revision: number;
  /** Identity (auth adapter id) of whoever saved it last. */
  updatedBy?: string;
  /** ISO time of the last save. */
  updatedAt?: string;
}

export const EMPTY_EDITS: ReplayEdits = { version: EDITS_VERSION, cuts: [] };

const EDIT_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const EDIT_FIELDS = ['version', 'trim', 'cuts', 'zooms', 'speeds', 'blurs', 'captions', 'highlights', 'cursor', 'captionStyle'];
const STORED_FIELDS = [...EDIT_FIELDS, 'revision', 'updatedBy', 'updatedAt'];

function object(value: unknown, name: string, allowed: readonly string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`);
  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).find((key) => !allowed.includes(key));
  if (unknown) throw new Error(`${name}.${unknown} is not a supported field`);
  return record;
}

function checkTime(value: unknown, name: string, duration: number | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`${name} must be a time in ms (0 or more)`);
  if (duration !== undefined && value > duration) throw new Error(`${name} is after the end of the replay`);
}

function fraction(value: unknown, name: string) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)
    throw new Error(`${name} must be a fraction from 0 to 1`);
}

/** A list of stretches (`id`, `from`, `to` plus `fields`), each checked by `check`. */
function stretches(
  value: unknown,
  name: string,
  fields: readonly string[],
  duration: number | undefined,
  check: (item: Record<string, unknown>, field: string) => void,
) {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length > MAX_EFFECTS) throw new Error(`${name} must be an array of at most ${MAX_EFFECTS}`);
  const ids = new Set<string>();
  for (const [index, raw] of value.entries()) {
    const field = `${name}[${index}]`;
    const item = object(raw, field, ['id', 'from', 'to', ...fields]);
    if (typeof item.id !== 'string' || !EDIT_ID.test(item.id)) throw new Error(`${field}.id must be lowercase letters, digits and dashes`);
    if (ids.has(item.id)) throw new Error(`${field}.id is used twice`);
    ids.add(item.id);
    checkTime(item.from, `${field}.from`, duration);
    checkTime(item.to, `${field}.to`, duration);
    if ((item.to as number) - (item.from as number) < MIN_EDIT_MS) throw new Error(`${field} must be at least ${MIN_EDIT_MS} ms long`);
    check(item, field);
  }
}

/** The effect lists of an edit list (zoom, speed, blur, captions): src/shared/effects.ts. */
function assertEffects(edits: Record<string, unknown>, name: string, duration: number | undefined) {
  stretches(edits.zooms, `${name}.zooms`, ['scale', 'x', 'y'], duration, (item, field) => {
    const scale = item.scale;
    if (typeof scale !== 'number' || !(scale >= MIN_ZOOM_SCALE && scale <= MAX_ZOOM_SCALE))
      throw new Error(`${field}.scale must be from ${MIN_ZOOM_SCALE} to ${MAX_ZOOM_SCALE}`);
    if (item.x !== undefined) fraction(item.x, `${field}.x`);
    if (item.y !== undefined) fraction(item.y, `${field}.y`);
  });
  stretches(edits.speeds, `${name}.speeds`, ['rate'], duration, (item, field) => {
    if (!SPEED_RATES.includes(item.rate as never)) throw new Error(`${field}.rate must be one of ${SPEED_RATES.join(', ')}`);
  });
  if (Array.isArray(edits.speeds)) {
    const sorted = [...(edits.speeds as ReplaySpeedRange[])].sort((a, b) => a.from - b.from);
    for (const [index, range] of sorted.entries()) {
      if (index > 0 && range.from < sorted[index - 1]!.to) throw new Error(`${name}.speeds must not overlap`);
    }
  }
  stretches(edits.blurs, `${name}.blurs`, ['x', 'y', 'width', 'height'], duration, (item, field) => {
    for (const key of ['x', 'y', 'width', 'height']) fraction(item[key], `${field}.${key}`);
    if ((item.width as number) < MIN_BLUR_SIZE || (item.height as number) < MIN_BLUR_SIZE) throw new Error(`${field} is too small`);
    if ((item.x as number) + (item.width as number) > 1.0001 || (item.y as number) + (item.height as number) > 1.0001)
      throw new Error(`${field} must stay inside the frame`);
  });
  stretches(edits.captions, `${name}.captions`, ['text'], duration, (item, field) => {
    if (typeof item.text !== 'string' || !item.text.trim() || item.text.length > MAX_CAPTION)
      throw new Error(`${field}.text must be text of 1 to ${MAX_CAPTION} characters`);
  });
}

function label(value: unknown, name: string) {
  if (value === undefined) return;
  if (typeof value !== 'string' || value.length > MAX_LABEL) throw new Error(`${name} must be text of at most ${MAX_LABEL} characters`);
}

function assertHighlights(value: unknown, duration: number | undefined, name: string) {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length > MAX_HIGHLIGHTS) throw new Error(`${name} must be an array of at most ${MAX_HIGHLIGHTS}`);
  const ids = new Set<string>();
  for (const [index, raw] of value.entries()) {
    const field = `${name}[${index}]`;
    const kind = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>).kind : undefined;
    const item = object(raw, field, kind === 'point' ? ['id', 'kind', 'at', 'label'] : ['id', 'kind', 'from', 'to', 'label']);
    if (typeof item.id !== 'string' || !EDIT_ID.test(item.id)) throw new Error(`${field}.id must be lowercase letters, digits and dashes`);
    if (ids.has(item.id)) throw new Error(`${field}.id is used twice`);
    ids.add(item.id);
    label(item.label, `${field}.label`);
    if (item.kind === 'point') checkTime(item.at, `${field}.at`, duration);
    else if (item.kind === 'period') {
      checkTime(item.from, `${field}.from`, duration);
      checkTime(item.to, `${field}.to`, duration);
      if ((item.to as number) - (item.from as number) < MIN_EDIT_MS) throw new Error(`${field} must be at least ${MIN_EDIT_MS} ms long`);
    } else throw new Error(`${field}.kind must be point or period`);
  }
}

/**
 * Validates an edit list (the editor's PUT body). With `duration` (the replay's, ms) every time must fall inside
 * the replay and something must remain once trimmed and cut. Throws an Error naming the field, like the other
 * validators in src/shared.
 */
export function assertReplayEdits(value: unknown, duration?: number, name = 'edits'): asserts value is ReplayEdits {
  const edits = object(value, name, EDIT_FIELDS);
  if (edits.version !== EDITS_VERSION) throw new Error(`${name}.version must be ${EDITS_VERSION}`);
  if (edits.trim !== undefined) {
    const trim = object(edits.trim, `${name}.trim`, ['start', 'end']);
    checkTime(trim.start, `${name}.trim.start`, duration);
    checkTime(trim.end, `${name}.trim.end`, duration);
    if ((trim.end as number) - (trim.start as number) < MIN_EDIT_MS)
      throw new Error(`${name}.trim must keep at least ${MIN_EDIT_MS} ms (start before end)`);
  }
  if (!Array.isArray(edits.cuts) || edits.cuts.length > MAX_CUTS) throw new Error(`${name}.cuts must be an array of at most ${MAX_CUTS}`);
  const ids = new Set<string>();
  for (const [index, raw] of edits.cuts.entries()) {
    const field = `${name}.cuts[${index}]`;
    const cut = object(raw, field, ['id', 'from', 'to', 'label']);
    if (typeof cut.id !== 'string' || !EDIT_ID.test(cut.id)) throw new Error(`${field}.id must be lowercase letters, digits and dashes`);
    if (ids.has(cut.id)) throw new Error(`${field}.id is used twice`);
    ids.add(cut.id);
    checkTime(cut.from, `${field}.from`, duration);
    checkTime(cut.to, `${field}.to`, duration);
    if ((cut.to as number) - (cut.from as number) < MIN_EDIT_MS) throw new Error(`${field} must be at least ${MIN_EDIT_MS} ms long`);
    label(cut.label, `${field}.label`);
  }
  if (edits.cursor !== undefined) assertReplayCursor(edits.cursor, `${name}.cursor`);
  if (edits.captionStyle !== undefined) assertCaptionStyle(edits.captionStyle, `${name}.captionStyle`);
  assertEffects(edits, name, duration);
  assertHighlights(edits.highlights, duration, `${name}.highlights`);
  if (duration !== undefined && editTimeline(edits as unknown as ReplayEdits, duration).duration < MIN_EDIT_MS) {
    throw new Error(`${name} remove the whole replay`);
  }
}

/** A stored sidecar: an edit list plus revision and authorship. */
export function assertStoredReplayEdits(value: unknown): asserts value is StoredReplayEdits {
  const stored = object(value, 'edits', STORED_FIELDS);
  const { revision, updatedBy, updatedAt, ...edits } = stored;
  assertReplayEdits(edits);
  if (!Number.isSafeInteger(revision) || Number(revision) < 0) throw new Error('edits.revision is invalid');
  if (updatedBy !== undefined && (typeof updatedBy !== 'string' || updatedBy.length > 254)) throw new Error('edits.updatedBy is invalid');
  if (updatedAt !== undefined && (typeof updatedAt !== 'string' || !Number.isFinite(Date.parse(updatedAt))))
    throw new Error('edits.updatedAt is invalid');
}

/** The edit list of a stored sidecar (or a list), without revision and authorship. */
export function editListOf(stored: ReplayEdits | StoredReplayEdits): ReplayEdits {
  const { revision: _revision, updatedBy: _by, updatedAt: _at, ...edits } = stored as StoredReplayEdits;
  return edits;
}

/** Only the edit list (no revision or authorship), with times rounded to whole ms and cuts in time order. */
export function normalizeEdits(edits: ReplayEdits): ReplayEdits {
  const round = Math.round;
  const cursor = normalizeCursor(edits.cursor);
  const captionStyle = normalizeCaptionStyle(edits.captionStyle);
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
    ...(captionStyle ? { captionStyle } : {}),
  };
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
      }))
      .sort(byTime);
  if (edits.captions?.length)
    lists.captions = edits.captions
      .map((caption) => ({ id: caption.id, from: round(caption.from), to: round(caption.to), text: caption.text }))
      .sort(byTime);
  return lists;
}

/** True when the list has no saved edit or playback-navigation annotation. */
export function isEmptyEdits(edits: ReplayEdits | undefined) {
  return !edits || (!edits.trim && edits.cuts.length === 0 && !hasEffectEdits(edits) && !edits.highlights?.length && !normalizeCaptionStyle(edits.captionStyle));
}

/** True when the list has any effect (zoom, speed, blur, caption or cursor presentation). */
export function hasEffectEdits(edits: ReplayEdits | undefined) {
  return Boolean(
    edits?.zooms?.length || edits?.speeds?.length || edits?.blurs?.length || edits?.captions?.length || normalizeCursor(edits?.cursor),
  );
}

/** True when the list changes timing (trim, cuts or speed-ups): the bundle has to be remapped. */
export function changesTime(edits: ReplayEdits | undefined) {
  return Boolean(edits && (edits.trim || edits.cuts.length || edits.speeds?.length));
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

/* ---------- Time mapping ---------- */

/** One stretch of the original timeline and how it plays: removed (rate 0), kept at 1×, or sped up (rate 1/n). */
interface Piece {
  from: number;
  to: number;
  /** Edited ms at `from`. */
  start: number;
  /** Edited ms per original ms: 0 removed, 1 kept, 1/n played n× faster. */
  rate: number;
}

/** Original ↔ edited time for one edit list and replay duration. */
export interface EditTimeline {
  /** Edited length, ms. */
  duration: number;
  /** The original replay's length, ms. */
  originalDuration: number;
  /** Removed stretches of the original (trimmed ends and cuts, merged), ascending. */
  removed: Array<{ from: number; to: number }>;
  /**
   * Edited time at original time `time` (clamped to the replay). Inside a removed stretch it is the edited time
   * where that stretch was taken out, so everything in it lands on the same instant.
   */
  toEdited(time: number): number;
  /** Original time shown at edited time `time`: where a cut point resumes (the end of the removed stretch). */
  toOriginal(time: number): number;
  /** True when original time `time` is trimmed off or cut (the trim end itself counts as removed). */
  isRemoved(time: number): boolean;
}

/** `ranges` clipped to [0, duration], merged where they touch or overlap, ascending. */
export function mergeRanges(ranges: ReadonlyArray<{ from: number; to: number }>, duration: number) {
  const sorted = ranges
    .map((range) => ({ from: Math.max(0, Math.min(duration, range.from)), to: Math.max(0, Math.min(duration, range.to)) }))
    .filter((range) => range.to > range.from)
    .sort((a, b) => a.from - b.from);
  const merged: Array<{ from: number; to: number }> = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (last && range.from <= last.to) last.to = Math.max(last.to, range.to);
    else merged.push({ ...range });
  }
  return merged;
}

export function editTimeline(edits: ReplayEdits | undefined, duration: number): EditTimeline {
  const total = Math.max(0, duration);
  const trim = edits?.trim;
  const removed = mergeRanges(
    [
      ...(trim ? [{ from: 0, to: trim.start }] : []),
      ...(edits?.cuts ?? []),
      ...(trim && trim.end < total ? [{ from: trim.end, to: total }] : []),
    ],
    total,
  );
  const pieces: Piece[] = [];
  let at = 0;
  let edited = 0;
  const push = (from: number, to: number, rate: number) => {
    if (to <= from) return;
    pieces.push({ from, to, start: edited, rate });
    edited += (to - from) * rate;
  };
  // Kept stretches play at 1×, except inside a speed-up range (cuts and trims win over speed-ups).
  const speeds = (edits?.speeds ?? [])
    .map((range) => ({ from: Math.max(0, range.from), to: Math.min(total, range.to), rate: range.rate }))
    .filter((range) => range.to > range.from)
    .sort((a, b) => a.from - b.from);
  const keep = (from: number, to: number) => {
    let cursor = from;
    for (const range of speeds) {
      if (range.to <= cursor || range.from >= to) continue;
      const start = Math.max(cursor, range.from);
      push(cursor, start, 1);
      const end = Math.min(to, range.to);
      push(start, end, 1 / range.rate);
      cursor = end;
    }
    push(cursor, to, 1);
  };
  for (const range of removed) {
    keep(at, range.from);
    push(range.from, range.to, 0);
    at = range.to;
  }
  keep(at, total);
  const editedDuration = edited;
  const trimEnd = trim && trim.end < total ? trim.end : undefined;

  const pieceAt = (time: number) => {
    // Binary search: the last piece starting at or before `time`.
    let low = 0;
    let high = pieces.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >>> 1;
      if (pieces[middle]!.from <= time) low = middle;
      else high = middle - 1;
    }
    return pieces[low];
  };
  return {
    duration: editedDuration,
    originalDuration: total,
    removed,
    toEdited(time) {
      const clamped = Math.max(0, Math.min(total, Number.isFinite(time) ? time : 0));
      const piece = pieceAt(clamped);
      if (!piece) return 0;
      return Math.min(editedDuration, piece.start + (Math.min(clamped, piece.to) - piece.from) * piece.rate);
    },
    toOriginal(time) {
      const clamped = Math.max(0, Math.min(editedDuration, Number.isFinite(time) ? time : 0));
      // The first kept piece that reaches `time`; a cut point resolves to the kept piece after the cut.
      let last: Piece | undefined;
      for (const piece of pieces) {
        if (piece.rate === 0) continue;
        last = piece;
        if (clamped < piece.start + (piece.to - piece.from) * piece.rate)
          return piece.from + Math.max(0, clamped - piece.start) / piece.rate;
      }
      return last ? last.to : (trimEnd ?? total);
    },
    isRemoved(time) {
      if (trimEnd !== undefined && time >= trimEnd) return true;
      return removed.some((range) => time >= range.from && time < range.to);
    },
  };
}

/* ---------- Applying edits to a bundle ---------- */

type BundleEvent = ReplayBundle['events'][number];
/** rrweb incremental data whose `positions[].timeOffset` are relative to the event (mouse/touch moves, drags). */
type PositionsData = { positions?: Array<Record<string, unknown> & { timeOffset?: number }> };

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
    const data = event.data as PositionsData | undefined;
    if (data && Array.isArray(data.positions) && edited !== time) {
      // Mouse positions are offsets back from their event: remap each, so a collapsed stretch moves at once.
      next.data = {
        ...data,
        positions: data.positions.map((position) =>
          typeof position.timeOffset === 'number'
            ? { ...position, timeOffset: timeline.toEdited(time + position.timeOffset) - edited }
            : position,
        ),
      };
    }
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

/* ---------- Proposals ---------- */

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
