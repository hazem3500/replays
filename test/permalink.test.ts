import { describe, expect, it } from 'vitest';

import { collectErrors, nextError, previousError } from '../src/client/issues.ts';
import { formatSeconds, parsePermalink, stepPermalink, timePermalink } from '../src/client/permalink.ts';

describe('permalinks', () => {
  it('parses ?t= seconds', () => {
    expect(parsePermalink('?t=1.5', '', 4)).toEqual({ time: 1500 });
    expect(parsePermalink('?t=12s', '', 4)).toEqual({ time: 12_000 });
    expect(parsePermalink('?t=0', '', 0)).toEqual({ time: 0 });
  });

  it('parses #step-n (1-based) and prefers it over t', () => {
    expect(parsePermalink('', '#step-3', 4)).toEqual({ step: 2 });
    expect(parsePermalink('?t=1', '#step-1', 4)).toEqual({ step: 0 });
  });

  it('ignores invalid input', () => {
    expect(parsePermalink('?t=-1', '', 4)).toEqual({});
    expect(parsePermalink('?t=abc', '#step-0', 4)).toEqual({});
    expect(parsePermalink('', '#step-9', 4)).toEqual({});
    expect(parsePermalink('?t=1e9', '', 4)).toEqual({});
  });

  it('formats time links and drops the step hash', () => {
    expect(formatSeconds(2649)).toBe('2.6');
    expect(timePermalink('https://host.example/replays/r/a?x=1#step-2', 2649)).toBe('https://host.example/replays/r/a?x=1&t=2.6');
  });

  it('formats step links and drops t', () => {
    expect(stepPermalink('https://host.example/replays/r/a?t=2.6', 2)).toBe('https://host.example/replays/r/a#step-3');
  });

  it('round-trips', () => {
    const url = new URL(timePermalink('https://host.example/replays/r/a', 1700));
    expect(parsePermalink(url.search, url.hash, 0)).toEqual({ time: 1700 });
    const step = new URL(stepPermalink('https://host.example/replays/r/a', 1));
    expect(parsePermalink(step.search, step.hash, 4)).toEqual({ step: 1 });
  });
});

describe('error navigation', () => {
  const header = { name: 'x', value: 'y' };
  const errors = collectErrors({
    console: [
      { at: 300, level: 'error', message: 'Boom' },
      { at: 100, level: 'warn', message: 'meh' },
    ],
    network: [
      {
        id: 'r1',
        at: 50,
        duration: 1,
        method: 'GET',
        url: 'https://a.test/ok',
        status: 200,
        statusText: 'OK',
        requestHeaders: [header],
        responseHeaders: [],
      },
      {
        id: 'r2',
        at: 200,
        duration: 1,
        method: 'POST',
        url: 'https://a.test/api?q=1',
        status: 500,
        statusText: 'Server Error',
        requestHeaders: [],
        responseHeaders: [],
      },
      {
        id: 'r3',
        at: 400,
        duration: 1,
        method: 'GET',
        url: 'https://a.test/x',
        status: 0,
        statusText: 'net::ERR_NAME_NOT_RESOLVED',
        requestHeaders: [],
        responseHeaders: [],
      },
      {
        id: 'r4',
        at: 500,
        duration: 0,
        method: 'GET',
        url: 'https://a.test/old-path',
        status: 0,
        statusText: '',
        requestHeaders: [],
        responseHeaders: [],
      },
    ],
  });

  it('collects console errors and failed requests in time order, skipping redirect hops', () => {
    expect(errors.map((error) => [error.at, error.kind, error.requestId])).toEqual([
      [200, 'network', 'r2'],
      [300, 'console', undefined],
      [400, 'network', 'r3'],
    ]);
    expect(errors[0]?.label).toBe('POST a.test/api?q=1 failed (500 Server Error)');
    expect(errors[2]?.label).toBe('GET a.test/x failed (net::ERR_NAME_NOT_RESOLVED)');
  });

  it('steps forward and back without sticking on the current error', () => {
    expect(nextError(errors, 0)?.at).toBe(200);
    expect(nextError(errors, 200)?.at).toBe(300);
    expect(nextError(errors, 400)).toBeUndefined();
    expect(previousError(errors, 300)?.at).toBe(200);
    expect(previousError(errors, 200)).toBeUndefined();
  });
});
