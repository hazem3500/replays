import type { ReplayContext, ReplaySourceInput } from '../../shared/context.ts';
import { publicPath } from '../base-path.ts';
import { readJsonUpload } from '../http/body.ts';
import { json, REVALIDATE } from '../http/respond.ts';
import { defineRoute, type RouteContext } from '../http/route.ts';
import { HttpStatusError } from '../http/status-error.ts';
import { assertUploadBundle, assertUploadEnvelope } from '../upload-validation.ts';
import { applyContextAdapters, runAfterUpload, runBeforeUpload, runPrepareUpload } from '../plugin-runtime.ts';
import { importRoute } from './import.ts';
import type { ApiServices } from './services.ts';
import { acceptUpload, MAX_REPLAY_BYTES, replayReceipt, requestListMedia, resolveContext, uploadAttributes } from './upload-checks.ts';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The raw upload with the context adapters applied; anything that is not an object is returned as-is, for validation to refuse. */
async function applyAdapters(services: ApiServices, replay: unknown, { identity, legacy }: RouteContext): Promise<unknown> {
  if (!isRecord(replay)) return replay;
  const raw = isContextShape(replay.context) ? replay.context : undefined;
  const adapted = await applyContextAdapters(services.registry, raw, { kind: 'replay', identity, request: legacy.request });
  return adapted ? { ...replay, context: adapted } : replay;
}

/** The upload with its context's source references resolved into links. */
function resolveSources(services: ApiServices, replay: unknown): unknown {
  const context = isRecord(replay) ? replay.context : undefined;
  if (!isRecord(replay) || !isRecord(context) || !Array.isArray(context.sources)) return replay;
  const sources = context.sources.map((source: unknown, index) => resolveSource(services, source, index));
  return { ...replay, context: { ...context, sources } };
}

/** An object where a context belongs: what the adapters receive, before validation checks its fields. */
const isContextShape = (value: unknown): value is ReplayContext => isRecord(value);

/** A source as uploaded: `resolve()` checks its fields and throws the client's message for anything malformed. */
const isSourceShape = (value: unknown): value is ReplaySourceInput => isRecord(value);

function resolveSource(services: ApiServices, source: unknown, index: number) {
  const name = `replay.context.sources[${index}]`;
  if (!isSourceShape(source)) throw new HttpStatusError(400, `${name} must be an object`);
  return services.deployment.sources.resolve(source, name);
}

/** `POST /api/replays` and the plugins' aliases: hooks, the privacy pass and validation, then the store. */
function uploadHandler(services: ApiServices) {
  const { deployment, registry } = services;
  const store = deployment.store;
  return async (context: RouteContext) => {
    const { request, path, base, identity: user, trace, legacy } = context;
    const endpoint = registry.uploadEndpoints.get(path)?.value;
    const body = await readJsonUpload(request, MAX_REPLAY_BYTES, trace);
    const prepared = endpoint?.prepare ? await endpoint.prepare({ body, identity: user, request: legacy.request }) : body;
    assertUploadEnvelope(prepared);
    const hooked = await runPrepareUpload(registry, prepared, user, legacy.request);
    assertUploadEnvelope(hooked);
    const adapted = await applyAdapters(services, hooked, context);
    assertUploadEnvelope(adapted);
    // invariant: references resolve into links before validation; the stored shape always has a link.
    const replay = resolveSources(services, adapted);
    assertUploadBundle(replay);
    resolveContext(replay, deployment);
    // invariant: stored data never depends on the uploader having sanitized it.
    const bundle = acceptUpload(await runBeforeUpload(registry, services.sanitize(replay), user, legacy.request), store.purposes, registry);
    trace(uploadAttributes(bundle));
    if (bundle.suiteRun) {
      await store.assertSuiteRunCanAttach(bundle.suiteRun.suiteId, bundle.suiteRun.runId, bundle.meta.id);
      const existing = await store.load(bundle.meta.id);
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(bundle)) throw new HttpStatusError(409, 'replay already exists');
        await store.attachReplay(bundle.suiteRun.suiteId, bundle.suiteRun.runId, bundle);
        return json(200, replayReceipt(base, bundle), { cacheControl: REVALIDATE });
      }
    }
    await store.save(bundle);
    if (bundle.suiteRun) await store.attachReplay(bundle.suiteRun.suiteId, bundle.suiteRun.runId, bundle);
    requestListMedia(deployment, bundle.meta.id);
    void store.pruneSoon();
    await runAfterUpload(registry, bundle, user, legacy.request, publicPath(`/r/${bundle.meta.id}`, base));
    return json(201, replayReceipt(base, bundle), { cacheControl: REVALIDATE });
  };
}

/** `POST /api/replays`, the plugins' upload aliases (`api.uploadEndpoint`) and `POST /api/replays/import`. */
export function uploadRoutes(services: ApiServices) {
  const upload = uploadHandler(services);
  return [
    defineRoute({ method: 'POST', path: '/api/replays', handler: upload }),
    ...[...services.registry.uploadEndpoints.keys()].map((path) => defineRoute({ method: 'POST', path, handler: upload })),
    importRoute(services),
  ];
}
