import type { ReplaySummary } from '../../shared/replay.ts';

/*
 * Pure helpers for the replay index feed (Feed.tsx): day groups, the tag filter's options and the run strip.
 * Unit-tested in test/index-feed.test.ts.
 */

const DAY = 24 * 3600_000;
export type FeedCalendar = 'local' | 'utc';

function startOfDay(time: number, calendar: FeedCalendar) {
  const date = new Date(time);
  if (calendar === 'utc') date.setUTCHours(0, 0, 0, 0);
  else date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Monday 00:00 of the week containing `time`, in the selected calendar. */
function startOfWeek(time: number, calendar: FeedCalendar) {
  const date = new Date(startOfDay(time, calendar));
  const weekday = ((calendar === 'utc' ? date.getUTCDay() : date.getDay()) + 6) % 7;
  if (calendar === 'utc') date.setUTCDate(date.getUTCDate() - weekday);
  else date.setDate(date.getDate() - weekday);
  return date.getTime();
}

function calendarFormats(calendar: FeedCalendar) {
  const zone = calendar === 'utc' ? { timeZone: 'UTC' } : {};
  const locale = calendar === 'utc' ? 'en' : undefined;
  const clock = { hour: 'numeric', minute: '2-digit', ...zone } as const;
  return {
    month: new Intl.DateTimeFormat('en', { month: 'long', ...zone }),
    monthYear: new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', ...zone }),
    time: new Intl.DateTimeFormat(locale, clock),
    date: new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', ...clock }),
    dateYear: new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric', ...clock }),
  };
}
const FORMATS = { local: calendarFormats('local'), utc: calendarFormats('utc') };
const yearOf = (time: number, calendar: FeedCalendar) =>
  calendar === 'utc' ? new Date(time).getUTCFullYear() : new Date(time).getFullYear();

/** "Today", "Yesterday", "Earlier this week", then "October" (with the year when it is not this year). */
export function dayLabel(iso: string, now = Date.now(), calendar: FeedCalendar = 'local') {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return 'Undated';
  const today = startOfDay(now, calendar);
  if (time >= today) return 'Today';
  if (time >= today - DAY) return 'Yesterday';
  if (time >= startOfWeek(now, calendar)) return 'Earlier this week';
  const sameYear = yearOf(time, calendar) === yearOf(now, calendar);
  const formats = FORMATS[calendar];
  const formatter = sameYear ? formats.month : formats.monthYear;
  return formatter.format(time);
}

/**
 * A row's time under a day heading, without repeating it: the time of day under Today and Yesterday ("4:55 PM"),
 * the date and time under older headings ("Oct 3, 4:55 PM"; with the year when it isn't this one).
 * UTC English is stable through hydration; local formatting follows once the browser has taken over.
 */
export function feedTime(iso: string, now = Date.now(), calendar: FeedCalendar = 'local') {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return '';
  const label = dayLabel(iso, now, calendar);
  const recent = label === 'Today' || label === 'Yesterday';
  const sameYear = yearOf(time, calendar) === yearOf(now, calendar);
  const formats = FORMATS[calendar];
  let formatter = sameYear ? formats.date : formats.dateYear;
  if (recent) formatter = formats.time;
  // why: Node ICU and Chromium can use different non-breaking spaces for the same English time.
  return formatter.format(time).replace(/[\u00a0\u202f]/g, ' ');
}

export interface FeedGroup<T> {
  label: string;
  items: T[];
}

/** Consecutive items with the same day label, in the given order (works for newest- and oldest-first). */
export function groupByDay<T>(
  items: readonly T[],
  at: (item: T) => string,
  now = Date.now(),
  calendar: FeedCalendar = 'local',
): Array<FeedGroup<T>> {
  const groups: Array<FeedGroup<T>> = [];
  for (const item of items) {
    const label = dayLabel(at(item), now, calendar);
    const last = groups.at(-1);
    if (last?.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

export function errorTotal(summary: Pick<ReplaySummary, 'consoleErrors' | 'failedRequests'>) {
  return summary.consoleErrors + summary.failedRequests;
}

/** The distinct tags on `summaries`, most used first (ties alphabetical): the tag filter's options. */
export function tagOptions(summaries: readonly Pick<ReplaySummary, 'tags'>[]) {
  const counts = new Map<string, number>();
  for (const summary of summaries) for (const tag of summary.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag]) => tag);
}

/** "0:13", "4:05", "1:02:03": a thumbnail's duration badge (whole seconds, like a video player). */
export function formatBadgeDuration(milliseconds: number) {
  const total = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

/** At most this many runs in a suite's run strip; beyond, a "+N" link to the suite. */
export const RUN_STRIP_LIMIT = 8;
const STRIP_GAP_PX = 3;
/** The longest segment is at most this many times the shortest: it reads as "runs" first, lengths second. */
const STRIP_MAX_RATIO = 3;

/**
 * A suite's run strip (one small segment per run, echoing the product mark): which runs show and how wide each
 * is. Failed runs are always kept (that's what you open a suite for), then the rest by sequence, up to
 * RUN_STRIP_LIMIT; they're drawn in sequence order. Widths follow the square root of each run's length, clamped
 * to 3:1 between longest and shortest, within `maxPx` in all (min `minPx` each); a run of unknown length counts
 * as an average one, and without any lengths every segment is the same.
 */
export function runStrip<T extends { status: string; sequence: number }>(
  runs: readonly T[],
  duration: (run: T) => number | undefined,
  { limit = RUN_STRIP_LIMIT, maxPx = 120, minPx = 10 } = {},
) {
  const kept = [...runs]
    .sort((a, b) => Number(b.status === 'failed') - Number(a.status === 'failed') || a.sequence - b.sequence)
    .slice(0, limit)
    .sort((a, b) => a.sequence - b.sequence);
  const more = runs.length - kept.length;
  const known = kept.map((run) => duration(run)).filter((length): length is number => length !== undefined && length > 0);
  const average = known.length ? known.reduce((sum, length) => sum + length, 0) / known.length : 1;
  const weights = kept.map((run) => {
    const length = duration(run);
    return Math.sqrt(length !== undefined && length > 0 ? length : average);
  });
  const lightest = Math.max(...weights, 0) / STRIP_MAX_RATIO;
  const clamped = weights.map((weight) => Math.max(weight, lightest));
  const total = clamped.reduce((sum, weight) => sum + weight, 0);
  const room = maxPx - STRIP_GAP_PX * Math.max(0, kept.length - 1);
  // Never wider than an even share would make a short strip look stretched: cap each at 3× the minimum.
  const scale = total > 0 ? Math.min(room / total, (minPx * STRIP_MAX_RATIO) / Math.max(...clamped)) : 0;
  return {
    segments: kept.map((run, index) => ({ run, width: Math.max(minPx, Math.round(clamped[index]! * scale)) })),
    more,
  };
}
