import { queryOptions } from '@tanstack/react-query';

import { type ExpiredReplay, type ExpiredReplays, parseExpiredReplays } from '../../shared/expired.ts';
import type { ProfileInfo } from '../../shared/profiles.ts';
import { plural } from '../plural.ts';
import { apiUrl } from '../route.ts';
import { fetchPage } from '../sign-in.tsx';

/** `GET /api/expired-replays`; a server without it (older, or keeping no records) reads as none. */
async function fetchExpiredReplays(signal: AbortSignal): Promise<ExpiredReplays> {
  const response = await fetchPage(apiUrl('expired-replays'), { signal });
  const body: unknown = response.ok ? await response.json().catch(() => null) : null;
  return parseExpiredReplays(body);
}

export const expiredReplaysQuery = queryOptions({
  queryKey: ['expired-replays'] as const,
  queryFn: ({ signal }) => fetchExpiredReplays(signal),
  staleTime: 5 * 60_000,
});

/** Records the index shows: those matching the search text and the chosen profile. */
export function visibleExpired(replays: readonly ExpiredReplay[], filter: { query: string; profile: string | undefined }) {
  const needle = filter.query.trim().toLowerCase();
  return replays.filter(
    (record) =>
      (!filter.profile || record.profile === filter.profile) &&
      (!needle || [record.title, record.host, record.id].some((value) => value.toLowerCase().includes(needle))),
  );
}

const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/** "Removed Oct 20 after 90 days, the Triage window": when, and which retention window did it. */
export function expiredReason(record: ExpiredReplay, profiles: readonly ProfileInfo[]) {
  const label = profiles.find((profile) => profile.id === record.profile)?.label;
  const window = plural(record.retentionDays, 'day');
  return `Removed ${shortDate(record.expiredAt)} after ${window}${label ? `, the ${label} window` : ''}`;
}

export const recordedOn = (record: ExpiredReplay) => `Recorded ${shortDate(record.capturedAt)}`;
