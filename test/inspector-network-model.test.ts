import { describe, expect, it } from 'vitest';

import { editTimeline } from '../src/shared/edits.ts';
import { buildNetworkRows, curlCommand, nearestStep, requestName, requestType, statusClass } from '../src/client/viewer/network/model.ts';
import { request, waterfallEdits, waterfallFixture } from './waterfall-fixture.ts';

describe('network model', () => {
  it('derives the type from the MIME type, then the extension', () => {
    expect(requestType({ url: 'https://a.test/', mimeType: 'text/html; charset=utf-8' })).toBe('document');
    expect(requestType({ url: 'https://a.test/app', mimeType: 'text/javascript' })).toBe('script');
    expect(requestType({ url: 'https://a.test/x', mimeType: 'text/css' })).toBe('stylesheet');
    expect(requestType({ url: 'https://a.test/x', mimeType: 'image/png' })).toBe('image');
    expect(requestType({ url: 'https://a.test/x', mimeType: 'font/woff2' })).toBe('font');
    expect(requestType({ url: 'https://a.test/api/coupons/X', mimeType: 'application/json' })).toBe('fetch');
    expect(requestType({ url: 'https://a.test/logo.svg?v=2' })).toBe('image');
    expect(requestType({ url: 'https://a.test/api/thing' })).toBe('other');
  });

  it('classes statuses, with no response distinct from a network error', () => {
    expect(statusClass({ status: 200, statusText: 'OK' })).toBe('ok');
    expect(statusClass({ status: 304, statusText: '' })).toBe('redirect');
    expect(statusClass({ status: 422, statusText: '' })).toBe('client-error');
    expect(statusClass({ status: 503, statusText: '' })).toBe('server-error');
    expect(statusClass({ status: 0, statusText: 'net::ERR_FAILED' })).toBe('failed');
    expect(statusClass({ status: 0, statusText: '' })).toBe('pending');
  });

  it('splits a name so the last segment survives a middle ellipsis', () => {
    expect(requestName('https://shop.test/api/coupons/apply?code=X', 'shop.test')).toEqual({
      head: '/api/coupons/',
      tail: 'apply',
      query: '?code=X',
    });
    expect(requestName('https://cdn.test/assets/', 'shop.test')).toEqual({ host: 'cdn.test', head: '/', tail: 'assets/', query: '' });
    expect(requestName('not a url?x=1', undefined)).toEqual({ head: '', tail: 'not a url', query: '?x=1' });
  });

  it('maps rows onto the edited clock and drops ones inside a cut', () => {
    const bundle = waterfallFixture();
    bundle.network = [request({ id: 'kept', at: 2000, duration: 500, status: 404 }), request({ id: 'cut', at: 3200, duration: 100 })];
    const rows = buildNetworkRows(bundle, editTimeline(waterfallEdits, 10_000));
    expect(rows.map((row) => row.id)).toEqual(['kept']);
    expect(rows[0]).toMatchObject({ at: 1000, end: 1500, status: 'client-error', failed: true, type: 'other' });
  });

  it('finds the step a request belongs to', () => {
    const steps = [
      { at: 100, kind: 'click', label: 'A' },
      { at: 900, kind: 'click', label: 'B' },
    ];
    expect(nearestStep(steps, 950)?.label).toBe('B');
    expect(nearestStep(steps, 500)?.label).toBe('A');
    expect(nearestStep(steps, 50)?.label).toBe('A');
    expect(nearestStep([], 50)).toBeUndefined();
  });

  it('copies as a shell-safe cURL line', () => {
    expect(
      curlCommand({ method: 'POST', url: "https://a.test/it's", requestHeaders: [{ name: 'accept', value: 'application/json' }] }),
    ).toBe("curl 'https://a.test/it'\\''s' \\\n  -X POST \\\n  -H 'accept: application/json'");
  });
});
