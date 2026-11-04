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
