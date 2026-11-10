import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { assertCaptureUrl, validateSteps } from '../capture/capture-steps.ts';
import type { RawStep } from '../capture/drivers/types.ts';
import { parsePeopleFlags, type ReplayPerson } from '../shared/people.ts';
import { isProfileId } from '../shared/profiles.ts';
import { assertReplayId } from '../shared/replay.ts';
import { assertSummary } from '../shared/review-suite.ts';
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
}

export interface SuitePlan {
  id: string;
  title: string;
  profile?: string;
  /** `github:owner/repo#12`; the server turns it into the suite's link. */
  source?: string;
  people: ReplayPerson[];
  summary?: string;
  /** Fixed for a plan that is run again, so the server sees the same suite identity. */
  createdAt?: string;
  runs: SuitePlanRun[];
}

const SUITE_KEYS = ['$schema', 'id', 'title', 'profile', 'source', 'people', 'summary', 'createdAt', 'runs'];
const RUN_KEYS = ['id', 'title', 'url', 'steps', 'viewport', 'expect', 'summary'];
const EXPECT_KEYS = ['noConsoleErrors', 'noFailedRequests', 'maxDurationMs'];

function fields(value: unknown, where: string, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${where} must be an object`);
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new Error(`${where} has unsupported field ${unknown[0]} (allowed: ${allowed.join(', ')})`);
  return value as Record<string, unknown>;
}

function text(value: unknown, where: string, options: { required?: boolean } = {}): string | undefined {
  if (value === undefined && !options.required) return undefined;
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

export function parseViewport(value: unknown, where: string): { width: number; height: number } {
  if (typeof value === 'string') {
    const match = /^(\d{3,5})x(\d{3,5})$/.exec(value);
    if (!match) throw new Error(`${where} must look like 1440x900`);
    return { width: Number(match[1]), height: Number(match[2]) };
  }
  const size = fields(value, where, ['width', 'height']);
  const { width, height } = size;
  if (![width, height].every((side) => Number.isSafeInteger(side) && Number(side) >= 100 && Number(side) <= 99_999))
    throw new Error(`${where} needs integer width and height, or a string like 1440x900`);
  return { width: width as number, height: height as number };
}

function expectations(value: unknown, where: string): RunExpectations | undefined {
  if (value === undefined) return undefined;
  const raw = fields(value, where, EXPECT_KEYS);
  for (const key of ['noConsoleErrors', 'noFailedRequests'])
    if (raw[key] !== undefined && typeof raw[key] !== 'boolean') throw new Error(`${where}.${key} must be true or false`);
  const max = raw.maxDurationMs;
  if (max !== undefined && (typeof max !== 'number' || !Number.isFinite(max) || max <= 0))
    throw new Error(`${where}.maxDurationMs must be a positive number`);
  return {
    ...(raw.noConsoleErrors === undefined ? {} : { noConsoleErrors: raw.noConsoleErrors as boolean }),
    ...(raw.noFailedRequests === undefined ? {} : { noFailedRequests: raw.noFailedRequests as boolean }),
    ...(max === undefined ? {} : { maxDurationMs: max }),
  };
}

function runOf(value: unknown, index: number): SuitePlanRun {
  const where = `runs[${index}]`;
  const raw = fields(value, where, RUN_KEYS);
  if (typeof raw.id !== 'string' || !RUN_ID_PATTERN.test(raw.id))
    throw new Error(`${where}.id must be letters, digits and hyphens (at most 80, starting with a letter or digit)`);
  const title = text(raw.title, `${where}.title`, { required: true })!;
  if (typeof raw.url !== 'string') throw new Error(`${where}.url must be an https URL (http only for localhost)`);
  const url = raw.url;
  scoped(`${where}.url`, () => assertCaptureUrl(url, 'url'));
  if (raw.steps === undefined) throw new Error(`${where}.steps is required (use [] to just open the page)`);
  const steps = scoped(`${where}.steps`, () => validateSteps(raw.steps));
  const expect = expectations(raw.expect, `${where}.expect`);
  if (raw.summary !== undefined) scoped(`${where}.summary`, () => assertSummary(raw.summary, 'summary'));
  return {
    id: raw.id,
    title,
    url,
    steps,
    viewport: raw.viewport === undefined ? DEFAULT_VIEWPORT : parseViewport(raw.viewport, `${where}.viewport`),
    ...(expect ? { expect } : {}),
    ...(typeof raw.summary === 'string' ? { summary: raw.summary } : {}),
  };
}

/** A parsed and fully checked suite plan; throws one error naming the first problem and where it is. */
export function parsePlan(value: unknown): SuitePlan {
  const raw = fields(value, 'plan', SUITE_KEYS);
  if (typeof raw.id !== 'string') throw new Error('plan.id is required: lower-case letters, digits and hyphens');
  const id = scoped('plan.id', () => assertReplayId(raw.id as string));
  const title = text(raw.title, 'plan.title', { required: true })!;
  if (raw.profile !== undefined && (typeof raw.profile !== 'string' || !isProfileId(raw.profile)))
    throw new Error('plan.profile must be a profile id (lower-case letters, digits and "-")');
  let source: string | undefined;
  if (raw.source !== undefined) {
    if (typeof raw.source !== 'string') throw new Error('plan.source must look like github:owner/repo#12');
    const spec = raw.source;
    scoped('plan.source', () => new SourceProviders().parse(spec, 'source'));
    source = spec;
  }
  let people: ReplayPerson[] = [];
  if (raw.people !== undefined) {
    if (!Array.isArray(raw.people) || raw.people.some((entry) => typeof entry !== 'string'))
      throw new Error('plan.people must be a list of role:email strings, e.g. "reviewer:ada@example.com"');
    const specs = raw.people as string[];
    people = scoped('plan.people', () => parsePeopleFlags(specs, 'people'));
  }
  if (raw.summary !== undefined) scoped('plan.summary', () => assertSummary(raw.summary, 'summary'));
  if (raw.createdAt !== undefined && (typeof raw.createdAt !== 'string' || !Number.isFinite(Date.parse(raw.createdAt))))
    throw new Error('plan.createdAt must be an ISO date');
  if (!Array.isArray(raw.runs) || raw.runs.length === 0) throw new Error('plan.runs must list at least one run');
  if (raw.runs.length > MAX_PLAN_RUNS) throw new Error(`plan.runs can hold at most ${MAX_PLAN_RUNS} runs`);
  const runs = raw.runs.map((entry: unknown, index: number) => runOf(entry, index));
  const seen = new Set<string>();
  for (const run of runs) {
    if (seen.has(run.id)) throw new Error(`plan.runs has the run id ${run.id} twice`);
    seen.add(run.id);
  }
  return {
    id,
    title,
    ...(typeof raw.profile === 'string' ? { profile: raw.profile } : {}),
    ...(source ? { source } : {}),
    people,
    ...(typeof raw.summary === 'string' ? { summary: raw.summary } : {}),
    ...(typeof raw.createdAt === 'string' ? { createdAt: raw.createdAt } : {}),
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
