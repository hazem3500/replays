import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import type { Retention } from '../../shared/retention.ts';
import { apiUrl } from '../route.ts';
import { notify } from '../toast.ts';

/** `GET /api/replays/<id>/keep`; `committed` marks a sample shipped with the app (never expires, cannot be kept). */
export type ReplayRetention = Retention & { committed?: boolean };

async function request(
  id: string,
  method: 'GET' | 'PUT' | 'DELETE',
  signal?: AbortSignal,
  kind: 'replays' | 'suites' = 'replays',
): Promise<ReplayRetention> {
  const response = await fetch(apiUrl(`${kind}/${encodeURIComponent(id)}/keep`), { method, ...(signal ? { signal } : {}) });
  if (!response.ok) throw new Error(`Retention failed to load (${response.status})`);
  return (await response.json()) as ReplayRetention;
}

/** When the replay expires and who kept it; refreshed in the background (another person may keep it). */
export const retentionQuery = (id: string) =>
  queryOptions({
    queryKey: ['retention', id] as const,
    queryFn: ({ signal }) => request(id, 'GET', signal),
    staleTime: 30_000,
    retry: false,
  });

/** `GET /api/suites/<id>/keep`: a kept suite keeps all its runs (the server applies it to their replays). */
export const suiteRetentionQuery = (id: string) =>
  queryOptions({
    queryKey: ['suite-retention', id] as const,
    queryFn: ({ signal }) => request(id, 'GET', signal, 'suites'),
    staleTime: 30_000,
    retry: false,
  });

/** Whole days until `iso`, at least 0. */
export function daysUntil(iso: string, now = Date.now()) {
  return Math.max(0, Math.ceil((Date.parse(iso) - now) / 86_400_000));
}

/** "Expires in 12 days", "Expires today", "Kept by a-user", "Doesn't expire". */
export function retentionLabel(retention: Retention, now = Date.now()) {
  if (retention.kept) return `Kept by ${retention.kept.by}`;
  if (!retention.expiresAt) return 'Doesn’t expire';
  const days = daysUntil(retention.expiresAt, now);
  if (days === 0) return 'Expires today';
  return `Expires in ${days} ${days === 1 ? 'day' : 'days'}`;
}

/** The replay's retention plus a Keep / release switch with a toast; the Replay details row shares the cache. */
export function useKeep(id: string) {
  const client = useQueryClient();
  const { data: retention } = useQuery(retentionQuery(id));
  const mutation = useMutation({
    mutationFn: (keep: boolean) => request(id, keep ? 'PUT' : 'DELETE'),
    onSuccess: (next, keep) => {
      client.setQueryData(retentionQuery(id).queryKey, next);
      if (keep) notify('Kept', 'success', 'This replay won’t expire.');
      else notify('No longer kept', 'info', next.expiresAt ? `${retentionLabel(next)}.` : undefined);
    },
    onError: (_error, keep) => notify(keep ? 'Could not keep this replay' : 'Could not release this replay', 'error'),
  });
  const { mutate } = mutation;
  const kept = Boolean(retention?.kept);
  const flip = useCallback(() => mutate(!kept), [mutate, kept]);
  return {
    retention,
    kept,
    /** False only for committed samples; shown (as "Keep") while the state loads, so the menu never reshuffles. */
    available: !retention?.committed,
    pending: mutation.isPending,
    flip,
  };
}

/**
 * The suite's Keep / release switch (`PUT|DELETE /api/suites/<id>/keep`). One suite record covers every run, those
 * still to come included, and releasing it leaves runs someone kept one by one kept; the runs' retention and the
 * suite's run list refetch, so Replay details shows the new state.
 */
export function useKeepSuite(id: string) {
  const client = useQueryClient();
  const { data: retention } = useQuery(suiteRetentionQuery(id));
  const mutation = useMutation({
    mutationFn: (keep: boolean) => request(id, keep ? 'PUT' : 'DELETE', undefined, 'suites'),
    onSuccess: (next, keep) => {
      client.setQueryData(suiteRetentionQuery(id).queryKey, next);
      void client.invalidateQueries({ queryKey: ['retention'] });
      void client.invalidateQueries({ queryKey: ['suite', id] });
      if (keep) notify('Suite kept', 'success', 'This suite and its runs won’t expire.');
      else notify('Suite no longer kept', 'info', next.expiresAt ? `${retentionLabel(next)}.` : undefined);
    },
    onError: (_error, keep) => notify(keep ? 'Could not keep this suite' : 'Could not release this suite', 'error'),
  });
  const { mutate } = mutation;
  const kept = Boolean(retention?.kept);
  const flip = useCallback(() => mutate(!kept), [mutate, kept]);
  return { retention, kept, pending: mutation.isPending, flip };
}
