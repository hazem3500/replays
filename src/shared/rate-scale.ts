import { MAX_SPEED_RATE, MIN_SPEED_RATE, SPEED_RATES } from './effects.ts';
import { PLAYBACK_SPEEDS } from './render-variant.ts';

/**
 * The rate slider's scale. Rates come in steps that widen with the rate (0.25 up to 4, 0.5 up to 8, whole numbers
 * above), and the slider's own axis is the index into that list, so each step takes the same room on the track and
 * the low rates get the resolution. invariant: every value is a multiple of 0.25, so it is exact in a float.
 */
function stepFor(rate: number) {
  if (rate < 4) return 0.25;
  return rate < 8 ? 0.5 : 1;
}

function buildRates() {
  const rates: number[] = [];
  for (let rate = MIN_SPEED_RATE; rate <= MAX_SPEED_RATE;) {
    rates.push(rate);
    rate += stepFor(rate);
  }
  return rates;
}

export const RATE_STEPS: readonly number[] = buildRates();
export const RATE_LAST_INDEX = RATE_STEPS.length - 1;
/** Where Page Up and Page Down land: the presets and the two ends. */
export const RATE_JUMPS: readonly number[] = [MIN_SPEED_RATE, ...SPEED_RATES, MAX_SPEED_RATE];

/** The step nearest `rate`, as an index on the slider's axis (the lower one on a tie). */
export function rateIndex(rate: number) {
  let nearest = 0;
  for (const [index, step] of RATE_STEPS.entries())
    if (Math.abs(step - rate) < Math.abs((RATE_STEPS[nearest] ?? 0) - rate)) nearest = index;
  return nearest;
}

/** The rate at a slider index, clamped to the scale. */
export function rateAt(index: number) {
  return RATE_STEPS[Math.min(RATE_LAST_INDEX, Math.max(0, Math.round(index)))] ?? MIN_SPEED_RATE;
}

/** The scale's step nearest `rate`: what an off-scale value (from an older or hand-written list) reads as. */
export const snapRate = (rate: number) => rateAt(rateIndex(rate));

/** The next preset (or end of the scale) above `rate` for +1, below it for -1; `rate` itself stays when there is none. */
export function jumpRate(rate: number, direction: 1 | -1) {
  const found = direction > 0 ? RATE_JUMPS.find((jump) => jump > rate) : RATE_JUMPS.findLast((jump) => jump < rate);
  return found ?? rate;
}

/** The fastest player speed that does not exceed `rate`: the editor's preview plays a stretch at it. */
export function previewSpeed(rate: number) {
  return PLAYBACK_SPEEDS.findLast((speed) => speed <= rate) ?? 1;
}
