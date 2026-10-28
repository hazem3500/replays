import { defaultId } from '../../capture/human-bundle.ts';
import type { PluginRegistry } from '../../plugin/registry.ts';
import { replayProfileId, type ReplayBundle, withMetaProfile } from '../../shared/replay.ts';
import { publicPath } from '../base-path.ts';
import { HttpError } from '../http/errors.ts';
import { checkPeople } from '../people.ts';
import type { ProfileCatalog } from '../profiles.ts';
import { ReplayConflictError, type ReplayStore } from '../store.ts';
import { assertUploadBundle } from '../upload-validation.ts';
import type { ApiDeployment } from './services.ts';

export const MAX_REPLAY_BYTES = 25 * 1024 * 1024;

/** What a trace may say about an uploaded replay (tracing.ts): its id, counts and enum fields, never contents. */
export function uploadAttributes(bundle: ReplayBundle) {
  return {
    'replay.id': bundle.meta.id,
    'replay.event_count': bundle.events.length,
    'replay.console_count': bundle.console.length,
    'replay.network_count': bundle.network.length,
    'replay.step_count': bundle.steps.length,
    'replay.source': bundle.meta.source,
    'suite.id': bundle.suiteRun?.suiteId,
    'suite.run_id': bundle.suiteRun?.runId,
  };
}

export function replayReceipt(base: string, bundle: ReplayBundle) {
  return {
    id: bundle.meta.id,
    url: publicPath(`/r/${bundle.meta.id}`, base),
    ...(bundle.suiteRun ? { suiteId: bundle.suiteRun.suiteId, runId: bundle.suiteRun.runId } : {}),
  };
}

/**
 * A bundle that went through `beforeUpload` hooks is checked again: a plugin cannot store an invalid one. Its
 * `meta.profile` must be one the deployment defines (src/server/profiles.ts); with none defined it must be absent.
 * The deprecated `meta.purpose` is accepted and stored as `meta.profile`.
 */
export function acceptUpload(bundle: ReplayBundle, profiles: ProfileCatalog, registry: PluginRegistry): ReplayBundle {
  assertUploadBundle(bundle);
  const profile = replayProfileId(bundle.meta);
  const problem = profiles.problem(profile);
  if (problem) throw new HttpError(400, problem);
  checkPeople(registry, bundle.meta.people, 'replay.meta.people');
  return { ...bundle, meta: withMetaProfile(bundle.meta, profile) };
}

/** Applies the deployment's source providers and context schema to an uploaded bundle (in place). */
export function resolveContext(bundle: Pick<ReplayBundle, 'context'>, deployment: Pick<ApiDeployment, 'sources' | 'contextSchema'>) {
  const context = bundle.context;
  if (!context) return;
  if (context.sources) {
    context.sources = context.sources.map((source, index) => deployment.sources.resolve(source, `replay.context.sources[${index}]`));
  }
  if (context.fields !== undefined && deployment.contextSchema) {
    const problem = deployment.contextSchema.validate(context.fields);
    if (problem) throw new HttpError(400, problem);
  }
}

const withId = (bundle: ReplayBundle, id: string): ReplayBundle => ({ ...bundle, meta: { ...bundle.meta, id } });

/** Saves a bundle and returns what was stored: without a caller-chosen id, it retries with a fresh random id on collision. */
export async function saveWithFreshId(store: ReplayStore, bundle: ReplayBundle, idWasChosen: boolean): Promise<ReplayBundle> {
  let current = bundle;
  for (let attempt = 0; ; attempt++) {
    try {
      await store.save(current);
      return current;
    } catch (error) {
      if (!(error instanceof ReplayConflictError) || idWasChosen || attempt >= 4) throw error;
      const url = /^https?:/i.test(current.meta.url) ? current.meta.url : 'https://recording.invalid/';
      current = withId(current, defaultId(url, new Date(current.meta.capturedAt)));
    }
  }
}

/**
 * Starts the new replay's list poster and hover preview in the background; uploads never wait. The poster job
 * shoots the opening still on the way, so it is not queued separately (a separate job could run first and render
 * twice); a replay whose poster fails still gets its still lazily when `/open` is requested.
 */
export function requestListMedia(deployment: Pick<ApiDeployment, 'posters'>, id: string) {
  const queue = deployment.posters;
  if (!queue) return;
  for (const kind of ['poster', 'preview'] as const)
    void queue.request(id, kind).catch((error: unknown) => console.error(`${kind} ${id}: request failed:`, error));
}
