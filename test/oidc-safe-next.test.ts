import { describe, expect, it } from 'vitest';

import { safeNext } from '../src/server/auth/oidc.ts';

describe('safeNext', () => {
  it('keeps paths inside the app and falls back to the base for anything else', () => {
    expect(safeNext('/r/abc?t=1', '')).toBe('/r/abc?t=1');
    expect(safeNext('/replays/s/suite', '/replays')).toBe('/replays/s/suite');
    expect(safeNext(undefined, '')).toBe('/');
    expect(safeNext(null, '/replays')).toBe('/replays/');
    expect(safeNext('', '/replays')).toBe('/replays/');
    for (const bad of [
      'https://evil.example/',
      '//evil.example/path',
      '/\\evil.example',
      '\\\\evil.example',
      'javascript:alert(1)',
      'r/relative',
      '/ok\r\nSet-Cookie: x=1',
      '/a\nb',
    ])
      expect(safeNext(bad, '/replays')).toBe('/replays/');
  });
});
