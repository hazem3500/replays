import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import type { Retention } from '../../shared/retention.ts';
import { requestRetention, retentionKey, setKept, useRetention } from '../data/retention.ts';
import { notify } from '../toast.ts';

/** `GET /api/replays/<id>/keep`; `committed` marks a sample shipped with the app (never expires, cannot be kept). */
export type ReplayRetention = Retention & { committed?: boolean };

/** When the replay expires and who kept it; refreshed in the background (another person may keep it). */
export const retentionQuery = (id: string) =>
  queryOptions({
    queryKey: retentionKey('replay', id),
    queryFn: ({ signal }) => requestRetention('replay', id, 'GET', signal),
    staleTime: 30_000,
    retry: false,
  });

/** `GET /api/suites/<id>/keep`: a kept suite keeps all its runs (the server applies it to their replays). */
export const suiteRetentionQuery = (id: string) =>
  queryOptions({
    queryKey: retentionKey('suite', id),
    queryFn: ({ signal }) => requestRetention('suite', id, 'GET', signal),
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

/**
 * The replay's retention plus a Keep / release switch with a toast. The switch flips on the frame it is pressed
 * (data/retention.ts) and rolls back if the server refuses; the Replay details row shares the cache.
 */
export function useKeep(id: string) {
  const client = useQueryClient();
  const retention = useRetention('replay', id);
  const mutation = useMutation({
    mutationFn: (keep: boolean) => setKept(client, { kind: 'replay', id, keep }),
    onSuccess: (next, keep) => {
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
  const retention = useRetention('suite', id);
  const mutation = useMutation({
    mutationFn: (keep: boolean) => setKept(client, { kind: 'suite', id, keep }),
    onSuccess: (next, keep) => {
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
