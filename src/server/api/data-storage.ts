import type { DataStorageInfo } from '../../shared/data-storage.ts';
import { DEFAULT_EXPIRED_DAYS } from '../../shared/expired.ts';
import { TRASH_DAYS } from '../../shared/schemas/replay-meta.ts';
import { json } from '../http/respond.ts';
import { defineRoute } from '../http/route.ts';
import { parseTrash, trashExpiryMs } from '../replay-meta.ts';
import { readJson } from '../storage/types.ts';
import { mapLimited } from '../store/async.ts';
import { REPLAY_ID, replayKey } from '../store/keys.ts';
import { activeUploadIds, deletableUploadIds } from './data-storage-listing.ts';
import type { ApiServices } from './services.ts';

/** Protected policy metadata with no filesystem paths, bucket names, credentials or uploader inference. */
export function dataStorageRoutes(services: ApiServices) {
  const {
    deployment: { store },
    canReadReplay,
  } = services;
  return [
    defineRoute({
      method: 'GET',
      path: '/api/data-storage',
      async handler(context) {
        const { hooks, identity, base } = context;
        const policy = store.retention;
        const objects = canReadReplay ? await store.storage.list({ glob: '*/{replay,trash}.json' }) : [];
        const deletable = await deletableUploadIds(activeUploadIds(objects), context, services);
        const records = await mapLimited(objects, 8, async (object) => {
          const [id, file] = object.key.split('/');
          if (!id || file !== 'trash.json' || !REPLAY_ID.test(id) || !(await canReadReplay?.(hooks, identity, id, base))) return [];
          const marker = parseTrash(await readJson(store.storage, object.key));
          if (!marker || !(await store.storage.stat(replayKey(id)))) return [];
          return [
            {
              id,
              deletedAt: new Date(object.updatedMs).toISOString(),
              restorableUntil: new Date(trashExpiryMs(object.updatedMs)).toISOString(),
            },
          ];
        });
        const body: DataStorageInfo = {
          backend: store.storage.kind,
          replayCount: deletable.length,
          retention: {
            days: policy.days,
            profiles: policy.profiles ?? {},
            hasRules: Boolean(policy.rules?.length),
            expiredDays: policy.expiredDays ?? DEFAULT_EXPIRED_DAYS,
            trashDays: TRASH_DAYS,
          },
          trash: records.flat().sort((a, b) => b.deletedAt.localeCompare(a.deletedAt)),
        };
        return json(200, body, { cacheControl: 'no-store' });
      },
    }),
  ];
}
