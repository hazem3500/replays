import type { IncomingMessage, ServerResponse } from 'node:http';

import { REVALIDATE } from '../http/respond.ts';
import { IMMUTABLE_PRIVATE, send } from '../http/send.ts';
import { serveObject } from '../serve-object.ts';
import type { ReplayStore } from '../store.ts';

/** What the replay file routes read: the store, and whether any profile can be inferred. */
export interface ReplayFilesContext {
  store: ReplayStore;
  inferable: boolean;
}

function parseReplayPath(path: string): { id: string; video: boolean } | undefined {
  const match = /^\/api\/replays\/([a-z0-9][a-z0-9-]{0,79})(\/video)?$/.exec(path);
  const id = match?.[1];
  return id === undefined ? undefined : { id, video: match?.[2] !== undefined };
}

/**
 * `x-replay-profile: <id>; inferred` for a replay whose profile was inferred (explicit ones are in the bundle), and the
 * same value under its deprecated name `x-replay-purpose`.
 */
async function servedProfile(store: ReplayStore, id: string): Promise<Record<string, string> | undefined> {
  const summary = await store.summary(id, { suites: false }).catch(() => null);
  if (!summary?.profile || !summary.profileInferred) return;
  const value = `${summary.profile}; inferred`;
  return { 'x-replay-profile': value, 'x-replay-purpose': value };
}

/**
 * Bundles are validated on save (samples are committed), so the stored file is served as-is: no parse/stringify, cached
 * compression. Uploads are immutable, so the browser keeps them for a day; committed samples can change with a deploy, so
 * they revalidate (ETag). An inferred profile is not in the bundle: the viewer reads it from a header.
 */
async function serveBundle(request: IncomingMessage, response: ServerResponse, id: string, context: ReplayFilesContext) {
  const located = await context.store.locate(id);
  const headers = located && context.inferable ? await servedProfile(context.store, id) : undefined;
  const served =
    located &&
    (await serveObject(request, response, located.storage, located.key, located.uploaded ? IMMUTABLE_PRIVATE : REVALIDATE, {
      contentType: 'application/json; charset=utf-8',
      etag: true,
      info: located.info,
      ...(headers ? { headers } : {}),
    }));
  if (!served) send(response, 404, 'replay not found');
}

/** why: HEAD lets the viewer confirm a stored MP4 exists before it offers the download. */
async function serveVideo(request: IncomingMessage, response: ServerResponse, id: string, store: ReplayStore) {
  const headers = { 'content-disposition': `attachment; filename="${id}.mp4"` };
  if (!(await serveObject(request, response, store.storage, store.videoKey(id), 'private, max-age=3600', { headers })))
    send(response, 404, 'video not found');
}

/** `GET /api/replays/<id>` (the bundle) and `GET|HEAD /api/replays/<id>/video`; false for any other request. */
export async function handleReplayFiles(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  context: ReplayFilesContext,
): Promise<boolean> {
  const replay = parseReplayPath(path);
  if (!replay) return false;
  if (!replay.video && request.method === 'GET') {
    await serveBundle(request, response, replay.id, context);
    return true;
  }
  if (replay.video && (request.method === 'GET' || request.method === 'HEAD')) {
    await serveVideo(request, response, replay.id, context.store);
    return true;
  }
  return false;
}
