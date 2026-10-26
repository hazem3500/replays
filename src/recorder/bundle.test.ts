// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { assertReplayBundle } from '../shared/replay.ts';
import { buildReplayBundle, issueReplayId } from './bundle.ts';
import type { ReplayBundle } from './bundle-types.ts';

/**
 * The checks Replays' `assertReplayBundle` runs on every upload
 * (src/shared/replay.ts), for the fields this package produces.
 */
function assertAcceptedByToggleReplays(bundle: ReplayBundle) {
  expect(() => assertReplayBundle(bundle)).not.toThrow();
  expect(bundle.meta.id).toMatch(/^[a-z0-9][a-z0-9-]{0,79}$/);
  expect(typeof bundle.meta.title).toBe('string');
  expect(bundle.events.length).toBeGreaterThanOrEqual(2);
  expect(bundle.events.some((event) => event.type === 2)).toBe(true);
  expect(Array.isArray(bundle.steps)).toBe(true);
  expect(Array.isArray(bundle.console)).toBe(true);
  expect(Array.isArray(bundle.network)).toBe(true);
  expect(bundle.meta.version).toBe(1);
  expect(Number.isFinite(bundle.meta.duration)).toBe(true);
  expect(bundle.meta.duration).toBeGreaterThanOrEqual(0);
  expect(bundle.meta.source).toBe('human');
  expect(bundle.meta).not.toHaveProperty('purpose');
  expect(bundle.meta).not.toHaveProperty('people');
}

const events = [
  {
    type: 4,
    timestamp: 1_000,
    data: {
      href: 'https://app.example.com/x?token=s',
      width: 1440,
      height: 900,
    },
  },
  { type: 2, timestamp: 1_010, data: { node: {} } },
  { type: 3, timestamp: 4_000, data: { source: 1 } },
];

describe('buildReplayBundle', () => {
  it('builds a bundle Replays accepts, on one timeline', () => {
    const bundle = buildReplayBundle({
      title: 'Issue report from Toggl Focus',
      events,
      console: [{ at: 2_000, level: 'error', message: 'boom', url: '/a' }],
      network: [
        {
          at: 1_500,
          duration: 20,
          method: 'GET',
          url: '/api',
          status: 500,
          statusText: 'Internal Server Error',
          requestHeaders: [],
          responseHeaders: [],
        },
      ],
      steps: [{ at: 1_000, kind: 'start', label: 'Recording started' }],
      now: new Date('2026-10-14T10:11:12Z'),
      randomSuffix: 'abcd1234',
    });
    assertAcceptedByToggleReplays(bundle);
    expect(bundle.meta).toMatchObject({
      id: 'issue-2026-10-14-101112-abcd1234',
      url: 'https://app.example.com/x?token=%5Bredacted%5D',
      duration: 3_000,
      viewport: { width: 1440, height: 900 },
      eventCount: 3,
    });
    expect(bundle.console[0]?.at).toBe(1_000);
    expect(bundle.network[0]).toMatchObject({ id: 'request-1', at: 500 });
    expect(bundle.steps[0]?.at).toBe(0);
  });

  it('redacts the URLs inside the rrweb events', () => {
    const bundle = buildReplayBundle({
      title: 'x',
      events: [
        events[0]!,
        {
          type: 2,
          timestamp: 1_010,
          data: {
            node: {
              type: 2,
              id: 1,
              tagName: 'a',
              attributes: {
                href: 'https://app.example.com/invite?code=abc',
                class: 'link',
              },
              childNodes: [
                {
                  type: 2,
                  id: 2,
                  tagName: 'img',
                  attributes: {
                    srcset: '/a.png?signature=s 1x, /b.png 2x',
                  },
                  childNodes: [],
                },
              ],
            },
          },
        },
        {
          type: 3,
          timestamp: 2_000,
          data: {
            source: 0,
            texts: [],
            removes: [],
            adds: [],
            attributes: [{ id: 1, attributes: { href: 'mailto:jane@example.com' } }],
          },
        },
        {
          type: 4,
          timestamp: 3_000,
          data: { href: 'https://app.example.com/cb#access_token=t' },
        },
      ],
      console: [],
      network: [],
      steps: [],
    });
    const serialized = JSON.stringify(bundle.events);
    expect(serialized).toContain('invite?code=%5Bredacted%5D');
    expect(serialized).toContain('/a.png?signature=%5Bredacted%5D 1x, /b.png 2x');
    expect(serialized).toContain('mailto:[redacted]');
    expect(serialized).toContain('#access_token=%5Bredacted%5D');
    for (const secret of ['abc', 'jane@', 'token=s', '=t"']) expect(serialized).not.toContain(secret);
    // The input events are not modified.
    expect(JSON.stringify(events[0])).toContain('x?token=s');
  });

  it('rejects a recording without a full snapshot', () => {
    expect(() =>
      buildReplayBundle({
        title: 'x',
        events: [events[0]!, events[2]!],
        console: [],
        network: [],
        steps: [],
      }),
    ).toThrow(/full snapshot/);
  });

  it('makes ids that stay valid with odd suffixes', () => {
    expect(issueReplayId(new Date(0), 'ÄÖ!!')).toBe('issue-1970-01-01-000000-capture');
  });
});
