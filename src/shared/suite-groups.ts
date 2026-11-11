import type { ReviewSuiteRun } from './review-suite.ts';

/** The fields of a suite run that grouping reads (a suite run, or the index's run). */
export type GroupableRun = Pick<ReviewSuiteRun, 'sequence' | 'group' | 'target' | 'measure' | 'measureMs'> & {
  replayId?: string | undefined;
};

/** What a run with a `group` but no `target` is called. */
export const NO_TARGET = 'Runs';

/** One target of a group: its samples (runs with this group and target), in sequence order, and what they add up to. */
export interface TargetSummary<T extends GroupableRun> {
  target: string;
  baseline: boolean;
  samples: T[];
  /** The `measure` label the samples share (the first one's). */
  measure?: string;
  /** Median of the samples' `measureMs`; absent when none has one. */
  median?: number;
  /** Change of `median` against the baseline target's, in whole percent (negative is faster); absent for the baseline itself. */
  delta?: number;
}

export interface RunGroup<T extends GroupableRun> {
  name: string;
  targets: TargetSummary<T>[];
}

export interface GroupedRuns<T extends GroupableRun> {
  groups: RunGroup<T>[];
  /** Runs without a group. */
  other: T[];
}

export const targetOf = (run: Pick<GroupableRun, 'target'>) => run.target ?? NO_TARGET;

export function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const high = sorted[middle];
  const low = sorted[middle - 1];
  if (high === undefined) return undefined;
  return sorted.length % 2 === 1 || low === undefined ? high : (low + high) / 2;
}

/** `value` against `base` in whole percent; undefined when `base` is not a positive time. */
export function percentChange(value: number, base: number): number | undefined {
  return base > 0 ? Math.round(((value - base) / base) * 100) : undefined;
}

/** "−23%", "+8%" or "0%" (a real minus sign). */
export function formatPercent(percent: number): string {
  if (percent === 0) return '0%';
  return `${percent < 0 ? '−' : '+'}${Math.abs(percent)}%`;
}

/** "840 ms" below a second, else "2.0 s". */
export function formatMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

const byGroup = <T extends GroupableRun>(runs: readonly T[]) => runs.filter((run): run is T & { group: string } => run.group !== undefined);

function summarise<T extends GroupableRun>(target: string, samples: T[], baseline: string | undefined): TargetSummary<T> {
  const measured = samples.flatMap((run) => (run.measureMs === undefined ? [] : [run.measureMs]));
  const typical = median(measured);
  const measure = samples.find((run) => run.measure)?.measure;
  return {
    target,
    baseline: target === baseline,
    samples,
    ...(measure ? { measure } : {}),
    ...(typical === undefined ? {} : { median: typical }),
  };
}

/**
 * The runs grouped for a comparison: groups in plan order (the order their first run appears), each with its targets,
 * the baseline target first and the others in plan order. Each target carries its median and its change from the baseline.
 */
export function groupRuns<T extends GroupableRun>(runs: readonly T[], baseline?: string): GroupedRuns<T> {
  const ordered = runs.toSorted((a, b) => a.sequence - b.sequence);
  const names = [...new Set(byGroup(ordered).map((run) => run.group))];
  const groups = names.map((name) => {
    const inGroup = byGroup(ordered).filter((run) => run.group === name);
    const targets = [...new Set(inGroup.map(targetOf))].map((target) =>
      summarise(
        target,
        inGroup.filter((run) => targetOf(run) === target),
        baseline,
      ),
    );
    const base = targets.find((entry) => entry.baseline)?.median;
    const compared = targets.map((entry) => {
      const change = base === undefined || entry.baseline || entry.median === undefined ? undefined : percentChange(entry.median, base);
      return change === undefined ? entry : { ...entry, delta: change };
    });
    return { name, targets: [...compared.filter((entry) => entry.baseline), ...compared.filter((entry) => !entry.baseline)] };
  });
  return { groups, other: ordered.filter((run) => run.group === undefined) };
}

/** The runs in the order the grouped sidebar shows them: group by group, target by target, then the ungrouped. */
export function displayOrder<T extends GroupableRun>(grouped: GroupedRuns<T>): T[] {
  return [...grouped.groups.flatMap((group) => group.targets.flatMap((entry) => entry.samples)), ...grouped.other];
}

/** The sample whose time is the target's median (the lower middle for an even count); else its first sample with a recording. */
export function typicalSample<T extends GroupableRun>(entry: TargetSummary<T>): T | undefined {
  const recorded = entry.samples.filter((run) => run.replayId);
  const timed = recorded.filter((run) => run.measureMs !== undefined).toSorted((a, b) => (a.measureMs ?? 0) - (b.measureMs ?? 0));
  return timed[Math.floor((timed.length - 1) / 2)] ?? recorded[0];
}

export interface GroupPeer<T extends GroupableRun> {
  run: T;
  target: string;
  baseline: boolean;
}

/**
 * The recordings to compare `selected` with: the typical sample of each other target in its own group, baseline first.
 * Other samples of its own target and runs of other groups are never peers. Empty for a run without a group.
 */
export function groupPeers<T extends GroupableRun>(runs: readonly T[], selected: T, baseline?: string): GroupPeer<T>[] {
  const group = groupRuns(runs, baseline).groups.find((entry) => entry.name === selected.group);
  if (!group) return [];
  return group.targets.flatMap((entry) => {
    if (entry.target === targetOf(selected)) return [];
    const run = typicalSample(entry);
    return run ? [{ run, target: entry.target, baseline: entry.baseline }] : [];
  });
}

export interface RunHeadline {
  /** "Cold open on #6879: Entries visible after 1.9 s" */
  lead: string;
  /** "median of 3: 2.0 s", for a target with more than one sample. */
  median?: string;
  /** "main 2.6 s (−23%)": the baseline's median and this target's change from it. */
  baseline?: { text: string; delta: number };
}

/** The one line a grouped run opens with; undefined without a group, a measure and its time. */
export function runHeadline<T extends GroupableRun>(runs: readonly T[], run: T, baseline?: string): RunHeadline | undefined {
  if (run.group === undefined || !run.measure || run.measureMs === undefined) return undefined;
  const group = groupRuns(runs, baseline).groups.find((entry) => entry.name === run.group);
  const own = group?.targets.find((entry) => entry.target === targetOf(run));
  const base = group?.targets.find((entry) => entry.baseline && entry !== own);
  const named = run.target === undefined ? '' : ` on ${run.target}`;
  const lead = `${run.group}${named}: ${run.measure} after ${formatMs(run.measureMs)}`;
  const samples = own?.samples.length ?? 1;
  const typical = own?.median;
  return {
    lead,
    ...(samples > 1 && typical !== undefined ? { median: `median of ${samples}: ${formatMs(typical)}` } : {}),
    ...(base?.median !== undefined && own?.delta !== undefined
      ? { baseline: { text: `${base.target} ${formatMs(base.median)} (${formatPercent(own.delta)})`, delta: own.delta } }
      : {}),
  };
}

/** Whether any run names a group (the suite then lists and compares by group). */
export const isGrouped = (runs: readonly Pick<GroupableRun, 'group'>[]) => runs.some((run) => run.group !== undefined);
