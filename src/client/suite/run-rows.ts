import type { ReviewSuite, ReviewSuiteIndexRun } from '../../shared/review-suite.ts';
import { plural } from '../plural.ts';
import type { SuiteWithRuns } from '../queries.ts';
import { daysUntil } from '../viewer/keep.ts';
import type { SuiteDetails } from '../viewer/ReplayInfo.tsx';
import { isExpired, orderedRuns, playableReplayId } from './runs.ts';

export const SUITE_STRINGS = {
  expiredTitle: 'These recordings are no longer available',
  expiredBody: (days?: number) =>
    days
      ? `They were deleted after ${days} days under this workspace’s retention policy. Run the suite again to record new ones.`
      : 'They were deleted under this workspace’s retention policy. Run the suite again to record new ones.',
  someExpired: (count: number, total: number) => `${count} of ${total} recordings expired`,
  expired: 'Expired',
  noRecording: 'No recording',
  expiresToday: 'Expires today',
  expiresIn: (days: number) => `Expires in ${plural(days, 'day')}`,
  showAll: 'Show all runs',
  suiteFailedBody: (id: string) => `Suite ${id} may have expired, or the link may be incomplete.`,
  retry: 'Try again',
  back: 'Back to all replays',
  runFailed: 'This run didn’t open',
  runGone: 'Its recording has expired or was removed.',
  noRecordingsTitle: 'No recordings yet',
  noRecordingsBody: 'Runs appear here as the review uploads them.',
} as const;

/** Runs within this many days of expiry show when they go. */
export const EXPIRY_NOTICE_DAYS = 7;

export type WorkspaceRun = ReviewSuiteIndexRun & { duration?: number };

/** Run rows from `runDetails` when present, else from the plain runs (no per-run error counts then). */
export function workspaceRuns(suite: SuiteWithRuns | undefined): WorkspaceRun[] {
  if (!suite) return [];
  const recordings = new Map(suite.runs.map((run) => [run.id, run.recording?.duration]));
  const rows: WorkspaceRun[] = suite.runDetails
    ? suite.runDetails.map((run) => {
        const duration = run.replay?.duration ?? recordings.get(run.id);
        return duration === undefined ? run : { ...run, duration };
      })
    : suite.runs.map(({ id, sequence, label, status, startedAt, finishedAt, replayId, recording }) => ({
        id,
        sequence,
        label,
        status,
        startedAt,
        ...(finishedAt ? { finishedAt } : {}),
        ...(replayId ? { replayId } : {}),
        ...(recording ? { duration: recording.duration } : {}),
      }));
  return orderedRuns(rows);
}

/** The suite's subject as a link (provider, address, label), when it names one. */
export function subjectLink(suite: Pick<ReviewSuite, 'subject'>): SuiteDetails['subject'] {
  const { subject } = suite;
  return subject ? { provider: subject.provider, url: subject.url, label: subject.label ?? subject.ref ?? '' } : undefined;
}

/** Only https addresses become links: a subject's URL comes from whoever registered the suite. */
export const isHttps = (url: string) => /^https:\/\//i.test(url);

export function runErrors(run: ReviewSuiteIndexRun) {
  return (run.replay?.consoleErrors ?? 0) + (run.replay?.failedRequests ?? 0);
}

export function sequenceLabel(run: Pick<ReviewSuiteIndexRun, 'sequence'>) {
  return String(run.sequence).padStart(2, '0');
}

export function statusTone(run: ReviewSuiteIndexRun, detailed: boolean) {
  if (run.status === 'running') return 'running';
  if (!playableReplayId(run, detailed)) return 'waiting';
  return run.status;
}

export const TONE_LABELS: Record<string, string> = {
  failed: 'Failed',
  passed: 'Passed',
  running: 'Running',
  partial: 'Partial',
  waiting: 'No recording',
};

/** "Expires in 3 days" (with the full date) for a run's recording close to its expiry. */
export function expiryNotice(run: ReviewSuiteIndexRun, now = Date.now()) {
  const at = run.replay?.expiresAt;
  if (!at || run.replay?.kept) return undefined;
  const days = daysUntil(at, now);
  if (days > EXPIRY_NOTICE_DAYS) return undefined;
  return { label: days === 0 ? SUITE_STRINGS.expiresToday : SUITE_STRINGS.expiresIn(days), date: new Date(at).toLocaleString() };
}

export function expiredRuns(runs: readonly ReviewSuiteIndexRun[], detailed: boolean) {
  return runs.filter((run) => isExpired(run, detailed)).length;
}
