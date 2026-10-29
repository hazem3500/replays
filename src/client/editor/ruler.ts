/** Tick spacing: the smallest of these with at least ~72 px between labels. */
const TICK_STEPS = [100, 200, 500, 1000, 2000, 5000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000];
const LONGEST_STEP = 600_000;

/** The ruler's tick step and tick times for a track `width` px wide; shared by the timeline and its loading frame. */
export function rulerTicks(width: number, duration: number) {
  const tick = TICK_STEPS.find((step) => width > 0 && (step / Math.max(1, duration)) * width >= 72) ?? LONGEST_STEP;
  const ticks: number[] = [];
  if (width > 0) for (let at = 0; at <= duration; at += tick) ticks.push(at);
  return { tick, ticks };
}

/** A tick's time at the ruler's one precision: whole seconds, or tenths when ticks are under a second apart. */
export function tickLabel(ms: number, step: number) {
  const minutes = Math.floor(ms / 60_000);
  const seconds = (ms % 60_000) / 1000;
  const text = step >= 1000 ? String(Math.round(seconds)).padStart(2, '0') : seconds.toFixed(1).padStart(4, '0');
  return `${minutes}:${text}`;
}
