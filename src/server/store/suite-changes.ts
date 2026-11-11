import { HttpError } from '../../shared/http-error.ts';
import type { ReplayBundle } from '../../shared/replay.ts';
import type { ResolvedSuiteRegistration, ReviewRunRegistration, ReviewSuite, ReviewSuiteRun } from '../../shared/review-suite.ts';

/** What a suite change stores (`next`, or nothing when it leaves the suite as read) and what it answers. */
export interface SuiteChange<T> {
  next: ReviewSuite | undefined;
  result: T;
}

/**
 * Registering again is idempotent: the same registration changes nothing, a different one conflicts. `people` is not
 * identity: a re-registration may add or replace them (absent keeps what is stored). `summary` is not identity either.
 */
export function registration(current: ReviewSuite | undefined, id: string, input: ResolvedSuiteRegistration): SuiteChange<ReviewSuite> {
  if (!current) {
    const suite: ReviewSuite = { ...input, id, runs: [] };
    return { next: suite, result: suite };
  }
  const { runs, ...stored } = current;
  const { people: currentPeople, summary: currentSummary, baseline: currentBaseline, ...currentIdentity } = stored;
  const { people: requestedPeople, summary: requestedSummary, baseline: requestedBaseline, ...requestedIdentity } = input;
  if (JSON.stringify(currentIdentity) !== JSON.stringify({ ...requestedIdentity, id })) {
    throw new HttpError(409, `suite ${id} conflicts with its existing registration`);
  }
  const peopleChanged = requestedPeople !== undefined && JSON.stringify(requestedPeople) !== JSON.stringify(currentPeople);
  const summaryChanged = requestedSummary !== undefined && requestedSummary !== currentSummary;
  const baselineChanged = requestedBaseline !== undefined && requestedBaseline !== currentBaseline;
  if (!peopleChanged && !summaryChanged && !baselineChanged) return { next: undefined, result: current };
  // why: key order as on first registration (people, summary, then runs), so the stored file reads the same either way.
  const people = requestedPeople ?? currentPeople;
  const summary = requestedSummary ?? currentSummary;
  const baseline = requestedBaseline ?? currentBaseline;
  const updated: ReviewSuite = {
    ...currentIdentity,
    id,
    ...(people ? { people } : {}),
    ...(summary ? { summary } : {}),
    ...(baseline ? { baseline } : {}),
    runs,
  };
  return { next: updated, result: updated };
}

function assertRunUnchanged(existing: ReviewSuiteRun, runId: string, input: ReviewRunRegistration): void {
  if (existing.sequence !== input.sequence) throw new HttpError(409, `run ${runId} sequence cannot change`);
  if (existing.label !== input.label || existing.startedAt !== input.startedAt) {
    throw new HttpError(409, `run ${runId} identity cannot change`);
  }
  if (existing.status !== 'running' && existing.status !== input.status) {
    throw new HttpError(409, `run ${runId} terminal status cannot change`);
  }
}

function grouping({ group, target, measure, measureMs }: ReviewSuiteRun) {
  return {
    ...(group ? { group } : {}),
    ...(target ? { target } : {}),
    ...(measure ? { measure } : {}),
    ...(measureMs === undefined ? {} : { measureMs }),
  };
}

/** The suite with `runId` registered or updated; a run's identity and a finished run's status never change. */
export function withRun(suite: ReviewSuite, runId: string, input: ReviewRunRegistration): ReviewSuite {
  const existing = suite.runs.find((run) => run.id === runId);
  if (existing) assertRunUnchanged(existing, runId, input);
  if (existing?.replayId && input.status === 'running') return suite;
  const summary = input.summary ?? existing?.summary;
  const run: ReviewSuiteRun = {
    ...(existing ? grouping(existing) : {}),
    ...input,
    ...(summary ? { summary } : {}),
    ...(existing?.replayId ? { replayId: existing.replayId, recording: existing.recording } : {}),
  };
  return {
    ...suite,
    runs: existing ? suite.runs.map((item) => (item.id === runId ? run : item)) : [...suite.runs, run],
  };
}

/** The registered run, which may take `replayId` only when it has no other recording yet. */
export function attachableRun(suite: ReviewSuite | undefined, runId: string, replayId: string): ReviewSuiteRun {
  const run = suite?.runs.find((item) => item.id === runId);
  if (!run) throw new HttpError(404, 'review suite run is not registered');
  if (run.replayId && run.replayId !== replayId) throw new HttpError(409, 'review suite run already has a different recording');
  return run;
}

/** The suite with `bundle` recorded on run `runId`. */
export function withRecording(suite: ReviewSuite, runId: string, bundle: ReplayBundle): ReviewSuite {
  attachableRun(suite, runId, bundle.meta.id);
  const recording = {
    title: bundle.meta.title,
    duration: bundle.meta.duration,
    steps: bundle.steps.length,
    viewport: bundle.meta.viewport,
  };
  return {
    ...suite,
    runs: suite.runs.map((item) => (item.id === runId ? { ...item, replayId: bundle.meta.id, recording } : item)),
  };
}
