import type { IncomingMessage, ServerResponse } from 'node:http';

import { replayMetaPatchSchema } from '../shared/schemas/replay-meta.ts';
import { overridesKey, restoreReplay, trashReplay, updateReplayMeta } from './replay-meta.ts';
import type { ReplayStore } from './store.ts';

/** `/api/replays/<id>`, `/api/replays/<id>/meta` and `/api/replays/<id>/restore`. */
const ROUTE = /^\/api\/replays\/([a-z0-9][a-z0-9-]{0,79})(\/meta|\/restore)?$/;
const MAX_BODY_BYTES = 16 * 1024;
const JSON_TYPE = 'application/json; charset=utf-8';

export interface ReplayMetaContext {
  store: ReplayStore;
  /** The authenticated identity's id: who changed or deleted the replay. */
  user: string;
}

const answer = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': JSON_TYPE, 'cache-control': 'no-store', ...headers } });

/** The routes this module answers; anything else on the path (GET of the bundle, video, keep…) is left to others. */
function owned(method: string, path: string) {
  const match = ROUTE.exec(path);
  if (!match) return null;
  const [, id = '', sub] = match;
  if (!sub && method !== 'DELETE') return null;
  return { id, sub };
}

const statusOf = (error: unknown) => {
  const status = typeof error === 'object' && error !== null && 'status' in error ? error.status : undefined;
  return typeof status === 'number' && status >= 400 && status < 500 ? status : undefined;
};

async function meta(request: Request, id: string, context: ReplayMetaContext): Promise<Response> {
  if (request.method === 'GET' || request.method === 'HEAD') {
    if (!(await context.store.locate(id))) return answer(404, { error: 'replay not found' });
    const overrides = await context.store.sidecars.overrides(id, await context.store.sidecars.stat(overridesKey(id)));
    return answer(200, overrides ?? {}, { 'cache-control': 'private, no-cache' });
  }
  if (request.method !== 'PATCH') return answer(405, { error: 'method not allowed' }, { allow: 'GET, HEAD, PATCH' });
  const patch = replayMetaPatchSchema.safeParse(await request.json().catch(() => null));
  if (!patch.success) {
    const issues = patch.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
    return answer(400, { error: 'invalid replay meta', issues });
  }
  return answer(200, await updateReplayMeta(context.store, id, patch.data, context.user));
}

/**
 * Additive replay writes (docs/api-stability.md): `GET|PATCH /api/replays/<id>/meta` (title, tags, purpose on top of the
 * recorded bundle), `DELETE /api/replays/<id>` (to the trash, restorable for TRASH_DAYS) and `POST /api/replays/<id>/restore`.
 * Web-standard: undefined when the request is not one of these, so the server's other handlers answer it.
 */
export async function replayMetaResponse(request: Request, path: string, context: ReplayMetaContext): Promise<Response | undefined> {
  const route = owned(request.method, path);
  if (!route) return undefined;
  try {
    if (route.sub === '/meta') return await meta(request, route.id, context);
    if (route.sub === '/restore') {
      if (request.method !== 'POST') return answer(405, { error: 'method not allowed' }, { allow: 'POST' });
      return answer(200, await restoreReplay(context.store, route.id));
    }
    return answer(200, await trashReplay(context.store, route.id, context.user));
  } catch (error) {
    const status = statusOf(error);
    if (status === undefined) throw error;
    return answer(status, { error: error instanceof Error ? error.message : 'request refused' });
  }
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.byteLength;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('request body too large'), { status: 413 });
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

/**
 * The Node edge for replayMetaResponse, registered right after the keep routes (behind the auth adapter, scopes and the
 * same-origin check for writes). Returns false when the request is not one of these routes.
 */
export async function handleReplayMetaApi(request: IncomingMessage, response: ServerResponse, path: string, context: ReplayMetaContext) {
  const method = request.method ?? 'GET';
  if (!owned(method, path)) return false;
  const init: RequestInit = { method };
  if (method === 'PATCH') {
    init.body = new Uint8Array(await readBody(request));
    init.headers = { 'content-type': JSON_TYPE };
  }
  const web = new Request(`http://app${path}`, init);
  const reply = await replayMetaResponse(web, path, context);
  if (!reply) return false;
  response.writeHead(reply.status, Object.fromEntries(reply.headers));
  if (method === 'HEAD') response.end();
  else response.end(await reply.text());
  return true;
}
