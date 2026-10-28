import { queryCollectionOptions } from '@tanstack/query-db-collection';
import { createCollection, useLiveQuery } from '@tanstack/react-db';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';

import type { ReplaySummary } from '../../shared/replay.ts';
import { type ServedRetention, servedRetentionSchema } from '../../shared/schemas/retention.ts';
import { INDEX_SESSIONS_KEY } from '../index/index-queries.ts';
import { apiUrl } from '../route.ts';
import { collectionFamily } from './registry.ts';
import { optimistic, wholeRows } from './write.ts';

export type RetentionKind = 'replay' | 'suite';
type RetentionRow = ServedRetention & { id: string };

const QUERY_PREFIX = { replay: 'retention', suite: 'suite-retention' } as const;

/** The Query key a replay's or suite's retention is cached under (the Replay details row reads the same one). */
export const retentionKey = (kind: RetentionKind, id: string) => [QUERY_PREFIX[kind], id] as const;

/** `GET|PUT|DELETE /api/{replays,suites}/<id>/keep` (the path segment is the kind's plural). */
export async function requestRetention(
  kind: RetentionKind,
  id: string,
  method: 'GET' | 'PUT' | 'DELETE',
  signal?: AbortSignal,
): Promise<ServedRetention> {
  const response = await fetch(apiUrl(`${kind}s/${encodeURIComponent(id)}/keep`), { method, ...(signal ? { signal } : {}) });
  if (!response.ok) throw new Error(`Retention failed to load (${response.status})`);
  return servedRetentionSchema.parse(await response.json());
}

const retentionFamily = (kind: RetentionKind) =>
  collectionFamily((client, id) =>
    createCollection(
      wholeRows(
        queryCollectionOptions({
          id: `${QUERY_PREFIX[kind]}:${id}`,
          queryClient: client,
          queryKey: retentionKey(kind, id),
          queryFn: ({ signal }) => requestRetention(kind, id, 'GET', signal),
          select: (retention: ServedRetention): RetentionRow[] => [{ ...retention, id }],
          getKey: (row: RetentionRow) => row.id,
          staleTime: 30_000,
          retry: false,
        }),
      ),
    ),
  );
const families = { replay: retentionFamily('replay'), suite: retentionFamily('suite') };

/**
 * A replay's or suite's retention as a one-row collection over its retention key: Keep / release shows on the frame
 * it is pressed, and lands as the server's answer.
 */
export function retentionCollection(client: QueryClient, kind: RetentionKind, id: string) {
  return families[kind](client, id);
}

/** Index rows that show this replay take the new retention too, so Back shows it without a refetch. */
function patchIndexLists(client: QueryClient, id: string, next: ServedRetention) {
  const apply = (summary: ReplaySummary): ReplaySummary => {
    if (summary.id !== id) return summary;
    const { kept: _kept, ...rest } = summary;
    return { ...rest, ...(next.kept ? { kept: next.kept } : {}), expiresAt: next.expiresAt };
  };
  client.setQueriesData<ReplaySummary[]>({ queryKey: INDEX_SESSIONS_KEY }, (list) => list?.map(apply));
}

export interface KeepChange {
  kind: RetentionKind;
  id: string;
  keep: boolean;
}

/** The row as it shows until the server answers: kept by "you" (no expiry), or released. */
function guess(row: RetentionRow | undefined, { id, keep }: KeepChange, now: string): RetentionRow {
  if (keep) return { ...row, id, kept: { by: 'you', at: now }, expiresAt: null };
  const { kept: _kept, ...rest } = row ?? { id, expiresAt: null };
  return rest;
}

/** Keeps or releases one replay or suite: on screen at once, then the server's answer; a refusal rolls back. */
export function setKept(client: QueryClient, change: KeepChange): Promise<ServedRetention> {
  const { kind, id, keep } = change;
  const rows = retentionCollection(client, kind, id);
  const next = guess(rows.get(id), change, new Date().toISOString());
  return optimistic(
    () => {
      if (rows.has(id)) rows.update(id, (draft) => Object.assign(draft, next, next.kept ? {} : { kept: undefined }));
      else rows.insert(next);
    },
    async () => {
      const landed = await requestRetention(kind, id, keep ? 'PUT' : 'DELETE');
      await rows.utils.writeUpsert({ ...landed, id });
      client.setQueryData(retentionKey(kind, id), landed);
      if (kind === 'replay') patchIndexLists(client, id, landed);
      return landed;
    },
  );
}

/** The live retention of one replay or suite, optimistic changes included; undefined while it loads. */
export function useRetention(kind: RetentionKind, id: string): ServedRetention | undefined {
  const rows = retentionCollection(useQueryClient(), kind, id);
  const live = useLiveQuery({ query: (q) => q.from({ row: rows }), queryKey: ['retention-row', kind, id] });
  const row = live.data.at(0);
  if (!row) return undefined;
  return { expiresAt: row.expiresAt, ...(row.kept ? { kept: row.kept } : {}), ...(row.committed ? { committed: row.committed } : {}) };
}
