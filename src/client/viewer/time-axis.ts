/**
 * One time axis for every timing view: Network's Timing column, Performance's neighbourhood chart and the scrubber's
 * ranges. The domain defaults to the replay's (edited) duration, the scrubber's domain, so a bar at 40 % of a column
 * sits under 40 % of the seek bar. Times are on the player's clock (already mapped through edits by `buildWaterfall`).
 */
export interface TimeDomain {
  from: number;
  to: number;
}

export interface TimeTick {
  ms: number;
  x: number;
  label: string;
}

export interface TimeScale {
  domain: TimeDomain;
  width: number;
  /** Position of `ms` in [0, width] (unclamped outside the domain). */
  x(ms: number): number;
  /** The time at position `x`. */
  ms(x: number): number;
  /** About `count` evenly spaced ticks on round steps, inside the domain. */
  ticks(count: number): TimeTick[];
}

const STEPS = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000];

/** The replay's whole span; never empty, so a 0 ms replay still draws. */
export function replayDomain(duration: number): TimeDomain {
  return { from: 0, to: Math.max(1, Number.isFinite(duration) ? duration : 1) };
}

/** A domain at least `minSpan` wide, ordered, and clamped to `bounds`. */
export function clampDomain(domain: TimeDomain, bounds: TimeDomain, minSpan = 50): TimeDomain {
  let from = Math.max(bounds.from, Math.min(domain.from, domain.to));
  let to = Math.min(bounds.to, Math.max(domain.from, domain.to));
  if (to - from < minSpan) {
    const middle = (from + to) / 2;
    from = Math.max(bounds.from, middle - minSpan / 2);
    to = Math.min(bounds.to, from + minSpan);
  }
  return { from, to };
}

export function timeScale(domain: TimeDomain, width: number): TimeScale {
  const span = Math.max(1e-9, domain.to - domain.from);
  const x = (ms: number) => ((ms - domain.from) / span) * width;
  const ms = (position: number) => domain.from + (position / Math.max(1e-9, width)) * span;
  const ticks = (count: number) => {
    const step = tickStep(span, Math.max(1, count));
    const first = Math.ceil(domain.from / step) * step;
    const out: TimeTick[] = [];
    for (let at = first; at <= domain.to + 1e-6; at += step) out.push({ ms: at, x: x(at), label: tickLabel(at, step) });
    return out;
  };
  return { domain, width, x, ms, ticks };
}

/** The smallest round step that gives at most `count` intervals across `span`. */
export function tickStep(span: number, count: number) {
  return STEPS.find((step) => span / step <= count) ?? Math.ceil(span / count / 60_000) * 60_000;
}

/** "0:03", or "0:03.5" when the step is not whole seconds, so neighbouring ticks never read the same. */
export function tickLabel(ms: number, step: number) {
  const tenths = Math.round(Math.max(0, ms) / 100);
  const minutes = Math.floor(tenths / 600);
  const seconds = Math.floor((tenths % 600) / 10);
  const head = `${minutes}:${String(seconds).padStart(2, '0')}`;
  return step % 1000 ? `${head}.${tenths % 10}` : head;
}

/** A span as the column clips it, in percent of the domain (for CSS left/width), with a minimum visible width handled by CSS. */
export function spanPercent(scale: TimeScale, from: number, to: number) {
  const left = Math.max(0, Math.min(100, (scale.x(from) / scale.width) * 100));
  const right = Math.max(0, Math.min(100, (scale.x(to) / scale.width) * 100));
  return { left, width: Math.max(0, right - left), clipped: from < scale.domain.from || to > scale.domain.to };
}
