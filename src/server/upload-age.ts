import { type ObjectInfo, type ObjectStorage, readJson } from './storage/types.ts';

/** Server-owned migration metadata, never accepted from a replay or suite request body. */
export function uploadAgeKey(key: string) {
  return key.endsWith('/replay.json') ? key.replace(/replay\.json$/, 'upload-age.json') : key.replace(/\.json$/, '.upload-age.json');
}

/** A migration can preserve age or shorten it, never extend it beyond the storage upload time. */
export async function serverUploadMs(storage: ObjectStorage, info: ObjectInfo): Promise<number> {
  const age = await readJson<{ version?: unknown; uploadedMs?: unknown }>(storage, uploadAgeKey(info.key));
  return age?.version === 1 && typeof age.uploadedMs === 'number' && Number.isFinite(age.uploadedMs) && age.uploadedMs >= 0
    ? Math.min(info.createdMs, age.uploadedMs)
    : info.createdMs;
}
