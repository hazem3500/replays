import * as z from 'zod/mini';

import type { ReplayPerfSummary } from '../frame-timing.ts';
import type { ReplayPersonSummary } from '../people.ts';
import type { ReplaySourceLink, ReplaySummary, ReplayTimelineSummary, SummaryFieldValue } from '../replay.ts';
import type { ReviewSuiteIndexEntry, ReviewSuiteIndexRun } from '../review-suite.ts';
import { keepRecordSchema } from './retention.ts';

const exactString = () => z.exactOptional(z.string());
const summaryField = z.union([z.string(), z.number(), z.boolean(), z.null()]) satisfies z.ZodMiniType<SummaryFieldValue>;

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
  summaryVersion: z.exactOptional(z.number()),
  viewport: z.exactOptional(z.object({ width: z.number(), height: z.number() })),
  timeline: z.exactOptional(z.custom<ReplayTimelineSummary>()),
  perf: z.exactOptional(z.custom<ReplayPerfSummary>()),
  tags: z.exactOptional(z.array(z.string())),
  sources: z.exactOptional(z.array(z.custom<ReplaySourceLink>())),
  suiteRun: z.exactOptional(z.object({ suiteId: z.string(), runId: z.string() })),
  purpose: exactString(),
  purposeInferred: z.exactOptional(z.boolean()),
  ext: z.exactOptional(z.record(z.string(), z.record(z.string(), summaryField))),
  extVersion: exactString(),
  people: z.exactOptional(z.array(z.custom<ReplayPersonSummary>())),
  kept: z.exactOptional(keepRecordSchema),
  expiresAt: z.exactOptional(z.nullable(z.string())),
}) satisfies z.ZodMiniType<ReplaySummary>;

export const replaySummaryListSchema = z.array(replaySummarySchema);

/** `GET /api/suites?expand=runs`: a suite of the index with its runs (loose, runs typed, not re-checked). */
export const suiteIndexEntrySchema = z.looseObject({
  id: z.string(),
  title: z.string(),
  createdAt: z.string(),
  subject: z.exactOptional(z.custom<NonNullable<ReviewSuiteIndexEntry['subject']>>()),
  people: z.exactOptional(z.array(z.custom<ReplayPersonSummary>())),
  kept: z.exactOptional(keepRecordSchema),
  runs: z.number(),
  running: z.number(),
  failed: z.number(),
  partial: z.number(),
  missingRecordings: z.number(),
  duration: z.number(),
  expiresAt: z.exactOptional(z.nullable(z.string())),
  runDetails: z.array(z.custom<ReviewSuiteIndexRun>()),
}) satisfies z.ZodMiniType<ReviewSuiteIndexEntry>;

export const suiteIndexListSchema = z.array(suiteIndexEntrySchema);
