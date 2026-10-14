import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Distributed tracing (OpenTelemetry, OTLP), configured only by the standard `OTEL_*` environment variables
 * (docs/operations.md, "Tracing"). Without an OTLP endpoint (or `OTEL_TRACES_EXPORTER`) it is off, and then the
 * SDK is never loaded: every helper below is one `if` and a direct call, and storage is not wrapped at all.
 *
 * This module has no OpenTelemetry imports of its own. initTracing() loads `tracing-sdk.ts` (the SDK, the OTLP
 * exporter and the W3C propagator) on demand, so a deployment without tracing never pays for them.
 *
 * Privacy: spans only carry what the code sets explicitly here and at the call sites; there is no
 * auto-instrumentation. Allowed: route templates, methods, status codes, replay/suite/run ids, sizes, counts,
 * durations, enum values (source, media kind, storage driver), storage keys (`<id>/replay.json`).
 * Never: emails or other identities, replay contents (titles, URLs, events, console or network entries), query
 * strings, headers, cookies, tokens, error messages (only an `error.type`).
 */

export type AttributeValue = string | number | boolean;
export type Attributes = Record<string, AttributeValue | undefined>;

export interface SpanHandle {
  setAttributes(attributes: Attributes): void;
  /** Marks the span failed (`error.type` only, never the message) without ending it. */
  setError(error: unknown): void;
  /** Ends a span from startSpan(); `error` marks it failed (`error.type` only, never the message). */
  end(error?: unknown): void;
}

/** An opaque reference to the span that was active when it was captured (captureLink), for job spans. */
export type TraceLink = { readonly __traceLink: true };

export interface SpanOptions {
  /** Start a new trace (background jobs) instead of a child of the active span. */
  root?: boolean;
  /** Spans this one follows from, e.g. the request that queued a job. */
  links?: Array<TraceLink | undefined>;
  /** Start time, ms since the epoch (a queue wait recorded after the fact). */
  startTime?: number;
  kind?: 'internal' | 'client' | 'producer' | 'consumer';
}

/** What tracing-sdk.ts provides once loaded. */
export interface TracingImpl {
  readonly description: string;
  withSpan<T>(name: string, attributes: Attributes, fn: (span: SpanHandle) => T, options?: SpanOptions): T;
  startSpan(name: string, attributes: Attributes, options?: SpanOptions): SpanHandle;
  captureLink(): TraceLink | undefined;
  injectHeaders(): Record<string, string>;
  traceRequest(request: IncomingMessage, response: ServerResponse, route: HttpRoute, fn: () => Promise<void>): Promise<void>;
  setRequestAttributes(request: IncomingMessage, attributes: Attributes): void;
  recordError(error: unknown, status?: number): void;
  shutdown(): Promise<void>;
}

export const NOOP_SPAN: SpanHandle = Object.freeze({ setAttributes() {}, setError() {}, end() {} });

let impl: TracingImpl | undefined;

/**
 * Whether the environment asks for traces: an OTLP endpoint (`OTEL_EXPORTER_OTLP_ENDPOINT` or
 * `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`) or an explicit `OTEL_TRACES_EXPORTER` (`otlp`, or `console` to print
 * spans locally), unless `OTEL_SDK_DISABLED=true` or `OTEL_TRACES_EXPORTER=none`.
 */
export function tracingRequested(env: NodeJS.ProcessEnv) {
  if (env.OTEL_SDK_DISABLED?.trim().toLowerCase() === 'true') return false;
  const exporter = env.OTEL_TRACES_EXPORTER?.trim().toLowerCase();
  if (exporter === 'none') return false;
  return Boolean(exporter || env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim() || env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim());
}

export const tracingEnabled = () => impl !== undefined;

/**
 * Loads and starts the SDK when the environment asks for it; returns a line for the startup log, or
 * undefined when tracing stays off (nothing loaded). Call once, before the storage is created.
 */
export async function initTracing(env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  if (impl || !tracingRequested(env)) return impl?.description;
  const sdk = await import('./tracing-sdk.ts');
  impl = sdk.createTracing(env);
  return impl.description;
}

/** Installs an implementation directly (tests: an in-memory exporter); undefined switches tracing off. */
export function setTracingImpl(next: TracingImpl | undefined) {
  impl = next;
}

/** Flushes pending spans and stops the SDK (graceful shutdown). */
export async function shutdownTracing() {
  const current = impl;
  impl = undefined;
  await current?.shutdown();
}

/**
 * Runs `fn` inside a span named `name` (a low-cardinality name: ids go in attributes). Sync functions stay
 * sync; a returned promise ends the span when it settles, and a throw or rejection marks it failed.
 */
export function withSpan<T>(name: string, attributes: Attributes, fn: (span: SpanHandle) => T, options?: SpanOptions): T {
  return impl ? impl.withSpan(name, attributes, fn, options) : fn(NOOP_SPAN);
}

/** A span ended by hand (one that does not wrap a single call, e.g. a child process's lifetime). */
export function startSpan(name: string, attributes: Attributes, options?: SpanOptions): SpanHandle {
  return impl ? impl.startSpan(name, attributes, options) : NOOP_SPAN;
}

/** The active span, to link a background job's own trace back to the request that queued it. */
export function captureLink(): TraceLink | undefined {
  return impl?.captureLink();
}

/**
 * W3C `traceparent` (and `tracestate`) for the active span, for loopback requests the server makes to itself
 * (the render page Chromium loads), so they join the job's trace; empty when tracing is off.
 */
export function traceHeaders(): Record<string, string> {
  return impl ? impl.injectHeaders() : {};
}

/**
 * Runs the request handler `fn` inside a server span named `<METHOD> <route template>`, continuing the caller's
 * trace from its W3C `traceparent`. The span ends when the response is finished or closed (streams included).
 */
export function traceRequest(request: IncomingMessage, response: ServerResponse, path: string, fn: () => Promise<void>) {
  return impl ? impl.traceRequest(request, response, httpRoute(path), fn) : fn();
}

/** Adds attributes to the request's server span (upload size, replay id…). */
export function setRequestAttributes(request: IncomingMessage, attributes: Attributes) {
  impl?.setRequestAttributes(request, attributes);
}

/** Marks the active span failed with `error.type` (the error's code or class, never its message). */
export function recordError(error: unknown, status?: number) {
  impl?.recordError(error, status);
}

/** `error.type` for an error: its `code` (ENOENT, ERR_…) or class name; never the message, which may hold data. */
export function errorType(error: unknown) {
  const code = (error as { code?: unknown } | undefined)?.code;
  if (typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(code)) return code;
  return error instanceof Error ? error.constructor.name || 'Error' : 'unknown';
}

export interface HttpRoute {
  /** `/api/replays/:id`, relative to the app's base; never a raw path or query. */
  route: string;
  replayId?: string;
  suiteId?: string;
  runId?: string;
}

const ID = '([a-z0-9][a-z0-9-]{0,79})';
const RUN = '([a-zA-Z0-9][a-zA-Z0-9-]{0,79})';
const ROUTES: Array<[RegExp, string, Array<'replayId' | 'suiteId' | 'runId'>]> = [
  [/^\/api\/replays\/import$/, '/api/replays/import', []],
  [new RegExp(`^/api/replays/${ID}$`), '/api/replays/:id', ['replayId']],
  [new RegExp(`^/api/replays/${ID}/(video|render|render/file|keep|poster|open|preview)$`), '/api/replays/:id/$', ['replayId']],
  [new RegExp(`^/api/suites/${ID}$`), '/api/suites/:id', ['suiteId']],
  [new RegExp(`^/api/suites/${ID}/keep$`), '/api/suites/:id/keep', ['suiteId']],
  [new RegExp(`^/api/suites/${ID}/runs/${RUN}$`), '/api/suites/:id/runs/:runId', ['suiteId', 'runId']],
  [/^\/api\/(me|replays|suites)$/, '/api/$', []],
  [/^\/api(\/.*)?$/, '/api/*', []],
  [/^\/assets\/[^/]+$/, '/assets/:file', []],
  [/^\/r\/[^/]+\/?$/, '/r/:id', []],
  [/^\/s\/[^/]+\/r\/[^/]+\/?$/, '/s/:suite/r/:id', []],
  [/^\/s\/[^/]+\/?$/, '/s/:suite', []],
  [/^\/$/, '/', []],
];

/**
 * The route template for an app path (`/api/…`, `/r/…` or `/internal/render/…`, after base-path mapping), used
 * as the span name and `http.route`: ids become `:id` (and go to attributes), unknown paths a wildcard, so span
 * names stay low-cardinality and never carry free text.
 */
export function httpRoute(path: string): HttpRoute {
  if (path.startsWith('/internal/render/')) {
    const rest = path.slice('/internal/render'.length);
    if (/^\/assets\/[\w.-]+$/.test(rest)) return { route: '/internal/render/assets/:file' };
    const bundle = new RegExp(`^/${ID}(/bundle\\.json)?$`).exec(rest);
    if (bundle) return { route: `/internal/render/:id${bundle[2] ?? ''}`, replayId: bundle[1]! };
    return { route: '/internal/render/*' };
  }
  const rest = path || '/';
  for (const [pattern, template, names] of ROUTES) {
    const match = pattern.exec(rest);
    if (!match) continue;
    const result: HttpRoute = { route: template.replace('$', match[names.length + 1] ?? '') };
    names.forEach((name, index) => {
      result[name] = match[index + 1]!;
    });
    return result;
  }
  return { route: '/*' };
}
