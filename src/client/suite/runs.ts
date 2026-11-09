import { type FrameVerdict, fpsVerdict, type ReplayPerfSummary } from '../../shared/frame-timing.ts';
import type { ReviewSuiteIndexRun } from '../../shared/review-suite.ts';
import { tileColour } from '../compare/tiles.ts';

type RunRecording = Pick<ReviewSuiteIndexRun, 'replayId' | 'replay'>;

/** Runs in sequence order. */
export function orderedRuns<T extends Pick<ReviewSuiteIndexRun, 'sequence'>>(runs: readonly T[]) {
  return runs.toSorted((a, b) => a.sequence - b.sequence);
}

/**
 * The run's replay id while its recording can still be opened. With replay summaries
 * loaded (`detailed`), a run without one had its replay pruned by retention.
 */
export function playableReplayId(run: RunRecording, detailed: boolean) {
  return run.replayId && (run.replay || !detailed) ? run.replayId : undefined;
}

/** Recorded, but the replay has expired. */
export function isExpired(run: RunRecording, detailed: boolean) {
  return Boolean(run.replayId) && !playableReplayId(run, detailed);
}

/** Where `/s/<suite>` lands: the first failed run with a recording, else the first run with one. */
export function initialRunReplayId(
  runs: ReadonlyArray<Pick<ReviewSuiteIndexRun, 'sequence' | 'status' | 'replayId' | 'replay'>>,
  detailed: boolean,
) {
  const ordered = orderedRuns(runs).filter((run) => playableReplayId(run, detailed));
  return (ordered.find((run) => run.status === 'failed') ?? ordered[0])?.replayId;
}

/** The recording `step` runs away from `replayId` (J = +1, K = −1), skipping runs without one. */
export function neighbourReplayId(
  runs: ReadonlyArray<Pick<ReviewSuiteIndexRun, 'sequence' | 'replayId' | 'replay'>>,
  replayId: string | undefined,
  step: 1 | -1,
  detailed: boolean,
) {
  const playable = orderedRuns(runs).filter((run) => playableReplayId(run, detailed));
  const index = playable.findIndex((run) => run.replayId === replayId);
  return playable[index + step]?.replayId;
}

/** A run that opens as a recording, with the colour its sidebar row and its Compare tile both show. */
export interface RecordedRun {
  replayId: string;
  label: string;
  colour: number;
}

/**
 * The runs that open as recordings, in sequence order, each with its colour. The runs sidebar and the suite's Compare
 * stage both read colours from this one list, so a run's swatch and its tile frame can never disagree.
 */
export function recordedRuns(
  runs: ReadonlyArray<RunRecording & Pick<ReviewSuiteIndexRun, 'sequence' | 'label'>>,
  detailed: boolean,
): RecordedRun[] {
  const recorded = orderedRuns(runs).flatMap((run) => {
    const replayId = playableReplayId(run, detailed);
    return replayId ? [{ replayId, label: run.label }] : [];
  });
  return recorded.map((run, index) => ({ ...run, colour: tileColour(index) }));
}

export interface RunMetric {
  id: 'fps' | 'min' | 'task' | 'tbt';
  label: string;
  value: string;
  verdict?: FrameVerdict;
}

const millis = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);

const fpsMetric = (id: RunMetric['id'], label: string, fps: number): RunMetric => ({
  id,
  label,
  value: String(Math.round(fps)),
  verdict: fpsVerdict(fps),
});

/**
 * The compact comparison row of a performance-focused suite: frame rate (median and slowest second), longest task and
 * blocking time. A metric that was not recorded is left out; an empty list means the run recorded none of them.
 */
export function runMetrics(perf: ReplayPerfSummary | undefined): RunMetric[] {
  if (!perf) return [];
  const metrics: RunMetric[] = [];
  if (perf.fpsP50 !== undefined) metrics.push(fpsMetric('fps', 'FPS', perf.fpsP50));
  if (perf.fpsMin !== undefined) metrics.push(fpsMetric('min', 'min', perf.fpsMin));
  if (perf.longestTask !== undefined) metrics.push({ id: 'task', label: 'task', value: millis(perf.longestTask) });
  if (perf.blocking !== undefined) metrics.push({ id: 'tbt', label: 'TBT', value: millis(perf.blocking) });
  return metrics;
}

/** A run's metrics when its suite is performance-focused; undefined leaves the row as it was. */
export function runRowMetrics(run: { replay?: { perf?: ReplayPerfSummary | undefined } | undefined }, performanceFocused: boolean) {
  return performanceFocused ? runMetrics(run.replay?.perf) : undefined;
}
