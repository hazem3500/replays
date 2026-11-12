import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { assertCaptureUrl, validateSteps } from '../capture/capture-steps.ts';
import type { RawStep } from '../capture/drivers/types.ts';
import { parsePeopleFlags, type ReplayPerson } from '../shared/people.ts';
import { isProfileId } from '../shared/profiles.ts';
import { assertReplayId } from '../shared/replay.ts';
import { assertFocus, type FocusMarker, parseFocusSpec } from '../shared/run-focus.ts';
import { assertSummary, MAX_GROUP_LENGTH, MAX_TARGET_LENGTH } from '../shared/review-suite.ts';
import { SourceProviders } from '../shared/source-providers.ts';

export const MAX_PLAN_RUNS = 100;
export const RUN_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,79}$/;
const TITLE_MAX = 160;
const DEFAULT_VIEWPORT = { width: 1440, height: 900 };

/** Checks a run makes on what it recorded; the run fails when one does not hold. */
export interface RunExpectations {
  noConsoleErrors?: boolean;
  noFailedRequests?: boolean;
  maxDurationMs?: number;
}

export interface SuitePlanRun {
  id: string;
  title: string;
  url: string;
  steps: RawStep[];
  viewport: { width: number; height: number };
  expect?: RunExpectations;
  summary?: string;
  /** What to look at in the recording (src/shared/run-focus.ts): marker objects or `panel:pattern # note` strings. */
  focus?: FocusMarker[];
  /** The flow this run exercises; runs in one group are comparable. */
  group?: string;
  /** What it ran against; runs with the same group and target are samples. */
  target?: string;
  /** The label of one of this run's steps: the time until it completed is the run's headline number. */
  measure?: string;
}

export interface SuitePlan {
  id: string;
  title: string;
  profile?: string;
  /** `github:owner/repo#12`; the server turns it into the suite's link. */
  source?: string;
  people: ReplayPerson[];
  summary?: string;
  /** The target that comparisons are measured against; it must be the target of at least one run. */
  baseline?: string;
  /** Fixed for a plan that is run again, so the server sees the same suite identity. */
  createdAt?: string;
  runs: SuitePlanRun[];
}

const SUITE_KEYS = ['$schema', 'id', 'title', 'profile', 'source', 'people', 'summary', 'baseline', 'createdAt', 'runs'];
const RUN_KEYS = ['id', 'title', 'url', 'steps', 'viewport', 'expect', 'summary', 'focus', 'group', 'target', 'measure'];
const EXPECT_KEYS = ['noConsoleErrors', 'noFailedRequests', 'maxDurationMs'];

type Fields = Record<string, unknown>;

const isFields = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value);
const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every((entry) => typeof entry === 'string');

function fields(value: unknown, where: string, allowed: string[]): Fields {
  if (!isFields(value)) throw new Error(`${where} must be an object`);
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) throw new Error(`${where} has unsupported field ${unknown} (allowed: ${allowed.join(', ')})`);
  return value;
}

function title(value: unknown, where: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > TITLE_MAX)
    throw new Error(`${where} must be a non-empty string of at most ${TITLE_MAX} characters`);
  return value;
}

function scoped<T>(where: string, check: () => T): T {
  try {
    return check();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${where}: ${message.replace(/^--[a-z-]+(\[\d+\])?/, '').trim() || message}`, { cause: error });
  }
}

function summaryOf(value: unknown, where: string): string | undefined {
  if (value === undefined) return undefined;
  scoped(where, () => assertSummary(value, 'summary'));
  return typeof value === 'string' ? value : undefined;
}

export function parseViewport(value: unknown, where: string): { width: number; height: number } {
  if (typeof value === 'string') {
    const match = /^(\d{3,5})x(\d{3,5})$/.exec(value);
    if (!match) throw new Error(`${where} must look like 1440x900`);
    return { width: Number(match[1]), height: Number(match[2]) };
  }
  const { width, height } = fields(value, where, ['width', 'height']);
  if (!isSide(width) || !isSide(height)) throw new Error(`${where} needs integer width and height, or a string like 1440x900`);
  return { width, height };
}

const isSide = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 100 && value <= 99_999;

function expectations(value: unknown, where: string): RunExpectations | undefined {
  if (value === undefined) return undefined;
  const raw = fields(value, where, EXPECT_KEYS);
  const result: RunExpectations = {};
  for (const key of ['noConsoleErrors', 'noFailedRequests'] as const) {
    const flag = raw[key];
    if (flag === undefined) continue;
    if (typeof flag !== 'boolean') throw new Error(`${where}.${key} must be true or false`);
    result[key] = flag;
  }
  const max = raw.maxDurationMs;
  if (max === undefined) return result;
  if (typeof max !== 'number' || !Number.isFinite(max) || max <= 0) throw new Error(`${where}.maxDurationMs must be a positive number`);
  return { ...result, maxDurationMs: max };
}

function named(value: unknown, where: string, max: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new Error(`${where} must be a non-empty string of at most ${max} characters`);
  return value;
}

/** Markers as objects or `panel:pattern # note` strings, each checked as the server would. */
function focusOf(value: unknown, where: string): FocusMarker[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`${where} must be a list of focus markers`);
  const markers = value.map((item, index) => (typeof item === 'string' ? scoped(`${where}[${index}]`, () => parseFocusSpec(item)) : item));
  scoped(where, () => assertFocus(markers, 'focus'));
  return markers;
}

function runOf(value: unknown, index: number): SuitePlanRun {
  const where = `runs[${index}]`;
  const raw = fields(value, where, RUN_KEYS);
  const { id, url } = raw;
  if (typeof id !== 'string' || !RUN_ID_PATTERN.test(id))
    throw new Error(`${where}.id must be letters, digits and hyphens (at most 80, starting with a letter or digit)`);
  if (typeof url !== 'string') throw new Error(`${where}.url must be an https URL (http only for localhost)`);
  scoped(`${where}.url`, () => assertCaptureUrl(url, 'url'));
  if (raw.steps === undefined) throw new Error(`${where}.steps is required (use [] to just open the page)`);
  const steps = scoped(`${where}.steps`, () => validateSteps(raw.steps));
  const expect = expectations(raw.expect, `${where}.expect`);
  const summary = summaryOf(raw.summary, `${where}.summary`);
  const focus = focusOf(raw.focus, `${where}.focus`);
  const group = named(raw.group, `${where}.group`, MAX_GROUP_LENGTH);
  const target = named(raw.target, `${where}.target`, MAX_TARGET_LENGTH);
  const measure = named(raw.measure, `${where}.measure`, TITLE_MAX);
  if (measure !== undefined && !steps.some((step) => step.label === measure))
    throw new Error(`${where}.measure "${measure}" must be the label of one of the run's steps`);
  return {
    id,
    title: title(raw.title, `${where}.title`),
    url,
    steps,
    viewport: raw.viewport === undefined ? DEFAULT_VIEWPORT : parseViewport(raw.viewport, `${where}.viewport`),
    ...(expect ? { expect } : {}),
    ...(summary ? { summary } : {}),
    ...(focus?.length ? { focus } : {}),
    ...(group ? { group } : {}),
    ...(target ? { target } : {}),
    ...(measure ? { measure } : {}),
  };
}

function runsOf(value: unknown): SuitePlanRun[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('plan.runs must list at least one run');
  if (value.length > MAX_PLAN_RUNS) throw new Error(`plan.runs can hold at most ${MAX_PLAN_RUNS} runs`);
  const runs = value.map((entry: unknown, index: number) => runOf(entry, index));
  const seen = new Set<string>();
  for (const run of runs) {
    if (seen.has(run.id)) throw new Error(`plan.runs has the run id ${run.id} twice`);
    seen.add(run.id);
  }
  return runs;
}

function sourceOf(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error('plan.source must look like github:owner/repo#12');
  scoped('plan.source', () => new SourceProviders().parse(value, 'source'));
  return value;
}

function peopleOf(value: unknown): ReplayPerson[] {
  if (value === undefined) return [];
  if (!isStrings(value)) throw new Error('plan.people must be a list of role:email strings, e.g. "reviewer:ada@example.com"');
  return scoped('plan.people', () => parsePeopleFlags(value, 'people'));
}

function metaOf(raw: Fields) {
  const { id, profile, createdAt } = raw;
  if (typeof id !== 'string') throw new Error('plan.id is required: lower-case letters, digits and hyphens');
  if (profile !== undefined && (typeof profile !== 'string' || !isProfileId(profile)))
    throw new Error('plan.profile must be a profile id (lower-case letters, digits and "-")');
  if (createdAt !== undefined && (typeof createdAt !== 'string' || !Number.isFinite(Date.parse(createdAt))))
    throw new Error('plan.createdAt must be an ISO date');
  return { id: scoped('plan.id', () => assertReplayId(id)), profile, createdAt };
}

/** A parsed and fully checked suite plan; throws one error naming the first problem and where it is. */
export function parsePlan(value: unknown): SuitePlan {
  const raw = fields(value, 'plan', SUITE_KEYS);
  const { id, profile, createdAt } = metaOf(raw);
  const planTitle = title(raw.title, 'plan.title');
  const source = sourceOf(raw.source);
  const people = peopleOf(raw.people);
  const summary = summaryOf(raw.summary, 'plan.summary');
  const runs = runsOf(raw.runs);
  const baseline = named(raw.baseline, 'plan.baseline', MAX_TARGET_LENGTH);
  if (baseline !== undefined && !runs.some((run) => run.target === baseline))
    throw new Error(`plan.baseline "${baseline}" must be the target of at least one run`);
  return {
    id,
    title: planTitle,
    ...(typeof profile === 'string' ? { profile } : {}),
    ...(source ? { source } : {}),
    people,
    ...(summary ? { summary } : {}),
    ...(baseline ? { baseline } : {}),
    ...(typeof createdAt === 'string' ? { createdAt } : {}),
    runs,
  };
}

export async function readPlan(file: string): Promise<SuitePlan> {
  let source: string;
  try {
    source = await readFile(resolve(file), 'utf8');
  } catch {
    throw new Error(`cannot read the plan file ${file}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error(`${file} is not valid JSON`);
  }
  return parsePlan(parsed);
}
