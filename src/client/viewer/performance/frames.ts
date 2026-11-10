import type { EditTimeline } from '../../../shared/edits.ts';
import { type FrameSample, type FrameVerdict, fpsVerdict, sampleFps } from '../../../shared/frame-timing.ts';

/** One second of frame rate on the player's clock (after edits). */
export interface FrameBand {
  at: number;
  end: number;
  fps: number;
  dropped: number;
  verdict: FrameVerdict;
}

/** Frame samples as bands on the player's clock; samples inside a cut are dropped. */
export function frameBands(samples: readonly FrameSample[] | undefined, timeline?: EditTimeline): FrameBand[] {
  return (samples ?? []).flatMap((sample) => {
    const stop = sample.at + sample.elapsed;
    if (timeline && (timeline.isRemoved(sample.at) || sample.at > timeline.originalDuration)) return [];
    const at = timeline ? timeline.toEdited(sample.at) : sample.at;
    const end = timeline ? timeline.toEdited(Math.min(stop, timeline.originalDuration)) : stop;
    if (end <= at) return [];
    const fps = sampleFps(sample);
    return [{ at, end, fps, dropped: sample.dropped, verdict: fpsVerdict(fps) }];
  });
}

/** The band holding `time`, or undefined in a gap. */
export function bandAt(bands: readonly FrameBand[], time: number) {
  return bands.find((band) => time >= band.at && time < band.end);
}

/** The second's sample nearest `time` within `within` ms, so the last moments of a recording still read its closing second. */
export function nearestBand(bands: readonly FrameBand[], time: number, within = 1000) {
  const distance = (band: FrameBand) => (time < band.at ? band.at - time : Math.max(0, time - band.end));
  const [nearest] = bands.toSorted((a, b) => distance(a) - distance(b));
  return nearest && distance(nearest) <= within ? nearest : undefined;
}

/** Plot space: x runs 0 to `SPARK_WIDTH` over the replay, y runs 0 (top, the ceiling) to `SPARK_HEIGHT` (0 FPS). */
export const SPARK_WIDTH = 1000;
export const SPARK_HEIGHT = 100;
/** A hole wider than this between two samples breaks the line; a cut's seam sits closer than this. */
const GAP_MS = 250;
/** The frame-rate chart's reference lines. */
export const FPS_GUIDES = [60, 30] as const;
const REFERENCE_FPS = 120;
const CEILING_STEP = 30;

export interface SparkPoint {
  x: number;
  y: number;
}

/** The chart's top: 120 FPS, so the 60 and 30 guides sit apart, or the next 30 above the fastest second on a faster display. */
export function fpsCeiling(bands: readonly FrameBand[]) {
  const fastest = bands.reduce((most, band) => Math.max(most, band.fps), 0);
  return Math.max(REFERENCE_FPS, Math.ceil(fastest / CEILING_STEP) * CEILING_STEP);
}

/** Where `fps` sits in plot space; above the ceiling clamps to the top. */
export function fpsY(fps: number, ceiling: number) {
  return SPARK_HEIGHT - Math.min(1, Math.max(0, fps / ceiling)) * SPARK_HEIGHT;
}

/**
 * Runs of points, one run per unbroken stretch of samples. A sample is one point at the middle of its second, with the
 * run's first and last sample held out to their edges so a lone second still draws.
 */
export function sparkRuns(bands: readonly FrameBand[], span: number, ceiling: number): SparkPoint[][] {
  const x = (time: number) => Math.min(1, Math.max(0, time / Math.max(1, span))) * SPARK_WIDTH;
  const runs: FrameBand[][] = [];
  for (const band of bands) {
    const last = runs.at(-1);
    const previous = last?.at(-1);
    if (last && previous && band.at - previous.end <= GAP_MS) last.push(band);
    else runs.push([band]);
  }
  return runs.map((run) => {
    const points = run.map((band) => ({ x: x((band.at + band.end) / 2), y: fpsY(band.fps, ceiling) }));
    const first = run[0];
    const final = run.at(-1);
    if (!first || !final) return [];
    const framed = [{ x: x(first.at), y: points[0]?.y ?? 0 }, ...points, { x: x(final.end), y: points.at(-1)?.y ?? 0 }];
    return framed.filter((point, index) => index === 0 || point.x > (framed[index - 1]?.x ?? 0));
  });
}

const fixed = (value: number) => Number(value.toFixed(2));

/** A smooth path through the points that never overshoots between them (monotone cubic), so a dip cannot undershoot 0. */
export function linePath(points: readonly SparkPoint[]) {
  const [first] = points;
  if (!first) return '';
  const start = `M${fixed(first.x)} ${fixed(first.y)}`;
  if (points.length < 3) return points.slice(1).reduce((path, point) => `${path}L${fixed(point.x)} ${fixed(point.y)}`, start);
  const slopes = points.slice(1).map((point, index) => {
    const from = points[index] ?? point;
    return (point.y - from.y) / (point.x - from.x);
  });
  const tangents = points.map((_, index) => {
    const before = slopes[index - 1];
    const after = slopes[index];
    if (before === undefined) return after ?? 0;
    if (after === undefined) return before;
    if (before * after <= 0) return 0;
    const mean = (before + after) / 2;
    return Math.sign(mean) * Math.min(Math.abs(mean), 3 * Math.min(Math.abs(before), Math.abs(after)));
  });
  return points.slice(1).reduce((path, point, index) => {
    const from = points[index] ?? point;
    const third = (point.x - from.x) / 3;
    const out = tangents[index] ?? 0;
    const into = tangents[index + 1] ?? 0;
    return `${path}C${fixed(from.x + third)} ${fixed(from.y + out * third)} ${fixed(point.x - third)} ${fixed(point.y - into * third)} ${fixed(point.x)} ${fixed(point.y)}`;
  }, start);
}

/** The line closed down to the baseline, for the fill. */
export function areaPath(points: readonly SparkPoint[]) {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return '';
  return `${linePath(points)}L${fixed(last.x)} ${SPARK_HEIGHT}L${fixed(first.x)} ${SPARK_HEIGHT}Z`;
}

/** The pockets between the line and the horizontal at `top` (plot y); clip to below it to keep only where the line dips under. */
export function dipPath(points: readonly SparkPoint[], top: number) {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return '';
  return `${linePath(points)}L${fixed(last.x)} ${fixed(top)}L${fixed(first.x)} ${fixed(top)}Z`;
}

/** What the pointer reads at `fraction` (0 to 1) of the replay: the time, and the second's frame rate, or none in a gap. */
export function readingAt(bands: readonly FrameBand[], fraction: number, span: number) {
  const time = Math.min(1, Math.max(0, fraction)) * span;
  const band = bandAt(bands, time);
  return { time, fps: band?.fps };
}
