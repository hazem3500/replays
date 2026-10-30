import { normalizeCursor, type ReplayCursorSettings } from './cursor.ts';
import type { ReplayBlur, ReplayCaption, ReplaySpeedRange, ReplayZoomRegion } from './effects.ts';

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

/**
 * The edit list as the editor sends it (`PUT /api/replays/<id>/edits`): non-destructive, stored next to the replay
 * (`<id>/edits.json`) and never inside the bundle. Viewer, editor and video export all read the original bundle plus this
 * list and apply it with `applyEdits`, so an edit can always be undone. Every time is on the ORIGINAL replay timeline (ms
 * from the first rrweb event); `editTimeline` maps it to the EDITED one. Plain and versioned, with no derived data, so
 * another tool can read it.
 */
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

/** True when the list has no saved edit or playback-navigation annotation. */
export function isEmptyEdits(edits: ReplayEdits | undefined): boolean {
  return !edits || (!edits.trim && edits.cuts.length === 0 && !hasEffectEdits(edits) && !edits.highlights?.length);
}

/** True when the list has any effect (zoom, speed, blur, caption or cursor presentation). */
export function hasEffectEdits(edits: ReplayEdits | undefined): boolean {
  if (!edits) return false;
  const lists = [edits.zooms, edits.speeds, edits.blurs, edits.captions];
  return lists.some((list) => Boolean(list?.length)) || normalizeCursor(edits.cursor) !== undefined;
}

/** True when the list changes timing (trim, cuts or speed-ups): the bundle has to be remapped. */
export function changesTime(edits: ReplayEdits | undefined): boolean {
  return edits !== undefined && (edits.trim !== undefined || edits.cuts.length > 0 || Boolean(edits.speeds?.length));
}
