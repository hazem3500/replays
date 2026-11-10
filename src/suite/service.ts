import type { ReviewSuiteAdapter } from '../capture/review-suite.ts';
import { ReviewSuiteHttpError } from '../capture/review-suite.ts';
import type { ReplayPerson } from '../shared/people.ts';
import {
  assertSummary,
  type ReviewRunRegistration,
  type ReviewRunStatus,
  type ReviewSuite,
  type ReviewSuiteRegistration,
  type ReviewSuiteRun,
} from '../shared/review-suite.ts';
import { SourceProviders } from '../shared/source-providers.ts';
import { assertTransition, isTerminal, nextSequence } from './lifecycle.ts';

export interface SuiteInput {
  id: string;
  title: string;
  profile?: string | undefined;
  source?: string | undefined;
  people?: ReplayPerson[] | undefined;
  summary?: string | undefined;
  createdAt?: string | undefined;
}

export interface EnsuredSuite {
  suite: ReviewSuite;
  /** False when the server already had this suite and the call matched it. */
  created: boolean;
}

export const FAILURE_SUMMARY_NOTE = 'Recording failed';

function registrationOf(input: SuiteInput, createdAt: string): ReviewSuiteRegistration {
  if (input.summary !== undefined) assertSummary(input.summary, 'summary');
  return {
    version: 1,
    id: input.id,
    title: input.title,
    createdAt,
    ...(input.source ? { subject: new SourceProviders().parse(input.source) } : {}),
    ...(input.profile ? { profile: input.profile } : {}),
    ...(input.people?.length ? { people: input.people } : {}),
    ...(input.summary ? { summary: input.summary } : {}),
  };
}

/**
 * Registers the suite. The server answers 409 for the same id with another identity (title, source, profile or creation
 * time), so a repeat call has to reuse the stored creation time; when the stored suite matches what was asked for, that
 * is success, and any people or summary given replace the stored ones.
 */
export async function ensureSuite(api: ReviewSuiteAdapter, input: SuiteInput, now: () => Date = () => new Date()): Promise<EnsuredSuite> {
  try {
    const suite = await api.registerSuite(registrationOf(input, input.createdAt ?? now().toISOString()));
    return { suite, created: true };
  } catch (error) {
    if (!(error instanceof ReviewSuiteHttpError) || error.status !== 409) throw error;
    const existing = await api.getSuite(input.id);
    if (!existing) throw error;
    try {
      return { suite: await api.registerSuite(registrationOf(input, existing.createdAt)), created: false };
    } catch (retry) {
      if (retry instanceof ReviewSuiteHttpError && retry.status === 409)
        throw new Error(
          `suite ${input.id} already exists with a different title, source or profile (${existing.title}); choose another --id, or repeat the original options`,
          { cause: retry },
        );
      throw retry;
    }
  }
}

async function loadSuite(api: ReviewSuiteAdapter, id: string): Promise<ReviewSuite> {
  const suite = await api.getSuite(id);
  if (!suite) throw new Error(`suite ${id} was not found; create it first with \`replays suite create --id ${id} --title "…"\``);
  return suite;
}

export interface RunUpdate {
  id: string;
  title?: string | undefined;
  status: ReviewRunStatus;
  summary?: string | undefined;
}

/** Registers a run or moves an existing one on, keeping the sequence, label and start the server pinned. */
export async function putRun(api: ReviewSuiteAdapter, suite: ReviewSuite, update: RunUpdate, now: () => Date = () => new Date()) {
  const existing: ReviewSuiteRun | undefined = suite.runs.find((run) => run.id === update.id);
  assertTransition(update.id, existing?.status, update.status);
  if (update.summary !== undefined) assertSummary(update.summary, 'summary');
  if (!existing && !update.title) throw new Error(`run ${update.id} is new; give it a --title`);
  const registration: ReviewRunRegistration = {
    id: update.id,
    sequence: existing?.sequence ?? nextSequence(suite.runs),
    label: existing?.label ?? update.title!,
    status: update.status,
    startedAt: existing?.startedAt ?? now().toISOString(),
    ...(isTerminal(update.status) ? { finishedAt: existing?.finishedAt ?? now().toISOString() } : {}),
    ...(update.summary ? { summary: update.summary } : {}),
  };
  const next = await api.registerRun(suite.id, registration);
  return { suite: next, run: next.runs.find((run) => run.id === update.id) ?? { ...registration } };
}

export async function addRun(api: ReviewSuiteAdapter, suiteId: string, update: RunUpdate) {
  return putRun(api, await loadSuite(api, suiteId), update);
}

export async function setRunStatus(api: ReviewSuiteAdapter, suiteId: string, runId: string, status: ReviewRunStatus, summary?: string) {
  const suite = await loadSuite(api, suiteId);
  if (!suite.runs.some((run) => run.id === runId))
    throw new Error(`run ${runId} is not in suite ${suiteId}; add it with \`replays suite run add\``);
  return putRun(api, suite, { id: runId, status, summary });
}

export async function setRunSummary(api: ReviewSuiteAdapter, suiteId: string, runId: string, summary: string) {
  const suite = await loadSuite(api, suiteId);
  const run = suite.runs.find((item) => item.id === runId);
  if (!run) throw new Error(`run ${runId} is not in suite ${suiteId}`);
  return putRun(api, suite, { id: runId, status: run.status, summary });
}

/** Re-registers the stored suite with a new summary; everything that is identity is repeated as stored. */
export async function setSuiteSummary(api: ReviewSuiteAdapter, suiteId: string, summary: string) {
  assertSummary(summary, 'summary');
  const { runs: _runs, ...stored } = await loadSuite(api, suiteId);
  const { people: _people, ...identity } = stored;
  return api.registerSuite({ ...identity, summary } as ReviewSuiteRegistration);
}
