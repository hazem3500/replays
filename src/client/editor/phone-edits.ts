import { MIN_EDIT_MS, type ReplayEdits } from '../../shared/edits.ts';
import { addEffect, type EffectKind, effectList, type EffectRegion, moveEffect } from './state.ts';

/** A region's own settings (scale, rate, box, text): everything but where it sits. */
function settingsOf(region: EffectRegion): Record<string, unknown> {
  const { id: _id, from: _from, to: _to, ...settings } = region;
  return settings;
}

interface SplitAt {
  kind: EffectKind;
  id: string;
  /** Where the region splits (ms, original timeline). */
  time: number;
  duration: number;
}

/**
 * Splits a region at `time` into two with the same settings; the right half gets a fresh id and is returned.
 * Undefined when `time` is outside the region or either half would be shorter than MIN_EDIT_MS.
 */
export function splitEffect(edits: ReplayEdits, { kind, id, time, duration }: SplitAt) {
  const region = effectList(edits, kind).find((item) => item.id === id);
  if (!region || time - region.from < MIN_EDIT_MS || region.to - time < MIN_EDIT_MS) return;
  const left = moveEffect(edits, kind, id, 'to', time, duration);
  return addEffect(left, kind, time, region.to, duration, settingsOf(region));
}

/**
 * A copy of a region placed right after it, as long as the time left allows (speed-ups keep to free time). Undefined
 * when no room is left for at least MIN_EDIT_MS.
 */
export function duplicateEffect(edits: ReplayEdits, kind: EffectKind, id: string, duration: number) {
  const region = effectList(edits, kind).find((item) => item.id === id);
  if (!region) return;
  return addEffect(edits, kind, region.to, region.to + (region.to - region.from), duration, settingsOf(region));
}
