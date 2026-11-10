// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildIndexEntries, entryIsMine, tabCounts } from '../src/client/ReplayIndex.tsx';
import { ProfileSegments } from '../src/client/index/IndexHeader.tsx';
import { FOR_YOU } from '../src/client/index/for-you.ts';
import type { ReplaySummary } from '../src/shared/replay.ts';
import type { ReviewSuiteIndexEntry } from '../src/shared/review-suite.ts';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const summary = (id: string, profile: string | undefined, email?: string) =>
  ({ id, ...(profile ? { profile } : {}), ...(email ? { people: [{ role: 'reviewer', email }] } : {}) }) as unknown as ReplaySummary;

const me = { email: 'ada@example.com', handles: {} };
const sessions = [
  summary('a', 'triage', 'ada@example.com'),
  summary('b', 'triage'),
  summary('c', 'walkthrough', 'bob@example.com'),
  summary('d', undefined, 'ada@example.com'),
];
const entries = buildIndexEntries(sessions, [] as ReviewSuiteIndexEntry[], {});

describe('tab counts come from one list', () => {
  it('counts every tab, For you included, from the same entries', () => {
    expect(tabCounts(entries, me)).toEqual({ all: 4, triage: 2, walkthrough: 1, [FOR_YOU]: 2 });
  });

  it('matches a row by a linked handle and never matches an empty identity', () => {
    const row = buildIndexEntries(
      [{ ...summary('h', undefined), people: [{ role: 'reviewer', handles: { github: 'Ada-L' } }] } as ReplaySummary],
      [],
      {},
    )[0]!;
    expect(entryIsMine(row, { handles: { github: 'ada-l' } })).toBe(true);
    expect(entryIsMine(row, {})).toBe(false);
  });
});

describe('profile tabs', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const profiles = [
    { id: 'triage', label: 'Triage' },
    { id: 'walkthrough', label: 'Walkthrough' },
  ] as never;
  const render = (value: string | undefined) =>
    act(() => {
      root.render(createElement(ProfileSegments, { profiles, value, counts: tabCounts(entries, me), onChange: () => {}, forYou: true }));
    });
  const shown = () => [...host.querySelectorAll('.profile-segment')].map((tab) => tab.textContent);

  it('shows a number on every tab in both scopes and keeps the same tab elements on a switch', () => {
    render(FOR_YOU);
    const before = [...host.querySelectorAll('.profile-segment')];
    expect(shown()).toEqual(['For you2', 'All4', 'Triage2', 'Walkthrough1']);
    render(undefined);
    expect(shown()).toEqual(['For you2', 'All4', 'Triage2', 'Walkthrough1']);
    expect([...host.querySelectorAll('.profile-segment')]).toEqual(before);
  });

  it('reserves the number slot while the list loads', () => {
    act(() => {
      root.render(createElement(ProfileSegments, { profiles, value: undefined, counts: undefined, onChange: () => {}, forYou: true }));
    });
    const slots = host.querySelectorAll('.profile-segment-count');
    expect(slots).toHaveLength(4);
    expect([...slots].every((slot) => slot.getAttribute('data-ready') === 'false')).toBe(true);
  });
});
