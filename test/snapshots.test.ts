import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { firstPaintOffset, groupAt, renderOffset, snapshotGroups } from '../src/client/snapshots.ts';
import type { ReplayBundle } from '../src/shared/replay.ts';

const event = (type: number, timestamp: number, data: Record<string, unknown> = {}) => ({ type, timestamp, data });

describe('nearest full snapshot at or before t', () => {
  // Two documents; the second has no network track, so its group starts at its lifecycle events.
  const events = [
    event(4, 1000, { href: 'https://a.test/' }),
    event(2, 1010),
    event(3, 1500),
    event(0, 2000),
    event(1, 2100),
    event(4, 2100, { href: 'https://b.test/' }),
    event(2, 2200),
    event(3, 2600),
  ];
  const groups = snapshotGroups(events);

  it('finds every full snapshot and where its document starts', () => {
    expect(groups).toEqual([
      { start: 0, snapshot: 10, href: 'https://a.test/' },
      { start: 1000, snapshot: 1200, href: 'https://b.test/' },
    ]);
  });

  it('selects the last snapshot group that started at or before t', () => {
    expect(groupAt(groups, 0)?.href).toBe('https://a.test/');
    expect(groupAt(groups, 999)?.href).toBe('https://a.test/');
    expect(groupAt(groups, 1000)?.href).toBe('https://b.test/');
    expect(groupAt(groups, 1600)?.href).toBe('https://b.test/');
    expect(groupAt([], 5)).toBeUndefined();
  });

  it('renders inclusively, and from the new document inside a navigation gap', () => {
    expect(renderOffset(groups, 500)).toBe(501);
    // 1100 is after the new document loaded but before its snapshot: show its first frame.
    expect(renderOffset(groups, 1100)).toBe(1201);
    expect(renderOffset(groups, 1600)).toBe(1601);
  });

  it('uses the document response to find the navigation commit', () => {
    const network = [
      {
        id: 'r',
        at: 700,
        duration: 50,
        method: 'GET',
        url: 'https://b.test/',
        status: 200,
        statusText: 'OK',
        requestHeaders: [],
        responseHeaders: [],
      },
    ] satisfies ReplayBundle['network'];
    expect(snapshotGroups(events, network)[1]?.start).toBe(750);
    // Failed requests and other URLs are not commits.
    expect(snapshotGroups(events, [{ ...network[0]!, status: 0 }])[1]?.start).toBe(1000);
    expect(snapshotGroups(events, [{ ...network[0]!, url: 'https://c.test/' }])[1]?.start).toBe(1000);
  });

  it('puts the sample navigation to the checkout page at its document response', () => {
    const sample = JSON.parse(readFileSync(resolve(import.meta.dirname, '../sample/demo-shop.json'), 'utf8')) as ReplayBundle;
    const sampleGroups = snapshotGroups(sample.events, sample.network);
    expect(sampleGroups.map((group) => new URL(group.href!).pathname)).toEqual(['/', '/checkout.html']);
    const checkout = sampleGroups[1]!;
    // The page's snapshot lands just after its document response started, and the first page ends where it starts.
    expect(checkout.snapshot).toBeGreaterThanOrEqual(checkout.start);
    expect(checkout.snapshot - checkout.start).toBeLessThan(500);
    expect(groupAt(sampleGroups, checkout.start - 50)?.href).not.toContain('checkout');
    expect(groupAt(sampleGroups, checkout.snapshot + 50)?.href).toContain('checkout');
  });
});


const track = (...ats: number[]) => ({
  supported: [],
  entries: ats.map((at) => ({ at, kind: 'first-contentful-paint' as const, value: 1 })),
});

describe('first painted frame', () => {
  const events = [
    event(4, 1000, { href: 'https://a.test/' }),
    event(2, 1010),
    event(3, 1500),
    event(4, 3000, { href: 'https://b.test/' }),
    event(2, 3100),
  ];
  const groups = snapshotGroups(events);

  it('is the earliest first contentful paint, as an offset from the first event', () => {
    expect(firstPaintOffset(track(900, 400), groups, 2100)).toBe(400);
  });

  it('is 0 without a paint entry or a track', () => {
    expect(firstPaintOffset(undefined, groups, 2100)).toBe(0);
    expect(firstPaintOffset({ supported: [], entries: [] }, groups, 2100)).toBe(0);
  });

  it('stays inside the first document and the replay', () => {
    expect(firstPaintOffset(track(9000), groups, 2100)).toBe(2000 - 1);
    expect(firstPaintOffset(track(0), groups, 2100)).toBe(0);
    expect(firstPaintOffset(track(1900), groups.slice(0, 1), 1000)).toBe(999);
  });
});
