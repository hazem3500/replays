import { createHash } from 'node:crypto';

import type { ReplayBundle } from '../shared/replay.ts';
import { assertReplayId } from '../shared/replay.ts';
import { MAX_SUMMARY_LENGTH, measureMsOf, type ReviewRunStatus, type ReviewSuite } from '../shared/review-suite.ts';
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
  /** When each labelled step completed, on the recording's clock; absent for a reused recording. */
  stepEnds?: ReadonlyArray<{ label: string; at: number }> | undefined;
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

// oxlint-disable-next-line no-control-regex -- why: the server refuses control characters in a summary, so they are replaced here.
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

function composeSummary(run: SuitePlanRun, problems: string[], heading: string): string | undefined {
  const parts = [run.summary];
  if (problems.length === 1) parts.push(`${heading} ${problems[0]}`);
  else if (problems.length) parts.push(`${heading}\n${problems.map((problem) => `- ${problem}`).join('\n')}`);
  const text = parts.filter(Boolean).join('\n\n').replace(CONTROL, ' ').trim();
  return text ? text.slice(0, MAX_SUMMARY_LENGTH) : undefined;
}

/** One line: a driver's call log is useful in a terminal, not in a run's summary. */
const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).split('\n')[0]?.trim().slice(0, 300) ?? '';

interface Attempt {
  run: SuitePlanRun;
  bundle: ReplayBundle;
  base: RunOutcome;
  problems: string[];
  stepEnds?: RecordedRun['stepEnds'] | undefined;
}

interface Linked {
  connection: SuiteConnection;
  suite: ReviewSuite;
}

/** Records one plan: the suite is held here as the server last answered, so each call repeats what it pinned. */
class SuiteRecorder {
  private suite: ReviewSuite | undefined;
  private readonly plan: SuitePlan;
  private readonly deps: RecordDeps;
  private readonly now: () => Date;

  constructor(plan: SuitePlan, deps: RecordDeps) {
    this.plan = plan;
    this.deps = deps;
    this.now = () => deps.now?.() ?? new Date();
  }

  async register() {
    const { connection } = this.deps;
    if (!connection) return;
    const { plan } = this;
    this.suite = (
      await ensureSuite(
        connection.api,
        {
          id: plan.id,
          title: plan.title,
          profile: plan.profile,
          source: plan.source,
          people: plan.people,
          summary: plan.summary,
          baseline: plan.baseline,
          createdAt: plan.createdAt,
        },
        this.now,
      )
    ).suite;
  }

  private linked(): Linked | undefined {
    const { connection } = this.deps;
    return connection && this.suite ? { connection, suite: this.suite } : undefined;
  }

  private async mark(
    run: SuitePlanRun,
    update: { status: ReviewRunStatus; summary?: string | undefined; title?: string; measureMs?: number | undefined },
  ) {
    const link = this.linked();
    if (!link) return;
    const { group, target, measure, focus } = run;
    this.suite = (await putRun(link.connection.api, link.suite, { id: run.id, group, target, measure, focus, ...update }, this.now)).suite;
  }

  private finishedOutcome(run: SuitePlanRun): RunOutcome | undefined {
    const known = this.suite?.runs.find((item) => item.id === run.id);
    if (!known || !isTerminal(known.status)) return undefined;
    const server = this.deps.connection?.server;
    return {
      id: run.id,
      title: run.title,
      status: known.status === 'passed' ? 'skipped' : 'failed',
      uploaded: Boolean(known.replayId),
      ...(known.replayId ? { replayId: known.replayId } : {}),
      ...(known.replayId && server ? { replayUrl: replayUrl(server, this.plan.id, known.replayId) } : {}),
      ...(known.status === 'passed'
        ? { note: 'already passed on the server; skipped' }
        : {
            error: `already finished as ${known.status} on the server; finished runs keep their status, so use a new run id to record it again`,
          }),
    };
  }

  private async captureFailed(run: SuitePlanRun, error: unknown): Promise<RunOutcome> {
    const reason = message(error);
    let registered = '';
    try {
      await this.mark(run, { status: 'failed', summary: composeSummary(run, [reason], 'Recording failed:') });
    } catch (putError) {
      registered = `; could not mark the run failed: ${message(putError)}`;
    }
    return { id: run.id, title: run.title, status: 'failed', uploaded: false, error: `recording failed: ${reason}${registered}` };
  }

  private async upload(attempt: Attempt, link: Linked): Promise<RunOutcome> {
    const { run, bundle, base, problems, stepEnds } = attempt;
    const retry = this.deps.retryCommand(run);
    const verdict = base.status === 'failed' ? 'failed' : 'passed';
    const attached = link.suite.runs.find((item) => item.id === run.id)?.replayId === bundle.meta.id;
    let url = replayUrl(link.connection.server, this.plan.id, bundle.meta.id);
    try {
      if (!attached) url = (await this.deps.uploadRun(bundle, base.outputDir ?? '')).url;
    } catch (error) {
      return { ...base, status: 'upload-failed', uploaded: false, error: `upload failed: ${message(error)}`, retry };
    }
    const summary = composeSummary(run, problems, 'Expectations not met:');
    try {
      const measureMs = run.measure
        ? (stepEnds?.find((end) => end.label === run.measure)?.at ?? measureMsOf(bundle, run.measure))
        : undefined;
      await this.mark(run, { status: verdict, summary, measureMs });
      return { ...base, uploaded: true, replayUrl: url, ...(summary ? { summary } : {}) };
    } catch (error) {
      return {
        ...base,
        status: 'upload-failed',
        uploaded: true,
        replayUrl: url,
        error: `uploaded, but could not mark the run ${verdict}: ${message(error)}`,
        retry,
      };
    }
  }

  async recordOne(run: SuitePlanRun): Promise<RunOutcome> {
    const finished = this.finishedOutcome(run);
    if (finished) return finished;
    try {
      await this.mark(run, { title: run.title, status: 'running', summary: run.summary });
    } catch (error) {
      return { id: run.id, title: run.title, status: 'failed', uploaded: false, error: `could not register the run: ${message(error)}` };
    }
    const outputDir = this.deps.outputDirFor(run);
    let recorded: RecordedRun;
    try {
      recorded = await this.deps.recordRun(run, replayIdFor(this.plan.id, run.id), outputDir);
    } catch (error) {
      return this.captureFailed(run, error);
    }
    const problems = failedExpectations(recorded.bundle, run.expect);
    const base: RunOutcome = {
      id: run.id,
      title: run.title,
      status: problems.length ? 'failed' : 'passed',
      uploaded: false,
      replayId: recorded.bundle.meta.id,
      duration: recorded.bundle.meta.duration,
      outputDir,
      ...(problems.length ? { error: `expectations not met: ${problems.join('; ')}` } : {}),
    };
    const link = this.linked();
    return link ? this.upload({ run, bundle: recorded.bundle, base, problems, stepEnds: recorded.stepEnds }, link) : base;
  }
}

/**
 * Runs the plan: each run is registered as running, recorded, uploaded to its suite run and marked passed or failed. A run
 * that fails does not stop the ones after it. A recording that could not be uploaded stays on disk and its run stays
 * running, so `--only <run>` can finish it; a capture that failed, or an expectation that did not hold, ends it failed.
 */
export async function recordSuite(plan: SuitePlan, runs: readonly SuitePlanRun[], deps: RecordDeps): Promise<RecordResult> {
  const recorder = new SuiteRecorder(plan, deps);
  await recorder.register();
  const outcomes: RunOutcome[] = [];
  for (const run of runs) {
    deps.onStart?.(run);
    const outcome = await recorder.recordOne(run);
    outcomes.push(outcome);
    deps.onResult?.(outcome);
  }
  const { connection } = deps;
  return {
    suite: { id: plan.id, title: plan.title, ...(connection ? { url: suiteUrl(connection.server, plan.id) } : {}) },
    runs: outcomes,
    failed: outcomes.filter((outcome) => outcome.status !== 'passed' && outcome.status !== 'skipped').length,
  };
}
