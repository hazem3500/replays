/**
 * Recorder-limited version 1 replay output schema. Keep browser types independent
 * of server-owned tracks and metadata: this recorder writes no performance,
 * context, suiteRun, retention, profile or people fields. The ingest endpoint
 * validates and enriches recordings for its audience. Compatibility is checked
 * against src/shared/replay.ts assertReplayBundle by the recorder bundle tests;
 * that runtime validator is never imported by the browser entry.
 */

export type ReplayConsoleLevel = 'debug' | 'info' | 'log' | 'warn' | 'error';

export type ReplayConsoleEntry = {
  /** Milliseconds from the first rrweb event. */
  at: number;
  level: ReplayConsoleLevel;
  message: string;
  url?: string;
};

export type ReplayNetworkEntry = {
  id: string;
  /** Milliseconds from the first rrweb event. */
  at: number;
  duration: number;
  method: string;
  url: string;
  status: number;
  statusText: string;
  mimeType?: string;
  requestHeaders: { name: string; value: string }[];
  responseHeaders: { name: string; value: string }[];
};

export type ReplayStep = {
  /** Milliseconds from the first rrweb event. */
  at: number;
  kind: string;
  label: string;
  selector?: string;
  url?: string;
};

export type ReplayRrwebEvent = Record<string, unknown> & {
  type: number;
  timestamp: number;
};

export type ReplayMeta = {
  /** `^[a-z0-9][a-z0-9-]{0,79}$`; the ingest endpoint may replace it. */
  id: string;
  title: string;
  url: string;
  capturedAt: string;
  duration: number;
  viewport: { width: number; height: number };
  eventCount: number;
  version: 1;
  /** End-user recordings are always `human`. */
  source: 'human';
  // No `profile` or `people`: the ingest endpoint sets the profile itself
  // (see the README), and `people` is staff only, never customers.
};

export type ReplayBundle = {
  meta: ReplayMeta;
  events: ReplayRrwebEvent[];
  console: ReplayConsoleEntry[];
  network: ReplayNetworkEntry[];
  steps: ReplayStep[];
};

/** The rrweb event types the recorder relies on (`@rrweb/types` EventType). */
export const RRWEB_EVENT = {
  FullSnapshot: 2,
  Incremental: 3,
  Meta: 4,
} as const;
