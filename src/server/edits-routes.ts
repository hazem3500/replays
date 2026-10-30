import type { IncomingMessage, ServerResponse } from 'node:http';

import { sanitizeUrlFields } from '../capture/sanitize.ts';
import type { StoredReplayEdits } from '../shared/edits.ts';
import { REVALIDATE } from './http/respond.ts';
import { notModified, sendJson } from './http/send.ts';
import { parseJsonBody } from './http/body.ts';
import type { EditingSettings } from './editing-config.ts';
import type { ReplayStore } from './store.ts';

/** An edit list is a few KB; this leaves room for a full one (200 cuts with labels) and nothing more. */
const MAX_EDITS_BYTES = 256 * 1024;

/** The edit list's validator: its storage version (generation / mtime), or `none` before the first save. */
export function editsEtag(version: string | undefined) {
  return `"e.${version ?? 'none'}"`;
}

/** The storage version an `If-Match` names: null for `"e.none"`, undefined when the header is not one of ours. */
export function versionFromEtag(header: string | undefined): string | null | undefined {
  const match = /^(?:W\/)?"e\.([^"]+)"$/.exec(header?.trim() ?? '');
  if (!match) return undefined;
  return match[1] === 'none' ? null : match[1];
}

async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_EDITS_BYTES) throw Object.assign(new Error('edit list too large'), { status: 413 });
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function sendEdits(response: ServerResponse, status: number, body: unknown, version: string | undefined) {
  sendJson(response, status, body, { cacheControl: REVALIDATE, headers: { etag: editsEtag(version) } });
}

/**
 * `GET|PUT /api/replays/<id>/edits`: the replay's non-destructive edit list (src/shared/edits.ts), behind the auth
 * adapter like the rest of the app (and the same-origin check for writes). Only mounted with the beta editor flag
 * (`REPLAYS_BETA_EDITOR=true`, see src/server/config.ts); without it these paths are plain 404s. Anyone who can open a
 * replay can edit it unless the host disables writes with editing.enabled; the save records who.
 * Disabled writes return 403 before preconditions or body parsing; GET/HEAD remain available.
 *
 * GET answers the stored list (or an empty one, revision 0) with an ETag and `private, no-cache`, so the viewer
 * revalidates on every open and gets a 304 while nothing changed. PUT needs `If-Match` with that ETag: a save
 * over a newer list is a 409 carrying the current one; saving the stored list again is a 200 no-op. Free text
 * (cut labels) gets the same privacy pass as uploads. Returns false when `path` is not an edits route.
 */
export async function handleEditsApi(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  options: { store: ReplayStore; user: string; editing?: EditingSettings },
) {
  const match = /^\/api\/replays\/([a-z0-9][a-z0-9-]{0,79})\/edits$/.exec(path);
  if (!match) return false;
  const id = match[1]!;
  const { store } = options;
  const method = request.method ?? 'GET';
  if (method !== 'GET' && method !== 'HEAD' && method !== 'PUT') {
    sendJson(response, 405, { error: 'method not allowed' });
    return true;
  }
  if (!(await store.locate(id))) {
    sendJson(response, 404, { error: 'replay not found' });
    return true;
  }
  if (method !== 'PUT') {
    const { edits, version } = await store.readEdits(id);
    const etag = editsEtag(version);
    if (notModified(request, etag)) {
      response.writeHead(304, { etag, 'cache-control': REVALIDATE });
      response.end();
      return true;
    }
    sendEdits(response, 200, edits, version);
    return true;
  }

  if (options.editing?.enabled === false) {
    sendJson(response, 403, { error: 'editing is turned off' });
    return true;
  }

  const ifMatch = request.headers['if-match'];
  if (typeof ifMatch !== 'string' || !ifMatch.trim()) {
    sendJson(response, 428, { error: 'If-Match is required: send the ETag of the edits you changed' });
    return true;
  }
  const ifVersion = versionFromEtag(ifMatch);
  const text = await readBody(request);
  // Same privacy pass as uploads: a URL pasted into a label loses credentials and sensitive parameters.
  const input: unknown = sanitizeUrlFields(parseJsonBody(text));
  try {
    // An If-Match that is not one of ours can never match: the conflict path answers with the current list.
    const saved = await store.saveEdits(id, input, { by: options.user, ifVersion: ifVersion === undefined ? '\0' : ifVersion });
    if (saved.changed) console.log(`edits ${id}: saved revision ${saved.edits.revision} by ${options.user}`);
    sendEdits(response, 200, saved.edits, saved.version);
  } catch (error) {
    const conflict = error as { status?: number; current?: StoredReplayEdits; version?: string };
    if (conflict.status !== 409 || !conflict.current) throw error;
    sendEdits(response, 409, { error: 'These edits changed since you opened them.', current: conflict.current }, conflict.version);
  }
  return true;
}
