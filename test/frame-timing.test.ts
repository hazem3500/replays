import { describe, expect, it } from 'vitest';

import { fpsVerdict, type FrameSample, sampleFps, summarizeFrames, summarizePerformanceTrack } from '../src/shared/frame-timing.ts';
import { bandAt, frameBands } from '../src/client/viewer/performance/frames.ts';
import { editTimeline } from '../src/shared/edit-timeline.ts';
import { runMetrics } from '../src/client/suite/runs.ts';

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
    expect(summarizeFrames(undefined)).toBeUndefined();
    expect(summarizeFrames([])).toBeUndefined();
    expect(summarizeFrames([sample(0, 60, 0), sample(1000, 20, 80), sample(2000, 58, 3)])).toEqual({ p50: 58, min: 20, dropped: 83, seconds: 3 });
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

  it('drops a sample inside a cut and shifts later ones', () => {
    const timeline = editTimeline({ cuts: [{ id: 'c1', from: 1000, to: 2000 }] }, 3000);
    const bands = frameBands(samples, timeline);
    expect(bands.map((band) => [band.at, band.fps])).toEqual([
      [0, 60],
      [1000, 45],
    ]);
  });

  it('has no bands when frame timing was not recorded', () => {
    expect(frameBands(undefined)).toEqual([]);
  });
});

describe('run metrics', () => {
  it('summarises the track without inventing what was not captured', () => {
    expect(summarizePerformanceTrack(undefined)).toBeUndefined();
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
    expect(runMetrics(undefined)).toEqual([]);
    expect(runMetrics({ fpsP50: 58.4, fpsMin: 22, longestTask: 180, blocking: 1450 })).toEqual([
      { id: 'fps', label: 'FPS', value: '58', verdict: 'good' },
      { id: 'min', label: 'min', value: '22', verdict: 'poor' },
      { id: 'task', label: 'task', value: '180 ms' },
      { id: 'tbt', label: 'TBT', value: '1.5 s' },
    ]);
    expect(runMetrics({ longestTask: 90 }).map((metric) => metric.id)).toEqual(['task']);
  });
});
