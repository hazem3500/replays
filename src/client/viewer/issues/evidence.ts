import type { EditTimeline } from '../../../shared/edits.ts';
import type { EvidenceRef, Issue } from '../../../shared/diagnostics/types.ts';
import { DEFAULT_BUDGETS, verdictFor, type Verdict } from '../../../shared/diagnostics/budgets.ts';
import { isFailedRequest, type ReplayBundle, type ReplayConsoleEntry } from '../../../shared/replay.ts';
import { buildWaterfall, type WaterfallRow } from '../waterfall.ts';
import type { TimeDomain } from '../time-axis.ts';

/** Everything the ±1 s lanes draw, on the player's clock (the same mapping as the tables). */
export interface LaneData {
  steps: Extract<WaterfallRow, { kind: 'action' }>[];
  requests: Array<Extract<WaterfallRow, { kind: 'network' }> & { failed: boolean; end: number }>;
  console: Array<{ index: number; at: number; level: ReplayConsoleEntry['level']; message: string }>;
  main: Array<Extract<WaterfallRow, { kind: 'performance' }> & { end: number; verdict?: Verdict; index: number }>;
}

const indexOf = (id: string) => Number(id.slice(id.lastIndexOf('-') + 1));

const end = (row: WaterfallRow) => row.segments.at(-1)?.to ?? row.at;

export function laneData(bundle: ReplayBundle, timeline?: EditTimeline): LaneData {
  const { rows } = buildWaterfall(bundle, timeline);
  return {
    steps: rows.filter((row): row is LaneData['steps'][number] => row.kind === 'action'),
    requests: rows
      .filter((row): row is Extract<WaterfallRow, { kind: 'network' }> => row.kind === 'network')
      .map((row) => ({ ...row, failed: isFailedRequest(row.entry), end: end(row) })),
    console: bundle.console.flatMap((entry, index) =>
      !Number.isFinite(entry.at) || entry.at < 0 || timeline?.isRemoved(entry.at)
        ? []
        : [{ index, at: timeline ? timeline.toEdited(entry.at) : entry.at, level: entry.level, message: entry.message }],
    ),
    main: rows
      .filter((row): row is Extract<WaterfallRow, { kind: 'performance' }> => row.kind === 'performance')
      .map((row) => {
        const budget =
          row.entry.kind === 'long-task'
            ? DEFAULT_BUDGETS['long-task']
            : row.entry.kind === 'slow-interaction'
              ? DEFAULT_BUDGETS.interaction
              : undefined;
        return { ...row, end: end(row), index: indexOf(row.id), ...(budget ? { verdict: verdictFor(row.entry.value, budget) } : {}) };
      }),
  };
}

/** The issue and a second either side, inside the replay. */
export function evidenceWindow(issue: Issue, duration: number): TimeDomain {
  const start = Math.min(issue.at, ...issue.chain.map((link) => link.at));
  const finish = Math.max(issue.end, ...issue.chain.map((link) => link.at));
  return { from: Math.max(0, start - 1000), to: Math.min(Math.max(duration, finish), finish + 1000) };
}

/** Whether a lane row is part of the issue's own chain (drawn emphasised). */
export function linked(issue: Issue, ref: EvidenceRef) {
  return issue.chain.some((link) => sameRef(link.ref, ref));
}

export function sameRef(a: EvidenceRef, b: EvidenceRef) {
  if (a.kind !== b.kind) return false;
  return a.kind === 'request' ? a.id === (b as typeof a).id : a.index === (b as { index: number }).index;
}

/** Where a referenced row starts on the player's clock, when it is on the (edited) timeline. */
export function evidenceAt(data: LaneData, ref: EvidenceRef) {
  switch (ref.kind) {
    case 'step':
      return data.steps.find((row) => row.id === `action-${ref.index}`)?.at;
    case 'request':
      return data.requests.find((row) => row.entry.id === ref.id)?.at;
    case 'console':
      return data.console.find((row) => row.index === ref.index)?.at;
    case 'performance':
      return data.main.find((row) => row.index === ref.index)?.at;
  }
}
