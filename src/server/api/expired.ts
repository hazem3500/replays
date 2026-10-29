import { compressed } from '../http/respond.ts';
import { defineRoute } from '../http/route.ts';
import type { ApiServices } from './services.ts';

/**
 * `GET /api/expired-replays`: replays retention removed, for `RETENTION_EXPIRED_DAYS` after the removal
 * (src/shared/expired.ts). Read-only and behind the same authentication as the list, which showed the same fields.
 */
export function expiredRoutes({ deployment }: ApiServices) {
  return [
    defineRoute({
      method: 'GET',
      path: '/api/expired-replays',
      async handler({ request }) {
        return compressed(request, 200, JSON.stringify(await deployment.store.expiredReplays()));
      },
    }),
  ];
}
