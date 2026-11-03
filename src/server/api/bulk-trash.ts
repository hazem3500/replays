import { bulkTrashRequestSchema, type BulkTrashResult } from '../../shared/data-storage.ts';
import { parseJsonBody, readBytes } from '../http/body.ts';
import { classifyError } from '../http/errors.ts';
import { json } from '../http/respond.ts';
import { defineRoute } from '../http/route.ts';
import { mapLimited } from '../store/async.ts';
import { activeUploadIds, deletableUploadIds } from './data-storage-listing.ts';
import type { ApiServices } from './services.ts';

/** The same reversible operation as individual DELETE; visibility and delete policy are checked for every upload. */
export function bulkTrashRoutes(services: ApiServices) {
  const { store } = services.deployment;
  return [
    defineRoute({
      method: 'POST',
      path: '/api/data-storage/trash',
      async handler(context) {
        if (!services.canReadReplay || !services.canDeleteReplay) return json(403, { error: 'bulk deletion is not available' });
        const confirmation = bulkTrashRequestSchema.safeParse(parseJsonBody((await readBytes(context.request, 1024)).toString('utf8')));
        if (!confirmation.success) return json(400, { error: 'explicit confirmation is required' });
        const objects = await store.storage.list({ glob: '*/{replay,trash}.json' });
        const ids = await deletableUploadIds(activeUploadIds(objects), context, services);
        const results = await mapLimited(ids, 4, async (id): Promise<keyof BulkTrashResult> => {
          try {
            await store.trash(id, context.identity.id);
            return 'trashed';
          } catch (error) {
            const { status } = classifyError(error);
            if (status === 409) return 'protected';
            if (status === 404) return 'unavailable';
            return 'failed';
          }
        });
        const counts: BulkTrashResult = { trashed: 0, protected: 0, unavailable: 0, failed: 0 };
        for (const result of results) counts[result]++;
        return json(200, counts, { cacheControl: 'no-store' });
      },
    }),
  ];
}
