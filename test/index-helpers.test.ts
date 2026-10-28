import { describe, expect, it } from 'vitest';

import { formatRelative } from '../src/client/format.ts';
import {
  buildIndexEntries,
  filtersFromSearch,
  indexSearch,
  kindFromSearch,
  replayCount,
  searchFromFilters,
  sortEntries,
  sortFromSearch,
  sortSummaries,
} from '../src/client/ReplayIndex.tsx';
import { initialRunReplayId, isExpired, neighbourReplayId, playableReplayId } from '../src/client/suite/runs.ts';
import type { ReplaySummary } from '../src/shared/replay.ts';
import type { ReviewSuiteIndexEntry } from '../src/shared/review-suite.ts';

const suiteRun = (sequence: number, status: 'passed' | 'failed' | 'running', replayId?: string) => ({
  id: `run-${sequence}`,
  sequence,
  label: `Run ${sequence}`,
  status,
  startedAt: '2026-10-12T00:00:00Z',
  ...(replayId ? { replayId } : {}),
});

describe('suite landing', () => {
  it('lands a suite on its first failed run, else the first run with a recording', () => {
    expect(initialRunReplayId([suiteRun(2, 'failed', 'b'), suiteRun(1, 'passed', 'a'), suiteRun(3, 'failed', 'c')], false)).toBe('b');
    expect(initialRunReplayId([suiteRun(2, 'passed', 'b'), suiteRun(1, 'failed'), suiteRun(3, 'passed', 'c')], false)).toBe('b');
    expect(initialRunReplayId([suiteRun(1, 'running')], false)).toBeUndefined();
  });

  it('never lands on a run whose replay expired (replay summaries loaded, none for the run)', () => {
    const summary = { duration: 1000 } as ReplaySummary;
    const expired = suiteRun(1, 'failed', 'gone');
    const kept = { ...suiteRun(2, 'failed', 'kept'), replay: summary };
    const passed = { ...suiteRun(3, 'passed', 'ok'), replay: summary };
    expect(initialRunReplayId([expired, kept, passed], true)).toBe('kept');
    expect(initialRunReplayId([expired, passed], true)).toBe('ok');
    expect(initialRunReplayId([expired], true)).toBeUndefined();
    // Without summaries (a plain suite) a replay id is all there is to go on.
    expect(initialRunReplayId([expired, passed], false)).toBe('gone');
    expect(playableReplayId(expired, true)).toBeUndefined();
    expect(isExpired(expired, true)).toBe(true);
    expect(isExpired(expired, false)).toBe(false);
    expect(isExpired(suiteRun(4, 'passed'), true)).toBe(false);
  });
});

const replay = (id: string, extra: Partial<ReplaySummary> = {}): ReplaySummary => ({
  id,
  title: id,
  url: `https://${extra.host ?? 'app.test'}/`,
  host: 'app.test',
  capturedAt: '2026-10-01T00:00:00Z',
  duration: 1000,
  steps: 2,
  consoleErrors: 0,
  failedRequests: 0,
  source: 'agent',
  ...extra,
});
const ids = (entries: ReturnType<typeof buildIndexEntries>) => entries.map((entry) => `${entry.kind}:${entry.id}`);

describe('index helpers', () => {
  it('round-trips filters through the query string', () => {
    const filters = filtersFromSearch('?q=login&host=example.com&errors=1&source=human&junk=1');
    expect(filters).toEqual({ q: 'login', host: 'example.com', errors: true, source: 'human' });
    expect(searchFromFilters(filters)).toBe('?q=login&host=example.com&errors=1&source=human');
    expect(searchFromFilters({})).toBe('');
    expect(filtersFromSearch('?source=robot')).toEqual({});
  });

  it('sorts by any column, newest first on ties', () => {
    const base = { url: '', host: 'a', duration: 1, steps: 1, consoleErrors: 0, failedRequests: 0, source: 'agent' as const };
    const items: ReplaySummary[] = [
      { ...base, id: 'a', title: 'Beta', capturedAt: '2026-10-01T00:00:00Z', failedRequests: 2 },
      { ...base, id: 'b', title: 'alpha', capturedAt: '2026-10-03T00:00:00Z' },
      { ...base, id: 'c', title: 'Gamma', capturedAt: '2026-10-02T00:00:00Z', consoleErrors: 1 },
    ];
    expect(sortSummaries(items, { key: 'capturedAt', direction: 'descending' }).map((item) => item.id)).toEqual(['b', 'c', 'a']);
    expect(sortSummaries(items, { key: 'title', direction: 'ascending' }).map((item) => item.id)).toEqual(['b', 'a', 'c']);
    expect(sortSummaries(items, { key: 'errors', direction: 'descending' }).map((item) => item.id)).toEqual(['a', 'c', 'b']);
  });

  it('keeps the kind filter in the URL next to the server filters', () => {
    expect(kindFromSearch('?q=a&kind=suites')).toBe('suites');
    expect(kindFromSearch('?kind=robots')).toBeUndefined();
    expect(indexSearch({ q: 'a' }, 'sessions')).toBe('?q=a&kind=sessions');
    expect(indexSearch({}, 'suites')).toBe('?kind=suites');
    // Sort is part of the view too, so Back and "Replays" links return to the same order.
    expect(indexSearch({ errors: true }, undefined, { key: 'errors', direction: 'ascending' })).toBe('?errors=1&sort=errors');
    expect(indexSearch({}, undefined, { key: 'capturedAt', direction: 'descending' })).toBe('');
    expect(sortFromSearch('?sort=-duration')).toEqual({ key: 'duration', direction: 'descending' });
    expect(sortFromSearch('?sort=title')).toEqual({ key: 'title', direction: 'ascending' });
    expect(sortFromSearch('?sort=bogus')).toEqual({ key: 'capturedAt', direction: 'descending' });
    expect(indexSearch({ errors: true }, undefined)).toBe('?errors=1');
  });

  describe('grouped suites and sessions', () => {
    const timer = replay('suite-run-timer', { title: 'Timer run', consoleErrors: 2, failedRequests: 1, duration: 4000 });
    const login = replay('suite-run-login', { title: 'Login run', host: 'login.test' });
    const suite: ReviewSuiteIndexEntry = {
      id: 'review-8',
      title: 'Nightly review · PR #8',
      createdAt: '2026-10-02T00:00:00Z',
      subject: { provider: 'github', label: 'acme/api#8', url: 'https://github.com/acme/api/pull/8' },
      runs: 3,
      running: 0,
      failed: 1,
      partial: 0,
      missingRecordings: 1,
      duration: 5000,
      runDetails: [
        {
          id: 'b',
          sequence: 2,
          label: 'Login only',
          status: 'passed',
          startedAt: '2026-10-02T00:02:00Z',
          replayId: login.id,
          replay: login,
        },
        {
          id: 'a',
          sequence: 1,
          label: 'Timer save',
          status: 'failed',
          startedAt: '2026-10-02T00:01:00Z',
          replayId: timer.id,
          replay: timer,
        },
        { id: 'c', sequence: 3, label: 'Settings', status: 'running', startedAt: '2026-10-02T00:03:00Z' },
      ],
    };
    const solo = replay('solo', { title: 'Solo session', capturedAt: '2026-10-03T00:00:00Z' });
    const human = replay('human', { title: 'Human import', source: 'human', capturedAt: '2026-09-01T00:00:00Z' });
    const sessions = [solo, timer, login, human];

    it('lists suite replays only under their suite, with runs in sequence and suite totals', () => {
      const entries = sortEntries(buildIndexEntries(sessions, [suite], {}), { key: 'capturedAt', direction: 'descending' });
      expect(ids(entries)).toEqual(['session:solo', 'suite:review-8', 'session:human']);
      const group = entries[1]!;
      if (group.kind !== 'suite') throw new Error('expected a suite');
      expect(group.status).toBe('Running');
      expect(group.runs.map((run) => run.sequence)).toEqual([1, 2, 3]);
      expect(group.values).toMatchObject({ duration: 5000, steps: 4, errors: 3, host: 'app.test' });
      expect(group.hosts).toEqual(['app.test', 'login.test']);
      expect(replayCount(entries)).toBe(4);
      // A run whose replay was pruned (an id but no summary) is not a replay the list can open.
      const expired = {
        id: 'd',
        sequence: 4,
        label: 'Pruned',
        status: 'passed' as const,
        startedAt: '2026-10-02T00:04:00Z',
        replayId: 'gone',
      };
      const withExpired = buildIndexEntries(sessions, [{ ...suite, runDetails: [...suite.runDetails, expired] }], {});
      expect(replayCount(withExpired)).toBe(4);
    });

    it('keeps a suite when it or any run matches, and narrows runs to the matches', () => {
      const byTitle = buildIndexEntries([], [suite], { q: 'pr #8' });
      expect(byTitle).toHaveLength(1);
      expect(byTitle[0]).toMatchObject({ matchedBySuite: true, hiddenRuns: 0 });
      const bySubject = buildIndexEntries([], [suite], { q: 'acme/api#8' });
      expect(bySubject).toHaveLength(1);
      expect(buildIndexEntries([], [suite], { tag: 'smoke' })).toEqual([]);
      const byRun = buildIndexEntries([], [suite], { q: 'login' });
      expect(byRun[0]).toMatchObject({ matchedBySuite: false, hiddenRuns: 2 });
      if (byRun[0]?.kind !== 'suite') throw new Error('expected a suite');
      expect(byRun[0].runs.map((run) => run.id)).toEqual(['b']);
      const errors = buildIndexEntries([], [suite], { errors: true });
      if (errors[0]?.kind !== 'suite') throw new Error('expected a suite');
      expect(errors[0].runs.map((run) => run.id)).toEqual(['a']);
      const host = buildIndexEntries([], [suite], { host: 'login.test' });
      if (host[0]?.kind !== 'suite') throw new Error('expected a suite');
      expect(host[0].runs.map((run) => run.id)).toEqual(['b']);
      expect(buildIndexEntries([], [suite], { source: 'human' })).toEqual([]);
      expect(buildIndexEntries([], [suite], { q: 'nothing like this' })).toEqual([]);
    });

    it('filters by kind and sorts both kinds on the same columns', () => {
      expect(ids(buildIndexEntries(sessions, [suite], {}, 'suites'))).toEqual(['suite:review-8']);
      expect(ids(buildIndexEntries(sessions, [suite], {}, 'sessions'))).toEqual(['session:solo', 'session:human']);
      const byErrors = sortEntries(buildIndexEntries(sessions, [suite], {}), { key: 'errors', direction: 'descending' });
      expect(ids(byErrors)[0]).toBe('suite:review-8');
      const byTitle = sortEntries(buildIndexEntries(sessions, [suite], {}), { key: 'title', direction: 'ascending' });
      expect(ids(byTitle)).toEqual(['session:human', 'suite:review-8', 'session:solo']);
    });
  });

  it('formats relative capture times', () => {
    const now = Date.parse('2026-10-09T12:00:00Z');
    expect(formatRelative('2026-10-09T11:59:40Z', now)).toBe('just now');
    expect(formatRelative('2026-10-09T09:00:00Z', now)).toBe('3 hours ago');
    expect(formatRelative('2026-10-08T12:00:00Z', now)).toBe('yesterday');
    expect(formatRelative('not a date', now)).toBe('Unknown');
  });
});

describe('suite run navigation', () => {
  const runs = [{ sequence: 3, replayId: 'c' }, { sequence: 1, replayId: 'a' }, { sequence: 2 }];
  it('steps through runs with recordings in sequence order', () => {
    expect(neighbourReplayId(runs, 'a', 1, false)).toBe('c');
    expect(neighbourReplayId(runs, 'c', -1, false)).toBe('a');
    expect(neighbourReplayId(runs, 'c', 1, false)).toBeUndefined();
    expect(neighbourReplayId(runs, 'a', -1, false)).toBeUndefined();
  });

  it('skips runs whose replay expired', () => {
    const summary = { duration: 1000 } as ReplaySummary;
    const detailed = [
      { sequence: 1, replayId: 'a', replay: summary },
      { sequence: 2, replayId: 'gone' },
      { sequence: 3, replayId: 'c', replay: summary },
    ];
    expect(neighbourReplayId(detailed, 'a', 1, true)).toBe('c');
    expect(neighbourReplayId(detailed, 'c', -1, true)).toBe('a');
    expect(neighbourReplayId(detailed, 'a', 1, false)).toBe('gone');
  });
});
