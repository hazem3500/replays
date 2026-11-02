import type { DehydratedState } from '@tanstack/react-query';
import { z } from 'zod';

import { PRODUCT_SLUG } from '../../shared/brand.ts';

const isDehydrated = (value: unknown): value is DehydratedState =>
  typeof value === 'object' && value !== null && 'queries' in value && Array.isArray(value.queries) && 'mutations' in value;

const persistedRecordSchema = z.object({
  buster: z.string(),
  identity: z.string(),
  savedAt: z.number(),
  state: z.custom<DehydratedState>(isDehydrated),
});

/**
 * What the persisted cache stores: the dehydrated index queries, the `/api/me` id they were fetched as ('' when it was
 * not known), when, and the build they were saved by.
 */
export type PersistedRecord = z.infer<typeof persistedRecordSchema>;

/** Where the persisted cache lives; a record that does not parse reads as none. */
export interface PersistStorage {
  read(): Promise<PersistedRecord | undefined>;
  write(record: PersistedRecord): Promise<void>;
  clear(): Promise<void>;
}

const parsed = (value: unknown) => {
  const record = persistedRecordSchema.safeParse(value);
  return record.success ? record.data : undefined;
};

const settle = (pending: IDBRequest) =>
  new Promise<unknown>((resolve, reject) => {
    pending.addEventListener('success', () => {
      const result: unknown = pending.result;
      resolve(result);
    });
    pending.addEventListener('error', () => reject(pending.error ?? new Error('cache request failed')));
  });

/** One record in the `<slug>-cache` IndexedDB database, store `queries`, key `index`; undefined without IndexedDB. */
export function indexedDbStorage(name = `${PRODUCT_SLUG}-cache`): PersistStorage | undefined {
  if (typeof indexedDB === 'undefined') return undefined;
  let opened: Promise<IDBDatabase> | undefined;
  const database = () =>
    (opened ??= new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open(name, 1);
      open.addEventListener('upgradeneeded', () => open.result.createObjectStore('queries'));
      open.addEventListener('success', () => resolve(open.result));
      open.addEventListener('error', () => reject(open.error ?? new Error('cache database failed to open')));
      open.addEventListener('blocked', () => reject(new Error('cache database blocked')));
    }));
  const store = async (mode: IDBTransactionMode) => (await database()).transaction('queries', mode).objectStore('queries');
  return {
    read: async () => parsed(await settle((await store('readonly')).get('index'))),
    write: async (record) => void (await settle((await store('readwrite')).put(record, 'index'))),
    clear: async () => void (await settle((await store('readwrite')).delete('index'))),
  };
}

/** A PersistStorage in memory: one page's cache, for browsers without IndexedDB and for tests. */
export function memoryStorage(): PersistStorage {
  let record: PersistedRecord | undefined;
  return {
    read: () => Promise.resolve(record ? parsed(structuredClone(record)) : undefined),
    write: (next) => {
      record = structuredClone(next);
      return Promise.resolve();
    },
    clear: () => {
      record = undefined;
      return Promise.resolve();
    },
  };
}
