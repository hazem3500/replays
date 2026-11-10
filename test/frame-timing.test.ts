import { describe, expect, it } from 'vitest';

import {
  droppedVerdict,
  fpsVerdict,
  type FrameSample,
  sampleFps,
  summarizeFrames,
  summarizePerformanceTrack,
} from '../src/shared/frame-timing.ts';
import {
  areaPath,
  bandAt,
  nearestBand,
  fpsCeiling,
  frameBands,
  dipPath,
  linePath,
  readingAt,
  SPARK_HEIGHT,
  SPARK_WIDTH,
  sparkRuns,
} from '../src/client/viewer/performance/frames.ts';
import { editTimeline } from '../src/shared/edit-timeline.ts';
import { runMetrics, runRowMetrics } from '../src/client/suite/runs.ts';

const nothing: { value?: undefined } = {};
const absent = nothing.value;
const sample = (at: number, frames: number, dropped = 0, elapsed = 1000): FrameSample => ({ at, elapsed, frames, dropped });

describe('frame rate from samples', () => {
  it('divides frames by the window, not by one second', () => {
    expect(sampleFps(sample(0, 60))).toBe(60);
    expect(sampleFps(sample(0, 30, 0, 500))).toBe(60);
    expect(sampleFps(sample(0, 29, 0, 1010))).toBeCloseTo(28.7, 1);
  });

  it('judges 50 and up smooth, 30 and up choppy, below janky', () => {
    expect([60, 50, 49.9, 30, 29.9, 0].map(fpsVerdict)).toEqual(['good', 'good', 'needs-work', 'needs-work', 'poor', 'poor']);
  });

  it('summarises median, slowest second and missed frames', () => {
    expect(summarizeFrames(absent)).toBeUndefined();
    expect(summarizeFrames([])).toBeUndefined();
    expect(summarizeFrames([sample(0, 60, 0), sample(1000, 20, 80), sample(2000, 58, 3)])).toEqual({
      p50: 58,
      min: 20,
      dropped: 83,
      seconds: 3,
    });
    expect(summarizeFrames([sample(0, 60), sample(1000, 40)])?.p50).toBe(50);
  });
});

describe('frame bands on the player clock', () => {
  const samples = [sample(0, 60), sample(1000, 20, 40), sample(2000, 45, 10)];

  it('keeps recorded times without edits', () => {
    const bands = frameBands(samples);
    expect(bands.map((band) => [band.at, band.end, band.verdict])).toEqual([
      [0, 1000, 'good'],
      [1000, 2000, 'poor'],
      [2000, 3000, 'needs-work'],
    ]);
    expect(bandAt(bands, 1500)?.fps).toBe(20);
    expect(bandAt(bands, 3000)).toBeUndefined();
  });

  it('reads the closing second just past the last sample, and nothing far from any', () => {
    const bands = frameBands(samples);
    expect(nearestBand(bands, 3400)?.fps).toBe(45);
    expect(nearestBand(bands, 9000)).toBeUndefined();
  });

  it('drops a sample inside a cut and shifts later ones', () => {
    const timeline = editTimeline({ cuts: [{ from: 1000, to: 2000 }] }, 3000);
    const bands = frameBands(samples, timeline);
    expect(bands.map((band) => [band.at, band.fps])).toEqual([
      [0, 60],
      [1000, 45],
    ]);
  });

  it('has no bands when frame timing was not recorded', () => {
    expect(frameBands(absent)).toEqual([]);
  });
});

describe('run metrics', () => {
  it('summarises the track without inventing what was not captured', () => {
    expect(summarizePerformanceTrack(absent)).toBeUndefined();
    expect(summarizePerformanceTrack({ supported: ['paint'], entries: [] })).toBeUndefined();
    expect(
      summarizePerformanceTrack({
        supported: ['longtask', 'animation-frame'],
        entries: [
          { at: 0, kind: 'long-task', value: 120 },
          { at: 500, kind: 'long-task', value: 300 },
        ],
        frames: [sample(0, 60), sample(1000, 30, 30)],
      }),
    ).toEqual({ fpsP50: 45, fpsMin: 30, longestTask: 300, blocking: 320 });
    expect(summarizePerformanceTrack({ supported: ['longtask'], entries: [] })).toEqual({ longestTask: 0, blocking: 0 });
  });

  it('lists the recorded metrics for a run row', () => {
    expect(runMetrics(absent)).toEqual([]);
    expect(runMetrics({ fpsP50: 58.4, fpsMin: 22, longestTask: 180, blocking: 1480 })).toEqual([
      { id: 'fps', label: 'FPS', value: '58', verdict: 'good' },
      { id: 'min', label: 'min', value: '22', verdict: 'poor' },
      { id: 'task', label: 'task', value: '180 ms' },
      { id: 'tbt', label: 'TBT', value: '1.5 s' },
    ]);
    expect(runMetrics({ longestTask: 90 }).map((metric) => metric.id)).toEqual(['task']);
  });

  it('leaves the row alone unless the suite is performance-focused', () => {
    const run = { replay: { perf: { fpsP50: 60 } } };
    expect(runRowMetrics(run, false)).toBeUndefined();
    expect(runRowMetrics(run, true)?.map((metric) => metric.id)).toEqual(['fps']);
    expect(runRowMetrics({}, true)).toEqual([]);
  });
});

const framed = (...samples: FrameSample[]) => frameBands(samples);

describe('frame-rate sparkline', () => {
  it('maps samples to points on a 0 to 60 scale, held out to the first and last edge', () => {
    const [run] = sparkRuns(framed(sample(0, 60), sample(1000, 30)), 2000, 60);
    expect(run).toEqual([
      { x: 0, y: 0 },
      { x: 250, y: 0 },
      { x: 750, y: 50 },
      { x: SPARK_WIDTH, y: 50 },
    ]);
  });

  it('breaks the line at a gap and keeps a seam as one run', () => {
    const gap = sparkRuns(framed(sample(0, 60), sample(1000, 60), sample(5000, 60)), 6000, 60);
    expect(gap).toHaveLength(2);
    expect(gap[1]?.[0]?.x).toBeCloseTo(833.33, 1);
    const seam = sparkRuns(framed(sample(0, 60), sample(1100, 60)), 3000, 60);
    expect(seam).toHaveLength(1);
  });

  it('breaks across a cut of more than a gap, but not when edits close it up', () => {
    const timeline = editTimeline({ cuts: [{ from: 1000, to: 3000 }] } as never, 5000);
    const cut = frameBands([sample(0, 60), sample(1000, 10), sample(2000, 10), sample(3000, 60)], timeline);
    expect(cut.map((band) => band.at)).toEqual([0, 1000]);
    expect(sparkRuns(cut, 2000, 60)).toHaveLength(1);
  });

  it('clamps to the plot and raises the ceiling on a faster display', () => {
    expect(fpsCeiling(framed(sample(0, 60)))).toBe(120);
    expect(fpsCeiling(framed(sample(0, 120)))).toBe(120);
    expect(fpsCeiling(framed(sample(0, 121)))).toBe(150);
    const [run] = sparkRuns(framed(sample(0, 70), sample(1000, 0)), 2000, 60);
    expect(run?.map((point) => point.y)).toEqual([0, 0, SPARK_HEIGHT, SPARK_HEIGHT]);
  });

  it('draws nothing for no samples and a flat line for one', () => {
    expect(sparkRuns([], 1000, 60)).toEqual([]);
    expect(linePath([])).toBe('');
    expect(linePath(sparkRuns(framed(sample(0, 30)), 1000, 60)[0] ?? [])).toBe(
      'M0 50C166.67 50 333.33 50 500 50C666.67 50 833.33 50 1000 50',
    );
    expect(areaPath([])).toBe('');
  });

  it('closes the dip pocket along the 30 FPS line', () => {
    const [run] = sparkRuns(framed(sample(0, 60), sample(1000, 10), sample(2000, 60)), 3000, 60);
    expect(dipPath(run ?? [], 50)).toMatch(/L1000 50L0 50Z$/);
    expect(dipPath([], 50)).toBe('');
  });

  it('never overshoots between points', () => {
    const [run] = sparkRuns(framed(sample(0, 60), sample(1000, 5), sample(2000, 60)), 3000, 60);
    const numbers = (linePath(run ?? []).match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
    const ys = numbers.filter((_, index) => index % 2 === 1);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ys)).toBeLessThanOrEqual(SPARK_HEIGHT);
    expect(areaPath(run ?? [])).toMatch(/Z$/);
  });
});

describe('hover reading', () => {
  const hovered = frameBands([sample(0, 60), sample(1000, 22), sample(4000, 45)]);

  it('reads the second under the pointer', () => {
    expect(readingAt(hovered, 0.1, 5000)).toEqual({ time: 500, fps: 60 });
    expect(readingAt(hovered, 0.3, 5000)).toEqual({ time: 1500, fps: 22 });
  });

  it('has no value in a gap and clamps outside the lane', () => {
    expect(readingAt(hovered, 0.6, 5000)).toEqual({ time: 3000, fps: undefined });
    expect(readingAt(hovered, -1, 5000).time).toBe(0);
    expect(readingAt(hovered, 2, 5000)).toEqual({ time: 5000, fps: undefined });
  });
});

describe('dropped-frame verdict', () => {
  it('judges the missed share of a 60 Hz recording', () => {
    expect([0, 30, 60, 100].map((dropped) => droppedVerdict(dropped, 10))).toEqual(['good', 'good', 'needs-work', 'poor']);
  });
});
