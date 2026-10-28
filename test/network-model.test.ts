import { describe, expect, it } from 'vitest';

import { editTimeline } from '../src/shared/edits.ts';
import {
  buildNetworkRows,
  curlCommand,
  durationShare,
  filterRows,
  matchRequest,
  neighbours,
  networkBadge,
  NO_FILTER,
  requestType,
  startDensity,
  statusCounts,
  stepAt,
} from '../src/client/viewer/network/model.ts';
import { must } from './must.ts';
import { request, waterfallEdits, waterfallFixture } from './waterfall-fixture.ts';

function busy() {
  const bundle = waterfallFixture();
  bundle.meta.url = 'https://example.com/app';
  bundle.network = [
    request({ id: 'doc', at: 0, duration: 40, url: 'https://example.com/app', mimeType: 'text/html; charset=utf-8' }),
    request({ id: 'img', at: 100, duration: 30, url: 'https://cdn.test/a.webp?w=480' }),
    request({
      id: 'slow',
      at: 1200,
      duration: 2400,
      url: 'https://example.com/api/recommendations?for=home',
      mimeType: 'application/json',
    }),
    request({ id: 'coupon', at: 5700, duration: 140, method: 'POST', url: 'https://example.com/api/coupons/SPRING10', status: 422 }),
    request({ id: 'blocked', at: 6000, duration: 0, url: 'https://maps.test/tiles', status: 0, statusText: 'net::ERR_BLOCKED_BY_CLIENT' }),
    request({ id: 'hop', at: 7000, duration: 12, url: 'https://example.com/redirect', status: 0, statusText: '' }),
  ];
  return bundle;
}

describe('network rows', () => {
  it('types a request by its MIME type before its extension', () => {
    expect(requestType({ url: 'https://x.test/data.json', mimeType: 'text/html' })).toBe('document');
    expect(requestType({ url: 'https://x.test/app.js?v=2' })).toBe('script');
    expect(requestType({ url: 'https://x.test/fonts/inter.woff2' })).toBe('font');
    expect(requestType({ url: 'https://x.test/api/cart', mimeType: 'application/json' })).toBe('fetch');
    expect(requestType({ url: 'https://x.test/telemetry' })).toBe('other');
  });

  it('flags failures, missing responses and slow requests apart from each other', () => {
    const rows = Object.fromEntries(buildNetworkRows(busy()).map((row) => [row.id, row]));
    expect(rows.coupon).toMatchObject({ failed: true, pending: false, slow: false });
    expect(rows.hop).toMatchObject({ failed: false, pending: true, measured: undefined });
    expect(rows.slow).toMatchObject({ failed: false, slow: true, measured: 2400 });
  });

  it('treats the 0 ms of a network error as no measurement', () => {
    const blocked = buildNetworkRows(busy()).find((row) => row.id === 'blocked');
    expect(blocked).toMatchObject({ failed: true, measured: undefined });
  });

  it('names another host but not the replay’s own', () => {
    const rows = Object.fromEntries(buildNetworkRows(busy()).map((row) => [row.id, row.name]));
    expect(rows.slow).toEqual({ path: '/api/recommendations', query: '?for=home' });
    expect(rows.img).toEqual({ host: 'cdn.test', path: '/a.webp', query: '?w=480' });
  });

  it('places requests on the edited clock and leaves out the ones inside a cut', () => {
    const bundle = busy();
    bundle.network = [request({ id: 'kept', at: 5000, duration: 100 }), request({ id: 'cut', at: 3200, duration: 100 })];
    const rows = buildNetworkRows(bundle, editTimeline(waterfallEdits, 10000));
    expect(rows.map((row) => row.id)).toEqual(['kept']);
    expect(rows[0]?.at).toBe(2500);
  });
});

const filtered = (filter: Partial<typeof NO_FILTER>) =>
  filterRows(buildNetworkRows(busy()), { ...NO_FILTER, ...filter }).map((row) => row.id);

describe('network filters', () => {
  const rows = buildNetworkRows(busy());

  it('counts each status filter', () => {
    expect(statusCounts(rows)).toEqual({ all: 6, failed: 2, slow: 1, pending: 1 });
  });

  it('combines status, type, words and a time range', () => {
    expect(filtered({ status: 'failed' })).toEqual(['coupon', 'blocked']);
    expect(filtered({ type: 'document' })).toEqual(['doc']);
    expect(filtered({ text: 'post 422' })).toEqual(['coupon']);
    expect(filtered({ range: { from: 5600, to: 5800 } })).toEqual(['coupon']);
  });

  it('keeps a request whose span reaches into the range though it started before', () => {
    expect(filterRows(rows, { ...NO_FILTER, range: { from: 3000, to: 3500 } }).map((row) => row.id)).toEqual(['slow']);
  });
});

describe('network scales', () => {
  it('keeps a 6 ms and a 2.4 s request apart on the log scale, slower always longer', () => {
    const fast = durationShare(6, 2400);
    const slow = durationShare(2400, 2400);
    expect(slow).toBe(1);
    expect(fast).toBeGreaterThan(0.2);
    expect(fast).toBeLessThan(durationShare(60, 2400));
  });

  it('draws no bar for an unknown duration', () => {
    expect(durationShare(undefined, 1000)).toBe(0);
  });

  it('bins request starts over the recording', () => {
    expect(startDensity(buildNetworkRows(busy()), 10000, 10)).toEqual([2, 1, 0, 0, 0, 1, 1, 1, 0, 0]);
  });
});

describe('request context', () => {
  const steps = [
    { at: 0, kind: 'open', label: 'Open the app' },
    { at: 5600, kind: 'click', label: 'Apply the coupon' },
    { at: 5650, kind: 'wait', label: 'Wait for the page' },
  ];

  it('attributes a request to the action before it, not the wait after the action', () => {
    expect(stepAt(steps, 5700)?.label).toBe('Apply the coupon');
    expect(stepAt(steps.slice(1), 100)?.label).toBe('Apply the coupon');
  });

  it('keeps the request itself among its neighbours when there are more than fit', () => {
    const bundle = busy();
    bundle.network = Array.from({ length: 30 }, (_, index) => request({ id: `r${index}`, at: 1000 + index * 5, duration: 50 }));
    const rows = buildNetworkRows(bundle);
    const around = neighbours(must(rows[29]), rows, 10);
    expect(around.rows).toHaveLength(10);
    expect(around.rows).toContain(rows[29]);
    expect(around.more).toBe(20);
  });

  it('finds the same call in another recording, query aside, nearest in time', () => {
    const mine = must(buildNetworkRows(busy()).find((row) => row.id === 'slow'));
    const other = busy();
    other.network = [
      request({ id: 'far', at: 9000, url: 'https://example.com/api/recommendations?for=cart' }),
      request({ id: 'near', at: 1300, url: 'https://example.com/api/recommendations?for=home' }),
      request({ id: 'post', at: 1200, method: 'POST', url: 'https://example.com/api/recommendations' }),
    ];
    expect(matchRequest(mine, buildNetworkRows(other))?.id).toBe('near');
  });

  it('writes a shell-safe cURL line with the retained headers', () => {
    const line = curlCommand({ method: 'POST', url: "https://x.test/a?q=it's", requestHeaders: [{ name: 'x-id', value: '1' }] });
    expect(line).toBe("curl 'https://x.test/a?q=it'\\''s' \\\n  -X POST \\\n  -H 'x-id: 1'");
  });

  it('badges the tab with the total, in danger ink when anything failed, and not at all when empty', () => {
    expect(networkBadge(buildNetworkRows(busy()))).toEqual({ value: 6, tone: 'danger', label: '6 requests, 2 failed' });
    expect(networkBadge([])).toBeUndefined();
  });
});
