import { dehydrate, hydrate, type QueryClient } from '@tanstack/react-query';
import * as z from 'zod/mini';

import { PRODUCT_SLUG } from '../../shared/brand.ts';
import { SUMMARY_VERSION } from '../../shared/replay.ts';
import { apiUrl } from '../api/fetch.ts';
import { forgetSessionKeys } from '../storage.ts';
import { indexedDbStorage, type PersistedRecord, type PersistStorage } from './persist-storage.ts';

export { memoryStorage, type PersistedRecord, type PersistStorage } from './persist-storage.ts';

export interface PersistOptions {
  storage?: PersistStorage | undefined;
  /** The signed-in identity's id, `null` when signed out; rejects when it cannot be told. */
  identity?: () => Promise<string | null>;
  /** How long a restore may hold the first render, ms. */
  readTimeoutMs?: number;
  now?: () => number;
}

const BUSTER = `2.${SUMMARY_VERSION}`;
const MAX_AGE_MS = 24 * 60 * 60_000;
const MAX_LISTS = 10;
const MAX_CHARS = 8_000_000;
const SAVE_DELAY_MS = 250;
const READ_TIMEOUT_MS = 50;
/** The tab-only caches IndexedDB replaced (`<slug>-index-cache` stays: the index's Back cache still uses it). */
const LEGACY_SESSION_KEYS = [`${PRODUCT_SLUG}-index-queries`, `${PRODUCT_SLUG}-index-lists`];

const meSchema = z.looseObject({ id: z.optional(z.string()) });
const isIndexQuery = (key: unknown) => Array.isArray(key) && key[0] === 'index';
const ignore = () => {};

/** `GET /api/me`'s id (`''` without one); `null` on 401/403; rejects when unreachable. */
async function fetchIdentity(): Promise<string | null> {
  const response = await fetch(apiUrl('me'), { headers: { 'x-requested-with': 'XMLHttpRequest' } });
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) throw new Error(`Identity failed to load (${response.status})`);
  return meSchema.parse(await response.json()).id ?? '';
}

function storageFor(options: PersistOptions) {
  if ('storage' in options) return options.storage;
  return typeof window === 'undefined' ? undefined : indexedDbStorage();
}

/** The index lists that are worth keeping: newest first, at most MAX_LISTS and MAX_CHARS of data. */
function snapshot(client: QueryClient) {
  const state = dehydrate(client, { shouldDehydrateQuery: (query) => isIndexQuery(query.queryKey) && query.state.status === 'success' });
  let chars = 0;
  const queries = state.queries
    .toSorted((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt)
    .filter((query, index) => {
      chars += JSON.stringify(query.state.data ?? null).length;
      return index < MAX_LISTS && chars <= MAX_CHARS;
    });
  return { ...state, queries };
}

/**
 * Restore hydrates a fresh record of this build, then drops it in the background if it belongs to someone else; save
 * keeps the index lists for whoever is signed in, and drops them once nobody is.
 */
function persister(client: QueryClient, storage: PersistStorage, options: PersistOptions) {
  const now = options.now ?? Date.now;
  let identity: Promise<string | null> | undefined;
  const whoAmI = () => (identity ??= (options.identity ?? fetchIdentity)());
  const drop = async () => {
    client.removeQueries({ predicate: (query) => isIndexQuery(query.queryKey) });
    await storage.clear().catch(ignore);
  };
  return {
    restore: async () => {
      const record = await storage.read();
      if (!record) return;
      if (record.buster !== BUSTER || now() - record.savedAt > MAX_AGE_MS) return storage.clear();
      hydrate(client, record.state);
      void whoAmI().then(async (current) => {
        if (current !== record.identity) await drop();
      }, ignore);
    },
    save: async () => {
      const current = await whoAmI().catch(() => '');
      if (current === null) return drop();
      const record: PersistedRecord = { buster: BUSTER, identity: current, savedAt: now(), state: snapshot(client) };
      return storage.write(record);
    },
  };
}

const persisted = new WeakMap<QueryClient, Promise<void>>();

/**
 * The one persisted cache: the QueryClient's index lists (`['index', …]`), kept in IndexedDB for a day per signed-in
 * identity and build, so a revisit (a new tab, tomorrow) paints from them. TanStack DB's Query collections read the
 * same keys, so they are restored too. Waits at most `readTimeoutMs` (a slower read still hydrates when it lands,
 * never over fresher data), then keeps the lists saved. Await it before the first render.
 */
export function persistIndexQueries(client: QueryClient, options: PersistOptions = {}): Promise<void> {
  const existing = persisted.get(client);
  if (existing) return existing;
  const storage = storageFor(options);
  if (!storage) {
    persisted.set(client, Promise.resolve());
    return Promise.resolve();
  }
  forgetSessionKeys(LEGACY_SESSION_KEYS);
  const { restore, save } = persister(client, storage, options);
  let timer: ReturnType<typeof setTimeout> | undefined;
  client.getQueryCache().subscribe((event) => {
    const key: unknown = event.query.queryKey;
    if (event.type !== 'updated' || event.action.type !== 'success' || !isIndexQuery(key)) return;
    clearTimeout(timer);
    timer = setTimeout(() => void save().catch(ignore), SAVE_DELAY_MS);
  });
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, options.readTimeoutMs ?? READ_TIMEOUT_MS));
  const ready = Promise.race([restore().catch(ignore), timeout]);
  persisted.set(client, ready);
  return ready;
}
