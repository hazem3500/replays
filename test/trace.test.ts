import { describe, expect, it } from 'vitest';
import { sanitizeReplayBundle } from '../src/capture/sanitize.ts';
import * as recorder from '../src/recorder/trace.ts';
import { filterHeaders, DEFAULT_ALLOWED_HEADERS } from '../src/recorder/redact.ts';
import { normalizeTraceId, traceIdFromHeaders, traceOnlyServerTiming, traceUrl } from '../src/shared/trace.ts';
import { validateBranding } from '../src/server/branding.ts';
import { loadSettings } from '../src/server/config.ts';
import type { ReplayBundle } from '../src/shared/replay.ts';
import { replay } from './fixtures.ts';

const ID = '4bf92f3577b34da6a3ce929d0e0e4736';
const TRACEPARENT = `00-${ID}-00f067aa0ba902b7-01`;

describe('trace IDs', () => {
  it('reads the trace ID from a traceparent or a bare ID, lower-cased', () => {
    expect(normalizeTraceId(TRACEPARENT)).toBe(ID);
    expect(normalizeTraceId(` ${ID.toUpperCase()} `)).toBe(ID);
  });

  it('refuses malformed and all-zero IDs', () => {
    for (const bad of ['', 'abc', `00-${'0'.repeat(32)}-00f067aa0ba902b7-01`, `${ID}zz`, 'Bearer secret'])
      expect(normalizeTraceId(bad)).toBeUndefined();
  });

  it('prefers the response ID over the request traceparent', () => {
    const other = 'a'.repeat(32);
    expect(traceIdFromHeaders([{ name: 'traceparent', value: TRACEPARENT }], [{ name: 'X-Trace-ID', value: other }])).toBe(other);
    expect(traceIdFromHeaders([{ name: 'traceparent', value: TRACEPARENT }], [])).toBe(ID);
  });

  it('finds the ID in a Server-Timing trace metric', () => {
    expect(traceIdFromHeaders([], [{ name: 'server-timing', value: `db;dur=3, traceparent;desc="${TRACEPARENT}"` }])).toBe(ID);
  });

  it('keeps only trace metrics of Server-Timing', () => {
    expect(traceOnlyServerTiming(`db;dur=3;desc="users"`)).toBeUndefined();
    expect(traceOnlyServerTiming(`db;dur=3, traceparent;desc="${TRACEPARENT}"`)).toBe(`traceparent;desc="${TRACEPARENT}"`);
  });

  it('fills the template and returns nothing without both parts', () => {
    expect(traceUrl('https://g.example/t?q={traceId}', ID)).toBe(`https://g.example/t?q=${ID}`);
    const missing = normalizeTraceId('');
    expect(traceUrl(missing, ID)).toBeUndefined();
    expect(traceUrl('https://g.example/{traceId}', missing)).toBeUndefined();
  });
});

describe('recorder header allow-list', () => {
  it('keeps trace headers and drops credentials next to them', () => {
    const kept = filterHeaders(
      [
        ['Traceparent', TRACEPARENT],
        ['X-Trace-ID', ID],
        ['X-Request-ID', 'req-1'],
        ['Server-Timing', `db;dur=3, traceparent;desc="${TRACEPARENT}"`],
        ['Authorization', 'Bearer secret'],
        ['X-Auth-Token', 'secret'],
      ],
      DEFAULT_ALLOWED_HEADERS,
    );
    expect(kept).toEqual([
      { name: 'traceparent', value: TRACEPARENT },
      { name: 'x-trace-id', value: ID },
      { name: 'x-request-id', value: 'req-1' },
      { name: 'server-timing', value: `traceparent;desc="${TRACEPARENT}"` },
    ]);
  });

  it('drops a Server-Timing header with no trace metric', () => {
    expect(filterHeaders([['Server-Timing', 'db;dur=3']], DEFAULT_ALLOWED_HEADERS)).toEqual([]);
  });
});

function withNetwork(network: ReplayBundle['network']): ReplayBundle {
  return { ...replay('trace'), network };
}

const entry = (extra: Partial<ReplayBundle['network'][number]>): ReplayBundle['network'][number] => ({
  id: 'request-1',
  at: 0,
  duration: 1,
  method: 'GET',
  url: 'https://api.example.com/x',
  status: 200,
  statusText: 'OK',
  requestHeaders: [
    { name: 'traceparent', value: TRACEPARENT },
    { name: 'authorization', value: 'Bearer secret' },
  ],
  responseHeaders: [{ name: 'server-timing', value: `db;dur=3;desc="users", traceparent;desc="${TRACEPARENT}"` }],
  ...extra,
});

describe('sanitizer and trace IDs', () => {
  it('keeps trace headers, derives the trace ID and trims Server-Timing', () => {
    const [clean] = sanitizeReplayBundle(withNetwork([entry({})])).network;
    expect(clean?.traceId).toBe(ID);
    expect(clean?.requestHeaders).toEqual([{ name: 'traceparent', value: TRACEPARENT }]);
    expect(clean?.responseHeaders).toEqual([{ name: 'server-timing', value: `traceparent;desc="${TRACEPARENT}"` }]);
  });

  it('replaces a malformed stored trace ID with nothing and stays idempotent', () => {
    const first = sanitizeReplayBundle(withNetwork([entry({ traceId: 'not-an-id', requestHeaders: [], responseHeaders: [] })]));
    expect(first.network[0]).not.toHaveProperty('traceId');
    const withId = sanitizeReplayBundle(withNetwork([entry({})]));
    expect(sanitizeReplayBundle(structuredClone(withId))).toEqual(withId);
  });
});

describe('trace link configuration', () => {
  it('accepts an https template with the placeholder', () => {
    expect(validateBranding({ integrations: { traceUrlTemplate: ' https://g.example/?q={traceId} ' } }).integrations).toEqual({
      traceUrlTemplate: 'https://g.example/?q={traceId}',
    });
  });

  it('refuses a template that is not https or lacks the placeholder', () => {
    for (const bad of ['http://g.example/{traceId}', 'https://g.example/', 'javascript:{traceId}'])
      expect(() => validateBranding({ integrations: { traceUrlTemplate: bad } })).toThrow(
        'TRACE_URL_TEMPLATE must be an https URL containing {traceId}',
      );
  });

  it('reads the template from the environment over the config file', async () => {
    const settings = await loadSettings(
      { TRACE_URL_TEMPLATE: 'https://env.example/{traceId}' },
      { integrations: { traceUrlTemplate: 'https://file.example/{traceId}' } },
    );
    expect(settings.branding.integrations?.traceUrlTemplate).toBe('https://env.example/{traceId}');
  });
});

describe('recorder port', () => {
  const timing = [`db;dur=3, traceparent;desc="${TRACEPARENT}"`, 'db;dur=3', `traceid;desc=${ID}`, ''];
  const headers = [
    [[{ name: 'traceparent', value: TRACEPARENT }], [{ name: 'x-trace-id', value: 'b'.repeat(32) }]],
    [[], [{ name: 'server-timing', value: timing[0] ?? '' }]],
    [[{ name: 'traceparent', value: `00-${'0'.repeat(32)}-00f067aa0ba902b7-01` }], []],
    [[], []],
  ] as const;

  it('reads the same trace ID from the same headers', () => {
    for (const [request, response] of headers)
      expect(recorder.traceIdFromHeaders(request, response)).toBe(traceIdFromHeaders(request, response));
  });

  it('trims Server-Timing the same way', () => {
    for (const value of timing) expect(recorder.traceOnlyServerTiming(value)).toBe(traceOnlyServerTiming(value));
  });

  it('normalizes IDs the same way', () => {
    for (const value of [TRACEPARENT, ID.toUpperCase(), 'nope', '']) expect(recorder.normalizeTraceId(value)).toBe(normalizeTraceId(value));
  });
});
