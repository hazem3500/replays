import type { IncomingMessage, ServerResponse } from 'node:http';

import { PREVIEW_SPEED } from '../../client/render/frames.ts';
import { JSON_TYPE } from '../http/respond.ts';
import { sendJson } from '../http/send.ts';
import { serveObject } from '../serve-object.ts';
import { readJson } from '../storage/index.ts';
import type { ReplayStore } from '../store.ts';
import { MEDIA_TYPE, type MediaKind, type PosterQueue, type PosterState } from './poster-queue.ts';

const MEDIA_CACHE = 'private, max-age=604800';

const MEDIA: Readonly<Record<MediaKind, { key: (store: ReplayStore, id: string) => string; off: string }>> = {
  poster: { key: (store, id) => store.posterKey(id), off: 'posters unavailable' },
  open: { key: (store, id) => store.openStillKey(id), off: 'opening stills unavailable' },
  preview: { key: (store, id) => store.previewKey(id), off: 'previews unavailable' },
};

/** The list media a replay can have, and the queue that makes them (absent: none are made here). */
export interface PosterApiOptions {
  store: ReplayStore;
  posters?: PosterQueue | undefined;
}

interface MediaRequest {
  request: IncomingMessage;
  response: ServerResponse;
  id: string;
  kind: MediaKind;
}

const isMediaKind = (value: string | undefined): value is MediaKind => value === 'poster' || value === 'open' || value === 'preview';

/** why: the preview's sidecar rides along as headers, so the client's HEAD can label a cut-short clip. */
async function previewHeaders(store: ReplayStore, objectKey: string): Promise<Record<string, string>> {
  const meta = await readJson<{ capped?: boolean; coveredMs?: number; speed?: number }>(store.storage, `${objectKey}.json`).catch(
    () => null,
  );
  if (!meta) return {};
  return {
    'x-preview-speed': String(meta.speed ?? PREVIEW_SPEED),
    'x-preview-covers-ms': String(Math.round(meta.coveredMs ?? 0)),
    'x-preview-capped': meta.capped ? '1' : '0',
  };
}

/** Serves the stored file; false when it is not stored yet. With a queue, a poster's key names its chosen moment. */
async function serveStored(media: MediaRequest, options: PosterApiOptions): Promise<boolean> {
  const { request, response, id, kind } = media;
  const { store, posters } = options;
  const objectKey = posters?.supports(kind) ? await posters.key(id, kind) : MEDIA[kind].key(store, id);
  const info = await store.storage.stat(objectKey);
  if (!info) return false;
  const headers = kind === 'preview' ? await previewHeaders(store, objectKey) : {};
  return serveObject(request, response, store.storage, objectKey, MEDIA_CACHE, {
    contentType: MEDIA_TYPE[kind],
    etag: true,
    ranges: kind === 'preview',
    headers,
    info,
  });
}

function sendWaiting(media: MediaRequest, state: Exclude<PosterState, 'ready' | 'failed' | 'off'>): void {
  const full = state === 'full';
  media.response.writeHead(full ? 503 : 202, { 'content-type': JSON_TYPE, 'cache-control': 'no-store', 'retry-after': full ? '30' : '2' });
  media.response.end(media.request.method === 'HEAD' ? undefined : JSON.stringify({ status: full ? 'busy' : 'pending' }));
}

/** Answers with the stored file, else queues it and says when to ask again. */
async function answerMedia(media: MediaRequest, options: PosterApiOptions): Promise<void> {
  const { response, id, kind } = media;
  const { posters } = options;
  if (await serveStored(media, options)) {
    // why: a listed poster means someone is looking at this replay, so its opening still and hover preview are warmed.
    if (kind === 'poster') for (const next of ['open', 'preview'] as const) void posters?.request(id, next).catch(() => null);
    return;
  }
  const state = posters ? await posters.request(id, kind) : 'off';
  if (state === 'off') sendJson(response, 503, { error: MEDIA[kind].off });
  else if (state === 'failed') sendJson(response, 404, { error: `no ${kind} for this replay` });
  else if (state !== 'ready' || !(await serveStored(media, options))) sendWaiting(media, state === 'ready' ? 'pending' : state);
}

/**
 * `GET|HEAD /api/replays/<id>/poster`, `/open` (the opening still) and `/preview` (behind the same auth as the rest of the
 * app): 200 JPEG / MP4 (weak ETag, cached a week; the MP4 supports byte ranges) once stored; 202 + Retry-After while it is
 * generated; 404 for an unknown replay or a job that failed; 503 without Retry-After when the kind is off here (posters: no
 * Chromium or RENDER_DISABLED=1; previews: also no ffmpeg), 503 + Retry-After when the queue is full. The client keeps the
 * poster (or placeholder) for anything but 200.
 */
export async function handlePosterApi(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  options: PosterApiOptions,
): Promise<boolean> {
  const match = /^\/api\/replays\/([a-z0-9][a-z0-9-]{0,79})\/(poster|open|preview)$/.exec(path);
  const [, id, kind] = match ?? [];
  if (id === undefined || !isMediaKind(kind)) return false;
  if (request.method !== 'GET' && request.method !== 'HEAD') sendJson(response, 405, { error: 'method not allowed' });
  else if (!(await options.store.locate(id))) sendJson(response, 404, { error: 'replay not found' });
  else await answerMedia({ request, response, id, kind }, options);
  return true;
}
