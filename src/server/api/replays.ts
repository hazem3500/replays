import { personMatch } from '../../shared/people.ts';
import { isPurposeId } from '../../shared/purposes.ts';
import { isReplayTag, type ReplayFilters } from '../../shared/replay.ts';
import { readBytes } from '../http/body.ts';
import { compressed, json, text } from '../http/respond.ts';
import { defineRoute } from '../http/route.ts';
import { decorateSummary, forMeQuery } from '../people.ts';
import { applyIndexFilters } from '../summary-fields.ts';
import type { ApiServices } from './services.ts';

export const REPLAY_ID = /[a-z0-9][a-z0-9-]{0,79}/;

export function replayFilters(params: URLSearchParams): ReplayFilters {
  const filters: ReplayFilters = {};
  const q = params.get('q')?.trim().slice(0, 200);
  if (q) filters.q = q;
  const host = params.get('host')?.trim().slice(0, 253);
  if (host) filters.host = host;
  if (['1', 'true'].includes(params.get('errors') ?? '')) filters.errors = true;
  const source = params.get('source');
  if (source === 'agent' || source === 'human') filters.source = source;
  const tag = params.get('tag');
  if (isReplayTag(tag)) filters.tag = tag;
  const purpose = params.get('purpose');
  if (isPurposeId(purpose)) filters.purpose = purpose;
  return filters;
}

/** The replay list (`GET /api/replays`) and a replay's MP4 upload (`PUT /api/replays/<id>/video`). */
export function replayRoutes(services: ApiServices) {
  const { deployment, registry } = services;
  const roles = registry.people?.value.roles;
  return [
    defineRoute({
      method: 'GET',
      path: '/api/replays',
      async handler({ request, url, identity: user }) {
        const me = forMeQuery(registry, url.searchParams, user);
        // invariant: core filters (store.ts) run before the plugins' `api.indexFilter`s.
        const summaries = applyIndexFilters(
          registry.indexFilters,
          url.searchParams,
          await deployment.store.list(replayFilters(url.searchParams)),
        );
        const body = me
          ? summaries.flatMap((summary) => {
              const reason = personMatch(summary.people, me, roles);
              return reason ? [{ ...decorateSummary(registry, summary), reason }] : [];
            })
          : summaries.map((summary) => decorateSummary(registry, summary));
        return compressed(request, 200, JSON.stringify(body));
      },
    }),
    defineRoute({
      method: 'PUT',
      path: '/api/replays/:id/video',
      params: { id: REPLAY_ID },
      async handler({ request, params, trace }) {
        if (!(await deployment.store.locate(params.id))) return text(404, 'upload the replay before its video');
        const video = await readBytes(request, 100 * 1024 * 1024);
        trace({ 'http.request.body.size': video.byteLength });
        await deployment.store.saveVideo(params.id, video);
        return json(201, { id: params.id });
      },
    }),
  ];
}
