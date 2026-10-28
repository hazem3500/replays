import { buildHumanBundle } from '../../capture/human-bundle.ts';
import { parsePeopleFlags } from '../../shared/people.ts';
import { assertReplayTags } from '../../shared/replay.ts';
import { publicPath } from '../base-path.ts';
import { readJsonUpload } from '../http/body.ts';
import { json, REVALIDATE } from '../http/respond.ts';
import { defineRoute } from '../http/route.ts';
import { HttpError } from '../http/errors.ts';
import { runAfterUpload, runBeforeUpload } from '../plugin-runtime.ts';
import type { PurposeCatalog } from '../purposes.ts';
import type { ApiServices } from './services.ts';
import { acceptUpload, MAX_REPLAY_BYTES, replayReceipt, saveWithFreshId, uploadAttributes } from './upload-checks.ts';

/** A trimmed query parameter, or undefined when absent or blank. */
function param(params: URLSearchParams, name: string) {
  const value = params.get(name)?.trim();
  return value === '' ? undefined : value;
}

/** The import's bundle options from its query (`title`, `url`, `id`, `tag`, `purpose`, `person`), checked. */
function importOptions(params: URLSearchParams, purposes: PurposeCatalog) {
  const id = param(params, 'id');
  const url = param(params, 'url');
  const purpose = param(params, 'purpose');
  const tags = params.getAll('tag');
  if (tags.length) assertReplayTags(tags, 'tag');
  const problem = purposes.problem(purpose);
  if (problem) throw new HttpError(400, problem.replace('replay.meta.purpose', 'purpose'));
  const people = parsePeopleFlags(params.getAll('person'), 'person');
  return {
    title: param(params, 'title')?.slice(0, 200) ?? 'Imported recording',
    ...(url ? { url } : {}),
    ...(id ? { id } : {}),
    ...(tags.length ? { tags } : {}),
    ...(purpose ? { purpose } : {}),
    ...(people.length ? { people } : {}),
  };
}

/**
 * `POST /api/replays/import`: plain rrweb JSON in the body, with `title`, `url`, `id`, `tag` and `person`
 * (`role:email[:handle=value]`, both repeatable) as query parameters.
 */
export function importRoute(services: ApiServices) {
  const { deployment, registry } = services;
  const store = deployment.store;
  return defineRoute({
    method: 'POST',
    path: '/api/replays/import',
    async handler({ request, url, base, identity: user, trace, hooks }) {
      const input = await readJsonUpload(request, MAX_REPLAY_BYTES, trace);
      const settings = importOptions(url.searchParams, store.purposes);
      // invariant: the same privacy pass as POST /replays, so query-parameter text (the title) is redacted too.
      const bundle = services.sanitize(buildHumanBundle(input, settings));
      trace(uploadAttributes(bundle));
      const accepted = acceptUpload(await runBeforeUpload(registry, bundle, user, hooks), store.purposes, registry);
      const saved = await saveWithFreshId(store, accepted, Boolean(settings.id));
      trace({ 'replay.id': saved.meta.id });
      void store.pruneSoon();
      await runAfterUpload(registry, saved, user, hooks, publicPath(`/r/${saved.meta.id}`, base));
      return json(201, replayReceipt(base, saved), { cacheControl: REVALIDATE });
    },
  });
}
