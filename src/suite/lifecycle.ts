import type { ReviewRunStatus, ReviewSuiteRun } from '../shared/review-suite.ts';

const TERMINAL: ReadonlySet<ReviewRunStatus> = new Set(['passed', 'failed', 'partial']);

export const isTerminal = (status: ReviewRunStatus) => TERMINAL.has(status);

/**
 * The server's rule, checked before the call so the message says what to do: a run starts as anything, `running` may move
 * to any status, and a finished run keeps its status (the same status again is a no-op, not an error).
 */
export function assertTransition(runId: string, from: ReviewRunStatus | undefined, to: ReviewRunStatus): void {
  if (from === undefined || from === 'running' || from === to) return;
  throw new Error(`run ${runId} already finished as ${from} and cannot become ${to}; register a new run id (for example ${runId}-2)`);
}

/** The next free run sequence in a suite. */
export function nextSequence(runs: ReadonlyArray<Pick<ReviewSuiteRun, 'sequence'>>): number {
  return runs.reduce((highest, run) => Math.max(highest, run.sequence), 0) + 1;
}
