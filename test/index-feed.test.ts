import { describe, expect, it } from 'vitest';

import { dayLabel, feedTime, groupByDay, runStrip, tagOptions } from '../src/client/index/feed.ts';
import { filtersFromSearch, indexSearch, searchFromFilters } from '../src/client/ReplayIndex.tsx';
import { PreviewHover, previewsAllowed } from '../src/client/index/preview.ts';
import { posterMoment, posterTime, previewPlan } from '../src/client/render/frames.ts';
import { mergeErrorTimes, SUMMARY_VERSION, summarizeReplay, summarizeTimeline, TIMELINE_CAP } from '../src/shared/replay.ts';
import { replay } from './fixtures.ts';

const network = (at: number, status: number) => ({
  id: `r${at}`,
  at,
  duration: 1,
  method: 'GET',
  url: 'https://example.com/x',
  status,
  statusText: '',
  requestHeaders: [],
  responseHeaders: [],
});

describe('summary timeline', () => {
  it('lists step times and merges errors within 0.5 % of the duration', () => {
    const bundle = replay();
    bundle.meta.duration = 10_000;
    bundle.steps = [
      { at: 4000, kind: 'click', label: 'b' },
      { at: 1000.4, kind: 'click', label: 'a' },
      { at: 12_000, kind: 'click', label: 'late' },
    ];
    bundle.console = [
      { at: 2000, level: 'error', message: 'one' },
      { at: 2040, level: 'error', message: 'two' },
      { at: 2100, level: 'warn', message: 'not an error' },
      { at: 7000, level: 'error', message: 'three' },
    ];
    bundle.network = [network(2049, 500), network(5000, 200), network(-5, 404)];
    expect(summarizeTimeline(bundle)).toEqual({
      steps: [1000, 4000, 10_000],
      errors: [
        { at: 0, count: 1 },
        { at: 2000, count: 3 },
        { at: 7000, count: 1 },
      ],
    });
  });

  it('caps steps and error groups at TIMELINE_CAP', () => {
    const bundle = replay();
    bundle.meta.duration = 1_000_000;
    bundle.steps = Array.from({ length: 1000 }, (_, index) => ({ at: index * 1000, kind: 'click', label: String(index) }));
    bundle.console = Array.from({ length: 1000 }, (_, index) => ({ at: index * 1000, level: 'error' as const, message: 'x' }));
    const { steps, errors } = summarizeTimeline(bundle);
    expect(steps).toHaveLength(TIMELINE_CAP);
    expect(steps[0]).toBe(0);
    expect(steps.at(-1)).toBe(999_000);
    expect(errors.length).toBeLessThanOrEqual(TIMELINE_CAP);
    expect(errors.reduce((total, group) => total + group.count, 0)).toBe(1000);
    // Even with a tiny window, the last group absorbs the rest.
    const merged = mergeErrorTimes(
      Array.from({ length: 500 }, (_, index) => index * 10),
      1,
      200,
    );
    expect(merged).toHaveLength(200);
    expect(merged.at(-1)).toEqual({ at: 1990, count: 301 });
  });

  it('adds the viewport and timeline to the list summary', () => {
    expect(summarizeReplay(replay())).toMatchObject({
      summaryVersion: SUMMARY_VERSION,
      viewport: { width: 1440, height: 900 },
      timeline: { steps: [0], errors: [] },
    });
  });
});

// Wednesday 14 October 2026, 15:00 local time.
const now = new Date(2026, 9, 14, 15, 0).getTime();
const at = (days: number, hours = 0) => new Date(new Date(2026, 9, 14, 12).getTime() - days * 86_400_000 - hours * 3_600_000).toISOString();

describe('feed grouping', () => {
  it('labels days relative to now, then by month', () => {
    expect(dayLabel(at(0), now)).toBe('Today');
    expect(dayLabel(at(1), now)).toBe('Yesterday');
    expect(dayLabel(at(2), now)).toBe('Earlier this week'); // Monday
    expect(dayLabel(at(3), now)).toBe('October'); // last Sunday
    expect(dayLabel(new Date(2026, 8, 30).toISOString(), now)).toBe('September');
    expect(dayLabel(new Date(2025, 11, 31).toISOString(), now)).toBe('December 2025');
    expect(dayLabel('not a date', now)).toBe('Undated');
  });

  it('groups consecutive items, newest or oldest first', () => {
    const items = [at(0), at(0, 2), at(1), at(5), at(40)];
    const newest = groupByDay(items, (item) => item, now);
    expect(newest.map((group) => [group.label, group.items.length])).toEqual([
      ['Today', 2],
      ['Yesterday', 1],
      ['October', 1],
      ['September', 1],
    ]);
    expect(groupByDay(items.toReversed(), (item) => item, now).map((group) => group.label)).toEqual([
      'September',
      'October',
      'Yesterday',
      'Today',
    ]);
  });

  it('offers the tags the list has, most used first, and keeps them in the URL', () => {
    const summaries = [{ tags: ['smoke', 'checkout'] }, { tags: ['smoke'] }, {}, { tags: ['checkout', 'alpha'] }];
    expect(tagOptions(summaries)).toEqual(['checkout', 'smoke', 'alpha']);
    expect(tagOptions([])).toEqual([]);
    expect(filtersFromSearch('?tag=smoke&source=agent')).toEqual({ tag: 'smoke', source: 'agent' });
    expect(searchFromFilters({ errors: true, tag: 'smoke' })).toBe('?errors=1&tag=smoke');
    expect(indexSearch({ tag: 'smoke' }, 'suites')).toBe('?tag=smoke&kind=suites');
  });
});

describe('poster moment', () => {
  it('is one second after the first full snapshot, clamped to the replay', () => {
    expect(posterTime([250, 4000], 10_000)).toBe(1250);
    expect(posterTime([], 10_000)).toBe(1000);
    expect(posterTime([900], 1200)).toBe(1200);
  });
});

const fakeTimers = () => {
  const pending = new Map<number, () => void>();
  let next = 0;
  return {
    schedule: (run: () => void) => {
      next++;
      pending.set(next, run);
      return next as unknown as ReturnType<typeof setTimeout>;
    },
    cancel: (timer: ReturnType<typeof setTimeout>) => pending.delete(timer as unknown as number),
    fire: () => {
      for (const [key, run] of Array.from(pending)) {
        pending.delete(key);
        run();
      }
    },
    get size() {
      return pending.size;
    },
  };
};

describe('hover previews', () => {
  it('plays after the intent delay, one row at a time, and stops on leave', () => {
    const timers = fakeTimers();
    const hover = new PreviewHover({ schedule: timers.schedule, cancel: timers.cancel });
    const changes: Array<string | undefined> = [];
    hover.subscribe(() => changes.push(hover.active));
    hover.enter('a');
    expect(hover.active).toBeUndefined();
    timers.fire();
    expect(hover.active).toBe('a');
    // Sweeping onto b stops a at once; b waits for its own delay.
    hover.enter('b');
    expect(hover.active).toBeUndefined();
    hover.leave('b');
    expect(timers.size).toBe(0);
    hover.enter('c');
    timers.fire();
    expect(hover.active).toBe('c');
    hover.leave('c');
    expect(hover.active).toBeUndefined();
    expect(changes).toEqual(['a', undefined, 'c', undefined]);
  });

  it('plays at once when the keyboard reaches a row, and leaving another row does not stop it', () => {
    const timers = fakeTimers();
    const hover = new PreviewHover({ schedule: timers.schedule, cancel: timers.cancel });
    hover.enter('a');
    hover.reach('b');
    expect(hover.active).toBe('b');
    expect(timers.size).toBe(0);
    hover.leave('a');
    expect(hover.active).toBe('b');
  });

  it('never autoplays under reduced motion, Save-Data, slow connections or without hover', () => {
    const ok = { reducedMotion: false, hover: true, saveData: false, effectiveType: '4g' };
    expect(previewsAllowed(ok)).toBe(true);
    expect(previewsAllowed({ ...ok, reducedMotion: true })).toBe(false);
    expect(previewsAllowed({ ...ok, saveData: true })).toBe(false);
    expect(previewsAllowed({ ...ok, effectiveType: '2g' })).toBe(false);
    expect(previewsAllowed({ ...ok, hover: false })).toBe(false);
  });
});

describe('preview frames', () => {
  it('plays at 3× with idle gaps squeezed, and marks frames that crossed an event', () => {
    // 2 s of activity, a 20 s idle gap, then 2 s more.
    const plan = previewPlan({ eventTimes: [0, 500, 1000, 2000, 22_000, 23_000, 24_000], duration: 24_000, fps: 15, idleMs: 1000 });
    // Squeezed: 2 s + 1 s (gap) + 2 s = 5 s of replay → 1.67 s at 3× → 25 frames + the first.
    expect(plan.times).toHaveLength(Math.floor((5000 / 3 / 1000) * 15) + 1);
    expect(plan.capped).toBe(false);
    expect(plan.coveredMs).toBe(24_000);
    expect(plan.times[0]).toBe(0);
    expect(plan.times.at(-1)).toBeGreaterThan(23_500);
    expect(plan.dirty[0]).toBe(0);
    // Inside the squeezed gap time jumps ahead, faster than 3×.
    const steps = plan.times.slice(1).map((time, index) => time - plan.times[index]!);
    expect(Math.max(...steps)).toBeGreaterThan(1000);
  });

  it('caps the clip at 15 s of output (the first 45 s at 3×)', () => {
    const events = Array.from({ length: 600 }, (_, index) => index * 500);
    const plan = previewPlan({ eventTimes: events, duration: 300_000, fps: 15 });
    expect(plan.capped).toBe(true);
    expect(plan.coveredMs).toBe(45_000);
    expect(plan.times).toHaveLength(15 * 15 + 1);
  });
});

describe('poster moment fallbacks', () => {
  const base = { snapshotTimes: [100], duration: 20_000, stepTimes: [1000, 6000, 9500, 15_000] };

  it('shows the settled middle, after the step nearest it', () => {
    // Step nearest 10 s is at 9.5 s; the next one is far, so it settles for 900 ms.
    expect(posterMoment(base)).toBe(10_400);
  });

  it('falls back sensibly without steps, and never before the first document', () => {
    expect(posterMoment({ ...base, stepTimes: [] })).toBe(10_000);
    expect(posterMoment({ stepTimes: [], snapshotTimes: [2000], duration: 5000 })).toBe(2500);
    expect(posterMoment({ stepTimes: [], snapshotTimes: [], duration: 0 })).toBe(0);
  });
});

describe('mark easter egg', () => {
  it('bursts on the fifth rapid click, then cools down', async () => {
    const { createStreak, STREAK_GAP_MS, COOLDOWN_MS } = await import('../src/client/index/mark-burst.ts');
    let time = 0;
    const streak = createStreak(() => time);
    const clicks = (n: number, gap = 200) =>
      Array.from({ length: n }, () => {
        time += gap;
        return streak.click();
      });
    expect(clicks(4).map((step) => [step.count, step.burst])).toEqual([
      [1, false],
      [2, false],
      [3, false],
      [4, false],
    ]);
    expect(clicks(1)[0]).toEqual({ count: 5, burst: true });
    // During the cooldown a new streak scrubs but cannot burst.
    expect(clicks(6).some((step) => step.burst)).toBe(false);
    time += COOLDOWN_MS;
    expect(clicks(5).at(-1)?.burst).toBe(true);
    // A pause breaks the streak.
    clicks(3);
    time += STREAK_GAP_MS + 1;
    expect(streak.click().count).toBe(1);
  });

  it('scrubs one segment per click, nods when full, and parks the playhead after the last filled segment', async () => {
    const { scrub, playheadX, SEGMENTS, REST_FILLED } = await import('../src/client/index/mark-burst.ts');
    expect(SEGMENTS).toHaveLength(5);
    expect(REST_FILLED).toBe(2);
    expect(scrub(2)).toEqual({ filled: 3, fills: 2, nod: false });
    expect(scrub(4)).toEqual({ filled: 5, fills: 4, nod: false });
    expect(scrub(5)).toEqual({ filled: 5, fills: undefined, nod: true });
    // Rest: just after segment 2 (7.6 + 2.6 + 0.5); the start sits just before segment 1; the end stays on the grid.
    expect(playheadX(1)).toBeCloseTo(10.7);
    expect(playheadX(-1)).toBeCloseTo(2.8);
    expect(playheadX(4)).toBeLessThan(24 - 1.9);
    // Every stop is strictly further right, so the playhead only ever moves forward on a scrub.
    const stops = [-1, 0, 1, 2, 3, 4].map(playheadX);
    expect(stops.every((x, index) => index === 0 || x > stops[index - 1]!)).toBe(true);
  });

  it('reverse typewriter: backspace accelerates, the mark drains with the word and refills as it is typed', async () => {
    const { BACKSPACE_GAPS_MS, drainedFill, typedFill } = await import('../src/client/index/mark-burst.ts');
    expect(BACKSPACE_GAPS_MS).toHaveLength(7);
    expect(BACKSPACE_GAPS_MS.every((gap, index) => index === 0 || gap < BACKSPACE_GAPS_MS[index - 1]!)).toBe(true);
    expect(BACKSPACE_GAPS_MS[0]).toBe(70);
    expect(BACKSPACE_GAPS_MS.at(-1)).toBe(30);
    // Deleting "Replays" from a full mark: never refills, ends empty.
    const draining = [6, 5, 4, 3, 2, 1, 0].map((left) => drainedFill(left, 7, 5));
    expect(draining.every((lit, index) => index === 0 || lit <= draining[index - 1]!)).toBe(true);
    expect(draining.at(-1)).toBe(0);
    expect(drainedFill(7, 7, 2)).toBe(2);
    // Typing it back: monotonic, all five lit exactly as the last letter lands.
    const typing = [1, 2, 3, 4, 5, 6, 7].map((typed) => typedFill(typed, 7));
    expect(typing.every((lit, index) => index === 0 || lit >= typing[index - 1]!)).toBe(true);
    expect(typing.at(-2)).toBeLessThan(5);
    expect(typing.at(-1)).toBe(5);
  });
});

const runs = (statuses: string[]) => statuses.map((status, index) => ({ status, sequence: index + 1 }));

const length = (run: { sequence: number }) => run.sequence * 1000;

describe('runStrip', () => {
  it('shows every run up to eight, in sequence, widths following their length (min 10 px)', () => {
    const strip = runStrip(runs(['passed', 'failed', 'partial']), length);
    expect(strip.segments.map(({ run }) => run.sequence)).toEqual([1, 2, 3]);
    expect(strip.more).toBe(0);
    const widths = strip.segments.map(({ width }) => width);
    expect(widths[0]).toBeLessThan(widths[2]!);
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(10);
    expect(widths.reduce((sum, width) => sum + width, 0) + 3 * 2).toBeLessThanOrEqual(121);
  });
  it('keeps failed runs when capping at eight, with "+N" for the rest', () => {
    const statuses = Array.from({ length: 12 }, (_, index) => (index === 10 ? 'failed' : 'passed'));
    const strip = runStrip(runs(statuses), () => undefined);
    expect(strip.segments).toHaveLength(8);
    expect(strip.segments.map(({ run }) => run.sequence)).toContain(11);
    expect(strip.more).toBe(4);
    // Without lengths every segment is the same width; one unknown among known ones counts as average.
    const mixed = runStrip(runs(['passed', 'passed', 'passed']), (run) => (run.sequence === 2 ? undefined : 10_000));
    expect(new Set(mixed.segments.map(({ width }) => width)).size).toBe(1);
    expect(new Set(strip.segments.map(({ width }) => width)).size).toBe(1);
  });
});

describe('feedTime', () => {
  const clock = Date.parse('2026-10-13T15:00:00');
  it('shows the time of day under Today and Yesterday (the heading already says the day)', () => {
    expect(feedTime('2026-10-13T09:05:00', clock)).toMatch(/^9:05\s?AM$/);
    expect(feedTime('2026-10-12T16:55:00', clock)).toMatch(/^4:55\s?PM$/);
  });
  it('shows the date and time under older headings, with the year when it is not this one', () => {
    expect(feedTime('2026-10-03T16:55:00', clock)).toMatch(/^Oct 3, 4:55\s?PM$/);
    expect(feedTime('2025-12-24T08:00:00', clock)).toMatch(/Dec 24, 2025/);
  });
});
