import type { EditTimeline } from '../../shared/edits.ts';
import { isFailedRequest, type ReplayBundle } from '../../shared/replay.ts';
import { BUDGET_FOR_KIND, DEFAULT_BUDGETS, verdictFor, type Budgets } from '../../shared/diagnostics/budgets.ts';
import { detectIssues } from '../../shared/diagnostics/detect.ts';
import { validDuration, visibleSegments } from './waterfall.ts';

export type SummaryTab = 'issues' | 'console' | 'network' | 'performance';
export type ProblemKind = 'error' | 'warning' | 'failed';

export interface TabSummary {
  total: number;
  problems: number;
  problemKind: ProblemKind;
  /** "1 failed", "2 errors", "3 poor", "1 failure" (issues); empty at 0 (badges hide it). */
  problemLabel: string;
}

const STRINGS = {
  error: (count: number) => `${count} ${count === 1 ? 'error' : 'errors'}`,
  failed: (count: number) => `${count} failed`,
  warning: (count: number) => `${count} poor`,
  failures: (count: number) => `${count} ${count === 1 ? 'failure' : 'failures'}`,
};

/**
 * What a tab badge says ("Network 4 · 1 failed"), shared by the tab row and the panels' own toolbars so they agree.
 * Pass the source bundle with the edit timeline: entries wholly inside a cut are not counted. Linear and allocation-light,
 * so it is safe to call before the first frame.
 */
export function tabSummary(bundle: ReplayBundle, tab: SummaryTab, timeline?: EditTimeline, budgets: Budgets = DEFAULT_BUDGETS): TabSummary {
  const kept = (at: number, duration?: number) => {
    if (!timeline) return true;
    if (!Number.isFinite(at) || at < 0) return false;
    if (duration !== undefined && validDuration(duration) && duration > 0) return visibleSegments(at, duration, timeline).length > 0;
    return at <= timeline.originalDuration && !timeline.isRemoved(at);
  };
  let total = 0;
  let problems = 0;
  if (tab === 'issues') {
    // why: every issue is a problem: the badge is --danger when any of them is a failure, else --warning.
    const issues = detectIssues(bundle, timeline, { budgets });
    const failures = issues.filter((issue) => issue.severity === 'failure').length;
    return {
      total: issues.length,
      problems: issues.length,
      problemKind: failures ? 'failed' : 'warning',
      problemLabel: failures ? STRINGS.failures(failures) : '',
    };
  }
  if (tab === 'console') {
    for (const entry of bundle.console) {
      if (!kept(entry.at)) continue;
      total++;
      if (entry.level === 'error') problems++;
    }
    return summary(total, problems, 'error');
  }
  if (tab === 'network') {
    for (const entry of bundle.network) {
      if (!kept(entry.at, entry.duration)) continue;
      total++;
      if (isFailedRequest(entry)) problems++;
    }
    return summary(total, problems, 'failed');
  }
  for (const entry of bundle.performance?.entries ?? []) {
    const span = entry.kind === 'long-task' || entry.kind === 'slow-interaction';
    if (!kept(entry.at, span ? entry.value : undefined)) continue;
    total++;
    if (validDuration(entry.value) && verdictFor(entry.value, budgets[BUDGET_FOR_KIND[entry.kind]]) === 'poor') problems++;
  }
  return summary(total, problems, 'warning');
}

function summary(total: number, problems: number, problemKind: ProblemKind): TabSummary {
  return { total, problems, problemKind, problemLabel: problems ? STRINGS[problemKind](problems) : '' };
}
