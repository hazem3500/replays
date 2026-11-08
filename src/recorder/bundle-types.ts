/**
 * Recorder-limited version 1 replay output schema. Keep browser types independent
 * of server-owned metadata: optional context and numeric performance tracks use
 * shared type-only contracts. It writes no suiteRun, retention or people fields, and `profile` only from the
 * host's options step. The ingest endpoint
 * validates and enriches recordings for its audience. Compatibility is checked
 * against src/shared/replay.ts assertReplayBundle by the recorder bundle tests;
 * that runtime validator is never imported by the browser entry.
 */

import type { ReplayContext } from '../shared/context.ts';
import type { ReplayPerformanceTrack } from '../shared/replay.ts';

export type ReplayConsoleLevel = 'debug' | 'info' | 'log' | 'warn' | 'error';

export type ReplayConsoleEntry = {
  /** Milliseconds from the first rrweb event. */
  at: number;
  level: ReplayConsoleLevel;
  message: string;
  url?: string;
};

/**
 * A request or response body, already redacted in the browser (secret fields,
 * credentials, JWTs, card numbers, e-mail addresses while text is masked). The
 * ingest endpoint redacts it again with the deployment's own rules. `text` is
 * absent when the body was left out; `omitted` says why.
 */
export type ReplayNetworkBody = {
  text?: string;
  /** Bytes of the original body, when known. */
  size?: number;
  /** `text` stops at the byte cap; the original was longer. */
  truncated?: true;
  omitted?: 'content-type' | 'unavailable';
};

/** What the recording kept, so the viewer can say "Not captured". */
export type ReplayCaptured = {
  console: boolean;
  network: 'off' | 'headers' | 'bodies';
  performance: boolean;
  video: boolean;
  /** `visible` only when `privacy.sanitize` was false; the ingest endpoint decides whether it keeps the values. */
  inputs?: 'visible';
  /**
   * A customer's pick in the options step (`choices.by: 'customer'`): whether that mode shows typed values and page
   * text, and whether they asked for request and response content. The ingest endpoint keeps what it allows.
   */
  choice?: {
    by: 'customer';
    /** The picked mode, so the server knows which text rules applied. */
    mode: 'masked' | 'interface-visible' | 'text-masked' | 'visible';
    inputs: 'masked' | 'visible';
    text: 'masked' | 'visible';
    bodies: boolean;
  };
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
  /** Only with `capture.network: 'bodies'`, and only for requests that sent one. */
  requestBody?: ReplayNetworkBody;
  /** Only with `capture.network: 'bodies'`. */
  responseBody?: ReplayNetworkBody;
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
  captured?: ReplayCaptured;
  /** Only when the host offers profiles in its options step; the ingest endpoint checks it and may infer one otherwise. */
  profile?: string;
  /* why: no `people`: it is staff only, never customers. */
};

export type ReplayBundle = {
  meta: ReplayMeta;
  events: ReplayRrwebEvent[];
  console: ReplayConsoleEntry[];
  network: ReplayNetworkEntry[];
  steps: ReplayStep[];
  context?: ReplayContext;
  performance?: ReplayPerformanceTrack;
};

/** The rrweb event types the recorder relies on (`@rrweb/types` EventType). */
export const RRWEB_EVENT = {
  FullSnapshot: 2,
  Incremental: 3,
  Meta: 4,
} as const;
