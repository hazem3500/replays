import { z } from 'zod';

import type { ReplayPersonSummary } from '../people.ts';
import type { ReplayFilters, ReplaySourceLink, ReplaySummary, ReplayTimelineSummary, SummaryFieldValue } from '../replay.ts';
import type { ReviewSuiteIndexEntry, ReviewSuiteIndexRun } from '../review-suite.ts';
import { keepRecordSchema } from './retention.ts';

/** A plugin index filter's query parameter (`api.indexFilter`): the server's rule. */
export const pluginFilterParam = /^x-[a-z0-9][a-z0-9-]{0,38}$/;

/** A URL value that does not fit is dropped, never an error. */
const absent = (): undefined => {};

const exactString = () => z.string().exactOptional();
const summaryField = z.union([z.string(), z.number(), z.boolean(), z.null()]) satisfies z.ZodType<SummaryFieldValue>;

/**
 * `GET /api/replays`: one row of the index. Loose, so fields the server adds per request (For me's `reason`, plugin
 * fields) reach the page; nested display-only parts are typed, not re-checked.
 */
export const replaySummarySchema = z.looseObject({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  host: z.string(),
  capturedAt: z.string(),
  duration: z.number(),
  steps: z.number(),
  consoleErrors: z.number(),
  failedRequests: z.number(),
  source: z.enum(['agent', 'human']),
  summaryVersion: z.number().exactOptional(),
  viewport: z.object({ width: z.number(), height: z.number() }).exactOptional(),
  timeline: z.custom<ReplayTimelineSummary>().exactOptional(),
  tags: z.array(z.string()).exactOptional(),
  sources: z.array(z.custom<ReplaySourceLink>()).exactOptional(),
  suiteRun: z.object({ suiteId: z.string(), runId: z.string() }).exactOptional(),
  purpose: exactString(),
  purposeInferred: z.boolean().exactOptional(),
  ext: z.record(z.string(), z.record(z.string(), summaryField)).exactOptional(),
  extVersion: exactString(),
  people: z.array(z.custom<ReplayPersonSummary>()).exactOptional(),
  kept: keepRecordSchema.exactOptional(),
  expiresAt: z.string().nullable().exactOptional(),
}) satisfies z.ZodType<ReplaySummary>;

export const replaySummaryListSchema = z.array(replaySummarySchema);

/** `GET /api/suites?expand=runs`: a suite of the index with its runs (loose, runs typed, not re-checked). */
export const suiteIndexEntrySchema = z.looseObject({
  id: z.string(),
  title: z.string(),
  createdAt: z.string(),
  subject: z.custom<NonNullable<ReviewSuiteIndexEntry['subject']>>().exactOptional(),
  people: z.array(z.custom<ReplayPersonSummary>()).exactOptional(),
  kept: keepRecordSchema.exactOptional(),
  runs: z.number(),
  running: z.number(),
  failed: z.number(),
  partial: z.number(),
  missingRecordings: z.number(),
  duration: z.number(),
  expiresAt: z.string().nullable().exactOptional(),
  runDetails: z.array(z.custom<ReviewSuiteIndexRun>()),
}) satisfies z.ZodType<ReviewSuiteIndexEntry>;

export const suiteIndexListSchema = z.array(suiteIndexEntrySchema);

/**
 * The index filters as the URL carries them (strings in, typed out). A bad value is dropped, never an error; `x-*`
 * plugin params pass through (loose) and are gathered into `params` by `pluginParams`.
 */
export const replayFiltersSchema = z.looseObject({
  q: z.string().trim().min(1).optional().catch(absent),
  host: z.string().min(1).optional().catch(absent),
  errors: z
    .union([z.literal('1'), z.literal(true)])
    .transform(() => true as const)
    .optional()
    .catch(absent),
  source: z.enum(['agent', 'human']).optional().catch(absent),
  tag: z.string().min(1).optional().catch(absent),
  purpose: z.string().min(1).optional().catch(absent),
});

/** Plugin params out of a parsed search (`x-*` keys with a non-empty value, trimmed and capped like the server). */
export function pluginParams(search: Readonly<Record<string, unknown>>): ReplayFilters['params'] {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(search))
    if (pluginFilterParam.test(key) && typeof value === 'string' && value.trim()) params[key] = value.trim().slice(0, 200);
  return Object.keys(params).length ? params : undefined;
}
