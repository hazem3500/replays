import type { ReviewSuite } from '../../shared/review-suite.ts';

/** How long a `running` run without a recording may go without any write before it reads as ended (`STALE_RUN_MINUTES`). */
export const DEFAULT_STALE_RUN_MS = 30 * 60_000;

/**
 * The suite as it reads at `now`: a run still `running` with no replay attached, whose last sign of life (its start or the
 * suite's last write, whichever is later) is older than `staleMs`, reads as `partial` (it never produced a recording) and
 * finished when the timeout ran out. Nothing is stored: the stored run stays `running`, so a late real update from the
 * recorder (its replay, or its final status) is still accepted. `staleMs` of 0 turns this off. Returns `suite` itself when
 * no run changes.
 */
export function endAbandonedRuns(suite: ReviewSuite, now: number, lastWriteMs: number, staleMs: number): ReviewSuite {
  if (!(staleMs > 0)) return suite;
  let changed = false;
  const runs = suite.runs.map((run) => {
    if (run.status !== 'running' || run.replayId) return run;
    const lastSeen = Math.max(Date.parse(run.startedAt), lastWriteMs);
    // why: an unreadable start time or write time (NaN) never ends a run; wrongly ending a live one is worse than waiting.
    if (!(now - lastSeen > staleMs)) return run;
    changed = true;
    return { ...run, status: 'partial' as const, finishedAt: new Date(lastSeen + staleMs).toISOString() };
  });
  return changed ? { ...suite, runs } : suite;
}
