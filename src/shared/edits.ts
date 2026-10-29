import { normalizeCursor } from './cursor.ts';
import type { ReplayStep } from './replay.ts';
import { EDITS_VERSION, isEmptyEdits, MAX_LABEL, type ReplayCut, type ReplayEdits, type StoredReplayEdits } from './edit-list.ts';

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
export { type EditTimeline, editTimeline, mergeRanges } from './edit-timeline.ts';
export { assertReplayEdits, assertStoredReplayEdits } from './edit-validation.ts';
export { applyEdits, bundleSpan, EDIT_END_TAG, type EditedBundle, editSteps } from './edit-bundle.ts';

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
        ...(blur.style && blur.style !== 'blur' ? { style: blur.style } : {}),
      }))
      .sort(byTime);
  if (edits.captions?.length)
    lists.captions = edits.captions
      .map((caption) => ({ id: caption.id, from: round(caption.from), to: round(caption.to), text: caption.text }))
      .sort(byTime);
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
