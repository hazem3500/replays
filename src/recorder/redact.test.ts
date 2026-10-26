// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { DEFAULT_ALLOWED_HEADERS, filterHeaders, maskText, redactText, redactUrl } from './redact.ts';

describe('redactUrl', () => {
  it('redacts sensitive query and hash parameters and credentials', () => {
    expect(redactUrl('https://user:pw@api.example.com/v1?api_token=abc&page=2#access_token=x')).toBe(
      'https://api.example.com/v1?api_token=%5Bredacted%5D&page=2#access_token=%5Bredacted%5D',
    );
  });

  it('keeps relative URLs relative', () => {
    expect(redactUrl('/me?email=a@b.c')).toBe('/me?email=%5Bredacted%5D');
  });

  it('leaves plain text alone', () => {
    expect(redactUrl('not a url')).toBe('not a url');
  });
});

describe('redactText', () => {
  it('redacts embedded URLs, e-mail addresses and opaque tokens', () => {
    const text = redactText('GET https://x.io/a?token=1 failed for jane@example.com with eyJhbGciOi.eyJzdWIi.c2lnbmF0dXJl');
    expect(text).toContain('https://x.io/a?token=%5Bredacted%5D');
    expect(text).not.toContain('jane@example.com');
    expect(text).not.toContain('eyJhbGciOi');
  });

  it('caps the length', () => {
    expect(redactText('a '.repeat(50), 10)).toHaveLength(11);
  });
});

describe('filterHeaders', () => {
  it('keeps only allow-listed headers', () => {
    expect(
      filterHeaders(
        [
          ['Authorization', 'Bearer secret'],
          ['Cookie', 'sid=1'],
          ['Content-Type', 'application/json'],
          ['X-CSRF-Token', 'abc'],
        ],
        DEFAULT_ALLOWED_HEADERS,
      ),
    ).toEqual([{ name: 'content-type', value: 'application/json' }]);
  });
});

describe('maskText', () => {
  it('keeps whitespace and masks everything else', () => {
    expect(maskText('Hi there')).toBe('** *****');
  });
});
