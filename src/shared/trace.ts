/** Opaque distributed-trace identifiers carried by network headers; never credentials. */

/** Headers a capture keeps so a request can be linked to a backend trace. */
export const TRACE_HEADERS: readonly string[] = ['traceparent', 'x-trace-id', 'server-timing'];

const TRACEPARENT = /^[\da-f]{2}-([\da-f]{32})-[\da-f]{16}-[\da-f]{2}$/i;
const TRACE_ID = /^[\da-f]{32}$/i;
const ZERO_TRACE = /^0{32}$/;
const TIMING_TRACE_NAME = /^(traceparent|trace-?id)$/i;

type Header = { name: string; value: string };

/** The 32-hex trace ID in a W3C `traceparent` or a bare ID, lower-cased; undefined for anything else (including the all-zero ID). */
export function normalizeTraceId(value: string | undefined): string | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  const id = TRACEPARENT.exec(text)?.[1] ?? (TRACE_ID.test(text) ? text : undefined);
  return id && !ZERO_TRACE.test(id) ? id.toLowerCase() : undefined;
}

/**
 * Keeps only the trace metrics of a `Server-Timing` value (`traceparent;desc="00-…"`, `traceid;desc=…`) and drops the
 * rest, since timing metrics can name internals. Undefined when nothing trace-related is left.
 */
export function traceOnlyServerTiming(value: string): string | undefined {
  const kept = value.split(',').filter((metric) => TIMING_TRACE_NAME.test(metric.split(';')[0]?.trim() ?? ''));
  return kept.length ? kept.map((metric) => metric.trim()).join(', ') : undefined;
}

function timingTrace(value: string): string | undefined {
  for (const metric of value.split(',')) {
    const [name, ...params] = metric.split(';');
    if (!TIMING_TRACE_NAME.test(name?.trim() ?? '')) continue;
    for (const param of params) {
      const [key, ...rest] = param.split('=');
      if (key?.trim().toLowerCase() !== 'desc') continue;
      const id = normalizeTraceId(rest.join('=').trim().replace(/^"|"$/g, ''));
      if (id) return id;
    }
  }
  return undefined;
}

const find = (headers: readonly Header[] | undefined, name: string) => headers?.find((header) => header.name.toLowerCase() === name)?.value;

/** The request's backend trace: the response's own ID wins over the one the browser proposed in the request `traceparent`. */
export function traceIdFromHeaders(requestHeaders: readonly Header[] | undefined, responseHeaders: readonly Header[] | undefined) {
  return (
    normalizeTraceId(find(responseHeaders, 'x-trace-id')) ??
    normalizeTraceId(find(responseHeaders, 'traceparent')) ??
    timingTrace(find(responseHeaders, 'server-timing') ?? '') ??
    normalizeTraceId(find(requestHeaders, 'traceparent'))
  );
}

/** The deployment's trace link for an ID: `{traceId}` is replaced; undefined without a template or an ID. */
export function traceUrl(template: string | undefined, traceId: string | undefined): string | undefined {
  if (!template || !traceId) return undefined;
  return template.replaceAll('{traceId}', encodeURIComponent(traceId));
}
