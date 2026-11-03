import type { RouteContext } from '../http/route.ts';
import type { ObjectInfo } from '../storage/types.ts';
import { mapLimited } from '../store/async.ts';
import { REPLAY_ID } from '../store/keys.ts';
import type { ApiServices } from './services.ts';

/** Only actual upload bundles are candidates; committed samples and existing trash are excluded. */
export function activeUploadIds(objects: readonly ObjectInfo[]): string[] {
  const trash = new Set(
    objects.filter((object) => object.key.endsWith('/trash.json')).map((object) => object.key.slice(0, -'/trash.json'.length)),
  );
  return objects.flatMap((object) => {
    if (!object.key.endsWith('/replay.json')) return [];
    const id = object.key.slice(0, -'/replay.json'.length);
    return REPLAY_ID.test(id) && !trash.has(id) ? [id] : [];
  });
}

/** Resolve all authorization before starting mutations, so an authorization service failure cannot create a partial operation. */
export async function deletableUploadIds(
  ids: readonly string[],
  context: RouteContext,
  { canReadReplay, canDeleteReplay }: Pick<ApiServices, 'canReadReplay' | 'canDeleteReplay'>,
): Promise<string[]> {
  if (!canReadReplay || !canDeleteReplay) return [];
  const allowed = await mapLimited(ids, 4, async (id) => {
    if (!(await canReadReplay(context.hooks, context.identity, id, context.base))) return [];
    return (await canDeleteReplay(context.hooks, context.identity, id, context.base)) ? [id] : [];
  });
  return allowed.flat();
}
