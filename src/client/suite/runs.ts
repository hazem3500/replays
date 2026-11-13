import { type FrameVerdict, fpsVerdict, type ReplayPerfSummary } from '../../shared/frame-timing.ts';
import type { ReviewSuiteIndexRun } from '../../shared/review-suite.ts';
import { displayOrder, groupPeers, groupRuns, isGrouped, targetOf } from '../../shared/suite-groups.ts';
import { tileColour } from '../compare/tiles.ts';
import { BUDGETS, verdictFor } from '../viewer/performance/budgets.ts';

type RunRecording = Pick<ReviewSuiteIndexRun, 'replayId' | 'replay'>;

/** A run's place in the list: `position` is where a grouped suite shows it, else its sequence. */
type Sequenced = Pick<ReviewSuiteIndexRun, 'sequence'> & { position?: number | undefined };

/** Runs in the order the sidebar shows them: by sequence, or by `position` when a grouped suite set one. */
export function orderedRuns<T extends Sequenced>(runs: readonly T[]) {
  return runs.toSorted((a, b) => (a.position ?? a.sequence) - (b.position ?? b.sequence));
}

/**
 * A grouped suite's runs, numbered in the order its sidebar lists them (group, then target and sample for a comparison);
 * other suites keep their sequence.
 */
export function positionedRuns<T extends Pick<ReviewSuiteIndexRun, 'sequence' | 'group' | 'target' | 'measure' | 'measureMs' | 'replayId'>>(
  runs: readonly T[],
  baseline: string | undefined,
): Array<T & { position?: number }> {
  if (!isGrouped(runs)) return runs.toSorted((a, b) => a.sequence - b.sequence);
  return displayOrder(groupRuns(runs, baseline)).map((run, position) => ({ ...run, position }));
}

/** A heading and the runs under it, as the phone run picker lists them; an ungrouped suite has one section without a name. */
interface RunSection<T> {
  name: string | undefined;
  runs: T[];
}

/** The runs, already in sidebar order, cut into one section per group and then "Other runs" for the ungrouped. */
export function runSections<T extends Pick<ReviewSuiteIndexRun, 'group'>>(runs: readonly T[]): RunSection<T>[] {
  if (!isGrouped(runs)) return [{ name: undefined, runs: [...runs] }];
  const sections: RunSection<T>[] = [];
  for (const run of runs) {
    const name = run.group ?? 'Other runs';
    const last = sections.at(-1);
    if (last?.name === name) last.runs.push(run);
    else sections.push({ name, runs: [run] });
  }
  return sections;
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
  runs: ReadonlyArray<Sequenced & Pick<ReviewSuiteIndexRun, 'replayId' | 'replay'>>,
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
  /** What the Compare stage calls this run, when its label is not enough (a grouped run is named by its target). */
  name?: string;
}

/**
 * The runs that open as recordings, in sequence order, each with its colour. The runs sidebar and the suite's Compare
 * stage both read colours from this one list, so a run's swatch and its tile frame can never disagree.
 */
export function recordedRuns(
  runs: ReadonlyArray<RunRecording & Sequenced & Pick<ReviewSuiteIndexRun, 'label'>>,
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
  if (perf.longestTask !== undefined)
    metrics.push({
      id: 'task',
      label: 'Longest task',
      value: millis(perf.longestTask),
      verdict: verdictFor(perf.longestTask, BUDGETS.task),
    });
  if (perf.blocking !== undefined)
    metrics.push({ id: 'tbt', label: 'Blocking', value: millis(perf.blocking), verdict: verdictFor(perf.blocking, BUDGETS.tbt) });
  return metrics;
}

/** A run's metrics when its suite is performance-focused; undefined leaves the row as it was. */
export function runRowMetrics(run: { replay?: { perf?: ReplayPerfSummary | undefined } | undefined }, performanceFocused: boolean) {
  return performanceFocused ? runMetrics(run.replay?.perf) : undefined;
}

/**
 * A run of a comparison group takes its target's colour (the baseline first), so "main" is the same colour in every
 * compared group and on every Compare stage; other runs keep their own. The sidebar swatch and the tile frame still
 * read it from this one list.
 */
export function colouredByTarget(
  recorded: readonly RecordedRun[],
  runs: ReadonlyArray<Pick<ReviewSuiteIndexRun, 'sequence' | 'replayId' | 'group' | 'target' | 'measure' | 'measureMs'>>,
  baseline: string | undefined,
): RecordedRun[] {
  const compared = groupRuns(runs, baseline)
    .groups.filter((group) => group.comparison)
    .flatMap((group) => group.runs);
  if (!compared.length) return [...recorded];
  const targets = [...new Set(compared.map(targetOf))];
  const order = [...targets.filter((name) => name === baseline), ...targets.filter((name) => name !== baseline)];
  const targetByReplay = new Map(compared.map((run) => [run.replayId, targetOf(run)]));
  return recorded.map((run) => {
    const target = targetByReplay.get(run.replayId);
    return target === undefined ? run : { ...run, colour: tileColour(Math.max(0, order.indexOf(target))) };
  });
}

/**
 * What "Compare" shows for the run in view. A suite without a comparison group (ungrouped, or only plain sections)
 * shows every recorded run. Otherwise a run of a comparison group is shown with the typical sample of each other target
 * of its own group, named by target (the baseline marked), and any other run (in a section or ungrouped) with the other
 * runs outside comparison groups. Runs of another comparison group are never offered.
 */
export function comparisonRuns(
  recorded: readonly RecordedRun[],
  runs: ReadonlyArray<RunRecording & Pick<ReviewSuiteIndexRun, 'sequence' | 'group' | 'target' | 'measure' | 'measureMs'>>,
  selected: string | undefined,
  baseline: string | undefined,
  detailed: boolean,
) {
  const compared = groupRuns(runs, baseline).groups.filter((group) => group.comparison);
  if (!compared.length) return [...recorded];
  const playable = runs.filter((run) => playableReplayId(run, detailed));
  const current = playable.find((run) => run.replayId === selected);
  if (!current) return [...recorded];
  const group = compared.find((entry) => entry.name === current.group);
  if (!group) {
    const closed = new Set(compared.flatMap((entry) => entry.runs.map((run) => run.replayId)));
    return recorded.filter((run) => !closed.has(run.replayId));
  }
  const peers = new Map(groupPeers(playable, current, baseline).map((peer) => [peer.target, peer.run]));
  const colours = new Map(recorded.map((run) => [run.replayId, run.colour]));
  return group.targets.flatMap((entry): RecordedRun[] => {
    const run = entry.target === targetOf(current) ? current : peers.get(entry.target);
    const replayId = run?.replayId;
    if (!replayId) return [];
    return [
      {
        replayId,
        label: entry.target,
        name: entry.baseline ? `${entry.target} (baseline)` : entry.target,
        colour: colours.get(replayId) ?? 1,
      },
    ];
  });
}
