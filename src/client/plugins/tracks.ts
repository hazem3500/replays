import { MAX_TRACK_MARKERS, type TimelineMarker, type TimelineTone } from './api.ts';

/*
 * Timeline tracks (registerTimelineTrack): what a plugin's `markers(context)` returned, made safe to draw. Pure, so the
 * rules are unit-tested (test/viewer-slots.test.ts).
 */

const TONES: readonly TimelineTone[] = ['neutral', 'info', 'warn', 'error', 'accent'];
/** Longest marker label kept (characters); the hover card shows one line or two. */
const MAX_LABEL = 160;

export interface PlacedMarker {
  at: number;
  /** 0 for a point. */
  duration: number;
  label: string;
  tone: TimelineTone;
}

/**
 * Markers with a finite `atMs` and a non-empty label, clamped to the replay (`[0, duration]`, a range cut at the end),
 * sorted by time and capped at MAX_TRACK_MARKERS (the first that many by time). `dropped` counts what was left out.
 */
export function placeMarkers(raw: unknown, duration: number): { markers: PlacedMarker[]; dropped: number } {
  if (!Array.isArray(raw)) return { markers: [], dropped: 0 };
  const valid: PlacedMarker[] = [];
  let dropped = 0;
  for (const entry of raw as Partial<TimelineMarker>[]) {
    const at = entry?.atMs;
    const label = typeof entry?.label === 'string' ? entry.label.trim() : '';
    if (typeof at !== 'number' || !Number.isFinite(at) || !label || at > duration) {
      dropped += 1;
      continue;
    }
    const start = Math.max(0, at);
    const length = typeof entry.durationMs === 'number' && Number.isFinite(entry.durationMs) && entry.durationMs > 0 ? entry.durationMs : 0;
    valid.push({
      at: start,
      duration: length ? Math.max(0, Math.min(duration, at + length) - start) : 0,
      label: label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL - 1)}…` : label,
      tone: TONES.includes(entry.tone as TimelineTone) ? (entry.tone as TimelineTone) : 'neutral',
    });
  }
  valid.sort((a, b) => a.at - b.at);
  if (valid.length > MAX_TRACK_MARKERS) {
    dropped += valid.length - MAX_TRACK_MARKERS;
    valid.length = MAX_TRACK_MARKERS;
  }
  return { markers: valid, dropped };
}
