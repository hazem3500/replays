import type { KeepRecord } from './retention.ts';
import { assertReplayContext, assertSafeUrl, type ReplayContext, type ReplaySourceInput, type ReplaySourceRef } from './context.ts';
import {
  assertReplayPeople,
  minimalPeople,
  type PersonIdentity,
  personMatch,
  type ReplayPerson,
  type ReplayPersonSummary,
} from './people.ts';
import { isProfileId } from './profiles.ts';
import { assertReplayId, type ReplayBundle, type ReplaySummary } from './replay.ts';

export type ReviewRunStatus = 'running' | 'passed' | 'failed' | 'partial';
export type SuiteOverallStatus = 'Waiting' | 'Running' | 'Failed' | 'Partial' | 'Complete';

/** A suite with no runs yet is waiting, not complete. */
export function suiteOverallStatus(runs: Array<Pick<ReviewSuiteRun, 'status' | 'replayId'>>): SuiteOverallStatus {
  if (runs.length === 0) return 'Waiting';
  if (runs.some((run) => run.status === 'running')) return 'Running';
  if (runs.some((run) => run.status === 'failed')) return 'Failed';
  if (runs.some((run) => run.status === 'partial' || !run.replayId)) return 'Partial';
  return 'Complete';
}

/** Longest `summary` a suite or run may carry. */
export const MAX_SUMMARY_LENGTH = 4000;

/**
 * A summary is plain text: paragraphs split by blank lines and `- ` bullet lines. It is never parsed as HTML, so it
 * may not carry control characters; the viewer renders it as text.
 */
export function assertSummary(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_SUMMARY_LENGTH) throw new Error(`${name} is invalid`);
  // oxlint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new Error(`${name} contains control characters`);
}

export interface ReviewSuiteRun {
  id: string;
  sequence: number;
  label: string;
  status: ReviewRunStatus;
  startedAt: string;
  finishedAt?: string;
  /** What this run checked and found, as plain text (see `assertSummary`); shown in the run's Context tab. */
  summary?: string;
  /** The flow this run exercises (plan `group`); runs in one group are comparable. */
  group?: string;
  /** What it ran against (a build or variant); runs with the same group and target are samples. */
  target?: string;
  /** The label of the step whose completion is the run's headline number. */
  measure?: string;
  /** Milliseconds from the recording's start until the `measure` step completed. */
  measureMs?: number;
  replayId?: string;
  recording?: { title: string; duration: number; steps: number; viewport: { width: number; height: number } };
  /** Per-run snapshot overrides shared suite context without rewriting its capture time. */
  context?: ReplayContext;
}

export interface ReviewSuite {
  version: 1;
  /** Unique ID for one accepted suite registration (a CI run, a review pass), not a pull request number. */
  id: string;
  title: string;
  createdAt: string;
  /** What the suite is about (a pull request, a ticket); optional. */
  subject?: ReplaySourceRef;
  /** Shared snapshot; each context retains its own capturedAt timestamp. */
  context?: ReplayContext;
  /** People related to the suite (src/shared/people.ts). Not identity: registering again may replace them. */
  people?: ReplayPerson[];
  /** The suite's profile id: its `view` is what the suite opens in (src/shared/views.ts). */
  profile?: string;
  /** What the suite found and what it did not cover, as plain text (see `assertSummary`); shown in the sidebar header. */
  summary?: string;
  /** The target that comparisons between a group's targets are measured against. */
  baseline?: string;
  runs: ReviewSuiteRun[];
}

export interface ReviewSuiteSummary {
  id: string;
  title: string;
  createdAt: string;
  /** The suite's subject (provider, label, link); absent when it has none. */
  subject?: Pick<ReplaySourceRef, 'provider' | 'url'> & { label: string };
  /** The suite's own people; in API responses with the deployment's avatar and profile links. */
  people?: ReplayPersonSummary[];
  runs: number;
  running: number;
  failed: number;
  partial: number;
  missingRecordings: number;
  duration: number;
  /** Pinned by someone with access: the suite and its runs' replays never expire. Added by the server. */
  kept?: KeepRecord;
  /** When retention removes the suite; null when it never expires. Added by the server. */
  expiresAt?: string | null;
}

/** One run as the index lists it: registration fields plus its replay's summary when uploaded. */
export interface ReviewSuiteIndexRun extends Pick<
  ReviewSuiteRun,
  | 'id'
  | 'sequence'
  | 'label'
  | 'status'
  | 'startedAt'
  | 'finishedAt'
  | 'replayId'
  | 'summary'
  | 'group'
  | 'target'
  | 'measure'
  | 'measureMs'
> {
  replay?: ReplaySummary;
}

/** `GET /api/suites?expand=runs`: a suite summary with its runs, so the index can nest them. */
export interface ReviewSuiteIndexEntry extends ReviewSuiteSummary {
  runDetails: ReviewSuiteIndexRun[];
}

/**
 * How `me` relates to a suite: through its own people or any run's replay people, by `personMatch` priority
 * (`roles`, the deployment's order).
 */
export function suitePersonMatch(
  entry: Pick<ReviewSuiteIndexEntry, 'people' | 'runDetails'>,
  me: PersonIdentity,
  roles?: readonly string[],
): string | undefined {
  return personMatch([...(entry.people ?? []), ...entry.runDetails.flatMap((run) => run.replay?.people ?? [])], me, roles);
}

const RUN_ID = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,79}$/;
const STATUSES = new Set<ReviewRunStatus>(['running', 'passed', 'failed', 'partial']);

function record(value: unknown, label: string, keys: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some((key) => !keys.includes(key))) throw new Error(`${label} contains unsupported fields`);
  return result;
}

/** Longest `group`, `target` and `measure` a run may carry. */
export const MAX_GROUP_LENGTH = 80;
export const MAX_TARGET_LENGTH = 40;
const MAX_MEASURE_LENGTH = 160;

function assertName(value: unknown, name: string, max: number): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${name} is invalid`);
}

function assertGrouping(run: Record<string, unknown>, name: string) {
  if (run.group !== undefined) assertName(run.group, `${name}.group`, MAX_GROUP_LENGTH);
  if (run.target !== undefined) assertName(run.target, `${name}.target`, MAX_TARGET_LENGTH);
  if (run.measure !== undefined) assertName(run.measure, `${name}.measure`, MAX_MEASURE_LENGTH);
  if (run.measureMs !== undefined && (typeof run.measureMs !== 'number' || !Number.isFinite(run.measureMs) || run.measureMs < 0))
    throw new Error(`${name}.measureMs is invalid`);
}

/**
 * Milliseconds from the recording's start until the step labelled `label` completed: the next step's start, or for the
 * last step the end of the recording less the capture's closing wait. Undefined when no step has that label.
 */
export function measureMsOf(
  bundle: { meta: Pick<ReplayBundle['meta'], 'duration'>; steps: ReadonlyArray<Pick<ReplayBundle['steps'][number], 'at' | 'label'>> },
  label: string,
): number | undefined {
  const steps = bundle.steps.toSorted((a, b) => a.at - b.at);
  const index = steps.findIndex((step) => step.label === label);
  const step = steps[index];
  if (!step) return undefined;
  const next = steps[index + 1];
  // why: the capture holds the page for CLOSING_WAIT_MS after its last step before it stops recording.
  const end = next ? next.at : bundle.meta.duration - CLOSING_WAIT_MS;
  return Math.round(Math.max(step.at, end));
}

const CLOSING_WAIT_MS = 900;

function date(value: unknown, label: string) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error(`${label} is invalid`);
}

function assertSubject(value: unknown) {
  const subject = record(value, 'suite.subject', ['provider', 'ref', 'url', 'label']);
  if (typeof subject.provider !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/.test(subject.provider))
    throw new Error('suite.subject.provider is invalid');
  assertSafeUrl(subject.url, 'suite.subject.url');
}

export function assertReviewSuite(value: unknown): asserts value is ReviewSuite {
  const suite = record(value, 'suite', [
    'version',
    'id',
    'title',
    'createdAt',
    'subject',
    'context',
    'people',
    'profile',
    'summary',
    'baseline',
    'runs',
  ]);
  if (suite.version !== 1) throw new Error('suite.version is unsupported');
  if (typeof suite.id !== 'string') throw new Error('suite.id is invalid');
  assertReplayId(suite.id);
  if (typeof suite.title !== 'string' || !suite.title.trim() || suite.title.length > 160) throw new Error('suite.title is invalid');
  date(suite.createdAt, 'suite.createdAt');
  if (suite.subject !== undefined) assertSubject(suite.subject);
  if (suite.context !== undefined) assertReplayContext(suite.context);
  if (suite.people !== undefined) assertReplayPeople(suite.people, 'suite.people');
  if (suite.profile !== undefined && !isProfileId(suite.profile)) throw new Error('suite.profile is invalid');
  if (suite.summary !== undefined) assertSummary(suite.summary, 'suite.summary');
  if (suite.baseline !== undefined) assertName(suite.baseline, 'suite.baseline', MAX_TARGET_LENGTH);
  if (!Array.isArray(suite.runs) || suite.runs.length > 100) throw new Error('suite.runs must contain at most 100 entries');
  const ids = new Set<string>();
  const sequences = new Set<number>();
  for (const [index, raw] of suite.runs.entries()) {
    const name = `suite.runs[${index}]`;
    const run = record(raw, name, [
      'id',
      'sequence',
      'label',
      'status',
      'startedAt',
      'finishedAt',
      'summary',
      'group',
      'target',
      'measure',
      'measureMs',
      'replayId',
      'recording',
      'context',
    ]);
    if (typeof run.id !== 'string' || !RUN_ID.test(run.id) || ids.has(run.id)) throw new Error(`${name}.id is invalid or duplicated`);
    ids.add(run.id);
    if (!Number.isSafeInteger(run.sequence) || Number(run.sequence) < 1 || sequences.has(Number(run.sequence))) {
      throw new Error(`${name}.sequence is invalid or duplicated`);
    }
    sequences.add(Number(run.sequence));
    if (typeof run.label !== 'string' || !run.label.trim() || run.label.length > 160) throw new Error(`${name}.label is invalid`);
    if (!STATUSES.has(run.status as ReviewRunStatus)) throw new Error(`${name}.status is invalid`);
    date(run.startedAt, `${name}.startedAt`);
    if (run.finishedAt !== undefined) date(run.finishedAt, `${name}.finishedAt`);
    if (run.replayId !== undefined) {
      if (typeof run.replayId !== 'string') throw new Error(`${name}.replayId is invalid`);
      assertReplayId(run.replayId);
    }
    if (run.recording !== undefined) {
      const recording = record(run.recording, `${name}.recording`, ['title', 'duration', 'steps', 'viewport']);
      if (typeof recording.title !== 'string' || recording.title.length > 200) throw new Error(`${name}.recording.title is invalid`);
      if (!Number.isFinite(recording.duration) || Number(recording.duration) < 0) throw new Error(`${name}.recording.duration is invalid`);
      if (!Number.isSafeInteger(recording.steps) || Number(recording.steps) < 0) throw new Error(`${name}.recording.steps is invalid`);
      const viewport = record(recording.viewport, `${name}.recording.viewport`, ['width', 'height']);
      if (![viewport.width, viewport.height].every((dimension) => Number.isSafeInteger(dimension) && Number(dimension) > 0)) {
        throw new Error(`${name}.recording.viewport is invalid`);
      }
      if (!run.replayId) throw new Error(`${name}.recording requires replayId`);
    }
    if (run.context !== undefined) assertReplayContext(run.context);
    if (run.summary !== undefined) assertSummary(run.summary, `${name}.summary`);
    assertGrouping(run, name);
  }
}

export interface ReviewSuiteRegistration {
  version: 1;
  id: string;
  title: string;
  createdAt: string;
  /** A provider reference (`{ provider: 'github', ref: 'acme/api#12' }`) or a complete source; the server resolves it. */
  subject?: ReplaySourceInput;
  context?: ReplayContext;
  /** Absent on a later registration keeps the stored people; present replaces them. */
  people?: ReplayPerson[];
  /** A profile id; the suite opens in that profile's view. */
  profile?: string;
  /** Not identity: registering again replaces it (absent keeps the stored one). */
  summary?: string;
  /** Not identity: the target comparisons are measured against. */
  baseline?: string;
}

/** A registration after the server resolved the subject reference into a link. */
export type ResolvedSuiteRegistration = Omit<ReviewSuiteRegistration, 'subject'> & { subject?: ReplaySourceRef };

export interface ReviewRunRegistration {
  id: string;
  sequence: number;
  label: string;
  status: ReviewRunStatus;
  startedAt: string;
  finishedAt?: string;
  /** Not identity: registering again replaces it (absent keeps the stored one). */
  summary?: string;
  group?: string;
  target?: string;
  measure?: string;
  measureMs?: number;
  context?: ReplayContext;
}

export function assertReviewSuiteRegistration(value: unknown, suiteId: string): asserts value is ReviewSuiteRegistration {
  const input = record(value, 'suite registration', [
    'version',
    'id',
    'title',
    'createdAt',
    'subject',
    'context',
    'people',
    'profile',
    'summary',
    'baseline',
  ]);
  if (input.id !== suiteId) throw new Error('suite ID does not match path');
  const { subject, ...rest } = input;
  if (subject !== undefined) record(subject, 'suite.subject', ['provider', 'ref', 'url', 'label']);
  // why: the subject is validated after the server resolves it (source-providers.ts), so check the rest here.
  assertReviewSuite({ ...rest, id: suiteId, runs: [] });
}

export function assertReviewRunRegistration(value: unknown, runId: string): asserts value is ReviewRunRegistration {
  const input = record(value, 'run registration', [
    'id',
    'sequence',
    'label',
    'status',
    'startedAt',
    'finishedAt',
    'summary',
    'group',
    'target',
    'measure',
    'measureMs',
    'context',
  ]);
  if (input.id !== runId) throw new Error('run ID does not match path');
  assertReviewSuite({
    version: 1,
    id: 'validation-suite',
    title: 'validation',
    createdAt: String(input.startedAt),
    runs: [input],
  });
}

export function summarizeReviewSuite(suite: ReviewSuite): ReviewSuiteSummary {
  return {
    id: suite.id,
    title: suite.title,
    createdAt: suite.createdAt,
    ...(suite.subject
      ? {
          subject: {
            provider: suite.subject.provider,
            url: suite.subject.url,
            label: suite.subject.label ?? suite.subject.ref ?? suite.subject.url,
          },
        }
      : {}),
    ...(suite.people?.length ? { people: minimalPeople(suite.people) } : {}),
    runs: suite.runs.length,
    running: suite.runs.filter((run) => run.status === 'running').length,
    failed: suite.runs.filter((run) => run.status === 'failed').length,
    partial: suite.runs.filter((run) => run.status === 'partial').length,
    missingRecordings: suite.runs.filter((run) => !run.replayId).length,
    duration: suite.runs.reduce((total, run) => total + (run.recording?.duration ?? 0), 0),
  };
}
