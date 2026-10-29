import { replayMetaPatchSchema } from '../../shared/schemas/replay-meta.ts';
import { parseJsonBody, readBytes } from '../http/body.ts';
import { json } from '../http/respond.ts';
import { defineRoute } from '../http/route.ts';
import { decorateSummary } from '../people.ts';
import { REPLAY_ID } from './replays.ts';
import type { ApiServices } from './services.ts';

const MAX_BODY = 16 * 1024;

/**
 * Additive replay writes, behind the same authentication, same-origin check and request policy as every core route:
 *
 *   PATCH  /api/replays/<id>/meta     { title?, tags?, profile? | null } → 200, the summary as the list shows it
 *   DELETE /api/replays/<id>          soft delete → 200 { trashed: { by, at }, restorableUntil }; 409 while kept
 *   POST   /api/replays/<id>/restore  → 200, the summary; 404 when it is not deleted
 *
 * Bundles stay immutable: changes live in `<id>/overrides.json` and `<id>/trash.json` (store.ts).
 */
export function replayMetaRoutes(services: ApiServices) {
  const { deployment, registry } = services;
  const { store } = deployment;
  return [
    defineRoute({
      method: 'PATCH',
      path: '/api/replays/:id/meta',
      params: { id: REPLAY_ID },
      async handler({ request, params, identity }) {
        const patch = replayMetaPatchSchema.safeParse(parseJsonBody((await readBytes(request, MAX_BODY)).toString('utf8')));
        if (!patch.success)
          return json(400, {
            error: 'invalid replay meta',
            issues: patch.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
          });
        return json(200, decorateSummary(registry, await store.updateMeta(params.id, patch.data, identity.id)));
      },
    }),
    defineRoute({
      method: 'DELETE',
      path: '/api/replays/:id',
      params: { id: REPLAY_ID },
      async handler({ params, identity }) {
        return json(200, await store.trash(params.id, identity.id));
      },
    }),
    defineRoute({
      method: 'POST',
      path: '/api/replays/:id/restore',
      params: { id: REPLAY_ID },
      async handler({ params }) {
        return json(200, decorateSummary(registry, await store.restore(params.id)));
      },
    }),
  ];
}
