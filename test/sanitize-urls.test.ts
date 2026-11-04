import { describe, expect, it } from 'vitest';

import { networkEntries, sanitizeUrl, sanitizeUrlFields } from '../src/capture/sanitize.ts';
import { hasNoResponse, isFailedRequest } from '../src/shared/replay.ts';

// Shapes taken from an agent-browser 0.38 HAR: the 3xx response is dropped, so
// the hop is a status-0 entry with no headers; real failures carry net::ERR_*.
const harEntry = (url: string, status: number, statusText: string) => ({
  startedDateTime: '2026-10-11T03:10:31.792Z',
  time: 0,
  request: { method: 'GET', url, headers: [] },
  response: { status, statusText, headers: [] },
});

describe('agent-browser redirect hops', () => {
  const entries = networkEntries(
    {
      log: {
        entries: [
          harEntry('https://example.com/old/pricing', 0, ''),
          harEntry('http://nope.invalid/x', 0, 'net::ERR_NAME_NOT_RESOLVED'),
          harEntry('https://a.test/hang', 0, 'net::ERR_EMPTY_RESPONSE'),
          harEntry('https://a.test/missing', 404, 'Not Found'),
          harEntry('https://example.com/pricing', 200, 'OK'),
        ],
      },
    },
    Date.parse('2026-10-11T03:10:31.000Z'),
  );
  const entry = (index: number) => {
    const found = entries[index];
    if (!found) throw new Error(`no network entry ${index}`);
    return found;
  };

  it('does not count a redirect hop as a failed request', () => {
    expect(hasNoResponse(entry(0))).toBe(true);
    expect(isFailedRequest(entry(0))).toBe(false);
  });

  it('still counts network failures and HTTP errors', () => {
    const failures = [entry(1), entry(2), entry(3)];
    expect(failures.map((request) => isFailedRequest(request))).toEqual([true, true, true]);
    expect(failures.some((request) => hasNoResponse(request))).toBe(false);
    expect(isFailedRequest(entry(4))).toBe(false);
  });
});

describe('URLs in text and query strings', () => {
  it('removes URL credentials', () => {
    expect(sanitizeUrl('https://user:pass@example.com/path')).toBe('https://example.com/path');
  });

  it('leaves text without sensitive URLs byte-for-byte unchanged', () => {
    const text = 'see https://example.com?view=all and http://a.test/path, then https://b.test/?page=2';
    expect(sanitizeUrlFields({ message: text })).toEqual({ message: text });
  });

  it('keeps query-only relative URLs relative', () => {
    expect(sanitizeUrl('?page=2&token=secret')).toBe('?page=2&token=%5Bredacted%5D');
    expect(sanitizeUrl('?page=2')).toBe('?page=2');
  });

  it('redacts presigned URL signatures and JWT query values', () => {
    const url = sanitizeUrl('https://bucket.example.com/a.png?X-Amz-Signature=s1&signature=s2&jwt=s3&w=10');
    expect(url).not.toMatch(/s1|s2|s3/);
    expect(url).toContain('w=10');
  });
});
