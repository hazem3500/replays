import { createHash } from 'node:crypto';

import type { ReplayBundle } from '../shared/replay.ts';
import { assertReplayId } from '../shared/replay.ts';
import { MAX_SUMMARY_LENGTH, type ReviewSuite } from '../shared/review-suite.ts';
import { isTerminal } from './lifecycle.ts';
import type { RunExpectations, SuitePlan, SuitePlanRun } from './plan.ts';
import { ensureSuite, putRun } from './service.ts';
import type { SuiteConnection } from './connection.ts';
import { replayUrl, suiteUrl } from './connection.ts';

export type RunOutcomeStatus = 'passed' | 'failed' | 'skipped' | 'upload-failed';

export interface RunOutcome {
  id: string;
  title: string;
  status: RunOutcomeStatus;
  /** Whether the replay is on the server, attached to the run. */
  uploaded: boolean;
  replayId?: string;
  replayUrl?: string;
  /** Milliseconds of the recording. */
  duration?: number;
  summary?: string;
  error?: string;
  note?: string;
  /** Where the recording is kept on this machine. */
  outputDir?: string;
  /** The command that finishes this run after a failed upload. */
  retry?: string;
}

export interface RecordedRun {
  bundle: ReplayBundle;
  /** An earlier recording found on disk and used instead of a new capture. */
  reused: boolean;
}

export interface RecordDeps {
  /** Absent for a local-only recording: the server is not contacted. */
  connection?: SuiteConnection | undefined;
  recordRun(run: SuitePlanRun, replayId: string, outputDir: string): Promise<RecordedRun>;
  uploadRun(bundle: ReplayBundle, outputDir: string): Promise<{ url: string }>;
  outputDirFor(run: SuitePlanRun): string;
  retryCommand(run: SuitePlanRun): string;
  onStart?(run: SuitePlanRun): void;
  onResult?(outcome: RunOutcome): void;
  now?(): Date;
}

export interface RecordResult {
  suite: { id: string; title: string; url?: string };
  runs: RunOutcome[];
  /** Runs that did not pass (failed, or recorded but not uploaded). */
  failed: number;
}

/** A replay id that is stable per suite run, so an upload that is retried lands on the same replay. */
export function replayIdFor(suiteId: string, runId: string): string {
  const base = `${suiteId}-${runId}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  if (base.length <= 80) return assertReplayId(base);
  const hash = createHash('sha256').update(`${suiteId}\n${runId}`).digest('hex').slice(0, 8);
  return assertReplayId(`${base.slice(0, 71).replace(/-+$/, '')}-${hash}`);
}

/** What the run promised about its recording that did not hold, one sentence each. */
export function failedExpectations(bundle: ReplayBundle, expect: RunExpectations | undefined): string[] {
  if (!expect) return [];
  const problems: string[] = [];
  if (expect.noConsoleErrors) {
    const errors = bundle.console.filter((entry) => entry.level === 'error').length;
    if (errors) problems.push(`${errors} console error${errors === 1 ? '' : 's'}`);
  }
  if (expect.noFailedRequests) {
    const failed = bundle.network.filter((entry) => entry.status >= 400).length;
    if (failed) problems.push(`${failed} failed request${failed === 1 ? '' : 's'} (status 400 or above)`);
  }
  if (expect.maxDurationMs !== undefined && bundle.meta.duration > expect.maxDurationMs)
    problems.push(`took ${Math.round(bundle.meta.duration)} ms, over the ${expect.maxDurationMs} ms limit`);
  return problems;
}

// oxlint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

function composeSummary(run: SuitePlanRun, problems: string[], heading: string): string | undefined {
  const parts = [run.summary];
  if (problems.length === 1) parts.push(`${heading} ${problems[0]}`);
  else if (problems.length) parts.push(`${heading}\n${problems.map((problem) => `- ${problem}`).join('\n')}`);
  const text = parts.filter(Boolean).join('\n\n').replace(CONTROL, ' ').trim();
  return text ? text.slice(0, MAX_SUMMARY_LENGTH) : undefined;
}

/** One line: a driver's call log is useful in a terminal, not in a run's summary. */
const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).split('\n')[0]!.trim().slice(0, 300);

/**
 * Runs the plan: each run is registered as running, recorded, uploaded to its suite run and marked passed or failed. A run
 * that fails does not stop the ones after it. A recording that could not be uploaded stays on disk and its run stays
 * running, so `--only <run>` can finish it; a capture that failed, or an expectation that did not hold, ends it failed.
 */
export async function recordSuite(plan: SuitePlan, runs: readonly SuitePlanRun[], deps: RecordDeps): Promise<RecordResult> {
  const now = deps.now ?? (() => new Date());
  const { connection } = deps;
  let suite: ReviewSuite | undefined;
  if (connection)
    suite = (
      await ensureSuite(
        connection.api,
        {
          id: plan.id,
          title: plan.title,
          profile: plan.profile,
          source: plan.source,
          people: plan.people,
          summary: plan.summary,
          createdAt: plan.createdAt,
        },
        now,
      )
    ).suite;
  const link = connection ? suiteUrl(connection.server, plan.id) : undefined;
  const outcomes: RunOutcome[] = [];

  const finish = (outcome: RunOutcome) => {
    outcomes.push(outcome);
    deps.onResult?.(outcome);
  };

  for (const run of runs) {
    deps.onStart?.(run);
    const outputDir = deps.outputDirFor(run);
    const replayId = replayIdFor(plan.id, run.id);
    const retry = deps.retryCommand(run);
    const known = suite?.runs.find((item) => item.id === run.id);
    if (known && isTerminal(known.status)) {
      finish({
        id: run.id,
        title: run.title,
        status: known.status === 'passed' ? 'skipped' : 'failed',
        uploaded: Boolean(known.replayId),
        ...(known.replayId ? { replayId: known.replayId } : {}),
        ...(known.replayId && connection ? { replayUrl: replayUrl(connection.server, plan.id, known.replayId) } : {}),
        ...(known.status === 'passed'
          ? { note: 'already passed on the server; skipped' }
          : {
              error: `already finished as ${known.status} on the server; finished runs keep their status, so use a new run id to record it again`,
            }),
      });
      continue;
    }

    try {
      if (connection && suite)
        suite = (await putRun(connection.api, suite, { id: run.id, title: run.title, status: 'running', summary: run.summary }, now)).suite;
    } catch (error) {
      finish({ id: run.id, title: run.title, status: 'failed', uploaded: false, error: `could not register the run: ${message(error)}` });
      continue;
    }

    let recorded: RecordedRun;
    try {
      recorded = await deps.recordRun(run, replayId, outputDir);
    } catch (error) {
      const reason = message(error);
      let registered = '';
      try {
        if (connection && suite)
          suite = (
            await putRun(
              connection.api,
              suite,
              { id: run.id, status: 'failed', summary: composeSummary(run, [reason], 'Recording failed:') },
              now,
            )
          ).suite;
      } catch (putError) {
        registered = `; could not mark the run failed: ${message(putError)}`;
      }
      finish({ id: run.id, title: run.title, status: 'failed', uploaded: false, error: `recording failed: ${reason}${registered}` });
      continue;
    }

    const { bundle } = recorded;
    const problems = failedExpectations(bundle, run.expect);
    const verdict = problems.length ? 'failed' : 'passed';
    const base = {
      id: run.id,
      title: run.title,
      replayId: bundle.meta.id,
      duration: bundle.meta.duration,
      outputDir,
      ...(problems.length ? { error: `expectations not met: ${problems.join('; ')}` } : {}),
    };
    if (!connection || !suite) {
      finish({ ...base, status: verdict, uploaded: false });
      continue;
    }

    const attached = suite.runs.find((item) => item.id === run.id)?.replayId === bundle.meta.id;
    let uploadedUrl = replayUrl(connection.server, plan.id, bundle.meta.id);
    try {
      if (!attached) uploadedUrl = (await deps.uploadRun(bundle, outputDir)).url;
    } catch (error) {
      finish({ ...base, status: 'upload-failed', uploaded: false, error: `upload failed: ${message(error)}`, retry });
      continue;
    }
    try {
      const summary = composeSummary(run, problems, 'Expectations not met:');
      suite = (await putRun(connection.api, suite, { id: run.id, status: verdict, summary }, now)).suite;
      finish({ ...base, status: verdict, uploaded: true, replayUrl: uploadedUrl, ...(summary ? { summary } : {}) });
    } catch (error) {
      finish({
        ...base,
        status: 'upload-failed',
        uploaded: true,
        replayUrl: uploadedUrl,
        error: `uploaded, but could not mark the run ${verdict}: ${message(error)}`,
        retry,
      });
    }
  }

  return {
    suite: { id: plan.id, title: plan.title, ...(link ? { url: link } : {}) },
    runs: outcomes,
    failed: outcomes.filter((outcome) => outcome.status !== 'passed' && outcome.status !== 'skipped').length,
  };
}
