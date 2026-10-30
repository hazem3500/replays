import { tracingEnabled, withSpan } from '../tracing.ts';
import type { ListOptions, ObjectStorage } from './types.ts';

/**
 * The storage with a span per operation (`storage.read`, `storage.write`, `storage.list`…) when tracing is on;
 * the storage itself, unwrapped, when it is off. Attributes: the driver (`storage.system`: fs, s3, memory, a plugin's kind),
 * the key (`<id>/replay.json`: replay ids only, never contents), sizes and counts. The wrapper inherits from
 * the driver, so `instanceof FsStorage` and driver-specific helpers keep working.
 */
export function tracedStorage<S extends ObjectStorage>(storage: S): S {
  if (!tracingEnabled()) return storage;
  const system = storage.kind;
  const span = <T>(operation: string, attributes: Record<string, string | number | undefined>, fn: () => Promise<T>) =>
    withSpan(`storage.${operation}`, { 'storage.system': system, 'storage.operation': operation, ...attributes }, fn, {
      kind: system === 'fs' || system === 'memory' ? 'internal' : 'client',
    });
  const traced: ObjectStorage = Object.create(storage) as S;
  Object.assign(traced, {
    stat: (key: string) => span('stat', { 'storage.key': key }, () => storage.stat(key)),
    read: (key: string) =>
      withSpan('storage.read', { 'storage.system': system, 'storage.operation': 'read', 'storage.key': key }, async (handle) => {
        const body = await storage.read(key);
        handle.setAttributes({ 'storage.bytes': body?.byteLength, 'storage.found': body !== undefined });
        return body;
      }),
    // The span covers opening the stream; the body is piped to the response afterwards (the request span covers it).
    stream: (key: string, range?: { start: number; end: number }) =>
      span('stream', { 'storage.key': key, 'storage.range_bytes': range ? range.end - range.start + 1 : undefined }, () =>
        storage.stream(key, range),
      ),
    write: (key: string, body: Buffer | string, options?: Parameters<ObjectStorage['write']>[2]) =>
      span('write', { 'storage.key': key, 'storage.bytes': Buffer.byteLength(body) }, () => storage.write(key, body, options)),
    upload: (key: string, localPath: string, options?: Parameters<ObjectStorage['upload']>[2]) =>
      withSpan('storage.upload', { 'storage.system': system, 'storage.operation': 'upload', 'storage.key': key }, async (handle) => {
        const info = await storage.upload(key, localPath, options);
        handle.setAttributes({ 'storage.bytes': info.size });
        return info;
      }),
    delete: (key: string) => span('delete', { 'storage.key': key }, () => storage.delete(key)),
    deletePrefix: (prefix: string) =>
      withSpan(
        'storage.delete_prefix',
        { 'storage.system': system, 'storage.operation': 'delete_prefix', 'storage.prefix': prefix },
        async (handle) => {
          const count = await storage.deletePrefix(prefix);
          handle.setAttributes({ 'storage.count': count });
          return count;
        },
      ),
    list: (options?: ListOptions) =>
      withSpan(
        'storage.list',
        { 'storage.system': system, 'storage.operation': 'list', 'storage.prefix': options?.prefix, 'storage.glob': options?.glob },
        async (handle) => {
          const objects = await storage.list(options);
          handle.setAttributes({ 'storage.count': objects.length });
          return objects;
        },
      ),
  } satisfies Partial<ObjectStorage>);
  return traced as S;
}
