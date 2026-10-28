import type { QueryClient } from '@tanstack/react-query';

/**
 * A family of collections that belong to a QueryClient (one per router, so one per server request under SSR), never to
 * the module: each is created on first use for its client and key, and found again after that.
 */
export function collectionFamily<T>(create: (client: QueryClient, key: string) => T) {
  const byClient = new WeakMap<QueryClient, Map<string, T>>();
  return (client: QueryClient, key: string): T => {
    const collections = byClient.get(client) ?? new Map<string, T>();
    byClient.set(client, collections);
    const existing = collections.get(key);
    if (existing) return existing;
    const created = create(client, key);
    collections.set(key, created);
    return created;
  };
}
