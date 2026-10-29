import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';

import { send, sendJson } from './http/send.ts';
import { serveFile } from './http/serve-file.ts';
import { parseJsonBody } from './http/body.ts';
import type { RenderJob } from '../plugin/types.ts';
import type { Identity } from './auth/types.ts';
import { editsVersion } from '../shared/edits.ts';
import type { BetaFlags } from './beta.ts';
import { renderFilename } from '../shared/render-variant.ts';
import {
  EDITS_VERSION_PATTERN,
  RENDER_SPEED_OPTIONS,
  RenderQueueFullError,
  type RenderQueue,
  type RenderSpeedOption,
  renderJobId,
} from './render-queue.ts';
import type { RenderVerdict } from './render-hooks.ts';
import { RENDER_TOKEN_HEADER, type RenderTools } from './renderer.ts';
import type { PosterQueue } from './posters.ts';
import { serveObject } from './serve-object.ts';
import type { ReplayStore } from './store.ts';

/** Everything the HTTP layer needs for server-side video renders. */
export interface RenderService {
  tools: RenderTools;
  /** Absent when the tools are missing: every render route answers 503. */
  queue?: RenderQueue;
  /** Per-process random secret the renderer's browser sends back on loopback requests. */
  token: string;
  /** Built client (dist/client) holding render.html and its assets. */
  clientDir: string;
  /** Longest replay (ms) the server agrees to render. */
  maxDurationMs: number;
  /** List posters (src/server/posters.ts); only needs Chromium, so it can be on while video export is off. */
  posters?: PosterQueue;
}

/** What the render routes need besides the service: the plugins' `beforeRender` (render-hooks.ts) and who is asking. */
export interface RenderRequestContext {
  beforeRender?: ((job: RenderJob) => Promise<RenderVerdict>) | undefined;
  identity?: Identity | undefined;
}

const JSON_TYPE = 'application/json; charset=utf-8';
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
/** A proxied request carries one of these; the renderer's direct loopback requests never do. */
const PROXY_HEADERS = ['x-forwarded-for', 'forwarded', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip', 'via'];

function json(response: ServerResponse, status: number, body: unknown) {
  sendJson(response, status, body);
}

/**
 * The internal render page may only be loaded by the renderer's own browser:
 * a direct loopback connection, no proxy headers, and the per-process token.
 * Anything else gets the same 404 as an unknown path.
 */
export function isRendererRequest(request: IncomingMessage, token: string) {
  if (!token || !LOOPBACK.has(request.socket.remoteAddress ?? '')) return false;
  if (PROXY_HEADERS.some((header) => request.headers[header] !== undefined)) return false;
  const sent = request.headers[RENDER_TOKEN_HEADER];
  if (typeof sent !== 'string') return false;
  const a = Buffer.from(sent);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** `/internal/render/…`: the render page, its assets and the bundle it plays. Handled before (and outside) authentication. */
export async function handleInternalRender(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  options: { store: ReplayStore; render?: RenderService; beta?: BetaFlags },
) {
  const render = options.render;
  if (!render || request.method !== 'GET' || !isRendererRequest(request, render.token)) {
    send(response, 404, 'not found');
    return;
  }
  const asset = /^\/internal\/render\/assets\/([\w.-]+)$/.exec(path);
  if (asset) {
    // Built asset URLs are relative (vite.config.ts), so the page, its scripts, stylesheets and their fonts all
    // load from this loopback route, outside the authenticated app.
    if (!(await serveFile(request, response, join(render.clientDir, 'assets', asset[1]!), { cacheControl: 'no-store' })))
      send(response, 404, 'not found');
    return;
  }
  // The edit list an edited export applies (the page checks its version against the one it was asked for).
  const edits = options.beta?.editor ? /^\/internal\/render\/([a-z0-9][a-z0-9-]{0,79})\/edits\.json$/.exec(path) : null;
  if (edits) {
    if (!(await options.store.locate(edits[1]!))) send(response, 404, 'not found');
    else sendJson(response, 200, (await options.store.readEdits(edits[1]!)).edits, { cacheControl: 'no-store' });
    return;
  }
  const bundle = /^\/internal\/render\/([a-z0-9][a-z0-9-]{0,79})\/bundle\.json$/.exec(path);
  if (bundle) {
    const located = await options.store.locate(bundle[1]!);
    if (
      !located ||
      !(await serveObject(request, response, located.storage, located.key, 'no-store', { contentType: JSON_TYPE, info: located.info }))
    )
      send(response, 404, 'not found');
    return;
  }
  if (/^\/internal\/render\/[a-z0-9][a-z0-9-]{0,79}$/.test(path)) {
    const html = await readFile(join(render.clientDir, 'render.html'), 'utf8').catch(() => undefined);
    if (!html) {
      send(response, 503, 'render page not built (pnpm build)');
      return;
    }
    // Its asset URLs are relative (`./assets/…`): they resolve under /internal/render/ (above).
    send(response, 200, html, { contentType: 'text/html; charset=utf-8' });
    return;
  }
  send(response, 404, 'not found');
}

async function readSmallJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += (chunk as Buffer).byteLength;
    if (size > 1024) throw Object.assign(new Error('body too large'), { status: 413 });
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  const value: unknown = parseJsonBody(text);
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Object.assign(new Error('body must be a JSON object'), { status: 400 });
  return value as Record<string, unknown>;
}

/** One of the viewer's speeds (0.25, 0.5, 1, 1.5, 2, 4, 8); absent means 1×. */
export function parseSpeed(value: unknown): RenderSpeedOption | undefined {
  if (value === undefined || value === null || value === '') return 1;
  const speed = Number(value);
  return RENDER_SPEED_OPTIONS.find((option) => option === speed);
}

/**
 * An on/off option: POST `{"captions": true}`, GET `?captions=1`. Absent is `fallback`: off for `captions`,
 * on for `skipInactive` (the player's default).
 */
export function parseFlag(value: unknown, fallback = false): boolean | undefined {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  return undefined;
}

/**
 * `/api/replays/<id>/render[/file]`, behind the same auth check as
 * the rest of the app. Returns false when `path` is not a render route.
 *
 * With `beforeRender` hooks, every request that names an export (start, status, download, cancel) runs them, so the
 * options a hook adjusts name the same video for all of them. A refusal is `{ status: 'refused', error }`: a 200 for
 * the viewer's status probe (an expected answer), a 403 for anything else.
 */
export async function handleRenderApi(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  search: URLSearchParams,
  options: { store: ReplayStore; render?: RenderService; beta?: BetaFlags } & RenderRequestContext,
) {
  const match = /^\/api\/replays\/([a-z0-9][a-z0-9-]{0,79})\/render(\/file)?$/.exec(path);
  if (!match) return false;
  const id = match[1]!;
  const file = Boolean(match[2]);
  const queue = options.render?.tools.available ? options.render.queue : undefined;
  if (!queue) {
    const reason = options.render?.tools.reason ? { reason: options.render.tools.reason } : {};
    // The viewer's status probe (a GET of the job) is an expected question: answer it, not fail it. Starting a
    // render, cancelling one or fetching the file still gets 503.
    if ((request.method ?? 'GET') === 'GET' && !file) json(response, 200, { status: 'unavailable', ...reason });
    else json(response, 503, { error: 'render unavailable', ...reason });
    return true;
  }
  const method = request.method ?? 'GET';
  const body = method === 'POST' ? await readSmallJson(request) : {};
  let speed = parseSpeed(method === 'POST' ? body.speed : search.get('speed'));
  if (!speed) {
    json(response, 400, { error: `speed must be one of ${RENDER_SPEED_OPTIONS.join(', ')}` });
    return true;
  }
  let captions = parseFlag(method === 'POST' ? body.captions : search.get('captions'));
  let skipInactive = parseFlag(method === 'POST' ? body.skipInactive : search.get('skipInactive'), true);
  if (captions === undefined || skipInactive === undefined) {
    json(response, 400, { error: `${captions === undefined ? 'captions' : 'skipInactive'} must be true or false` });
    return true;
  }
  if (!(await options.store.locate(id))) {
    json(response, 404, { error: 'replay not found' });
    return true;
  }
  // Exports always apply the replay's edits. The client names the edit list version it shows (`edits`): its status
  // checks and its download keep to the video it asked for, whatever is saved meanwhile. Scripts and older
  // clients name none and get the stored list.
  const requested = method === 'POST' ? body.edits : search.get('edits');
  if (
    requested !== undefined &&
    requested !== null &&
    (typeof requested !== 'string' || (requested && !EDITS_VERSION_PATTERN.test(requested)))
  ) {
    json(response, 400, { error: 'edits must be an edit list version' });
    return true;
  }
  // Edits exist only with the beta editor on; without it exports render the replay as recorded.
  const editorOn = Boolean(options.beta?.editor);
  const current =
    editorOn && (requested === undefined || requested === null || method === 'POST')
      ? editsVersion((await options.store.readEdits(id)).edits)
      : '';
  const edits = editorOn && typeof requested === 'string' ? requested : current;
  if (method === 'POST' && edits !== current) {
    json(response, 409, { error: 'the edits changed since this page loaded; reload to export the current version' });
    return true;
  }
  if (options.beforeRender) {
    const verdict = await options.beforeRender({
      id: renderJobId(id, speed, { captions, skipInactive, edits }),
      replayId: id,
      kind: 'video',
      options: { speed, captions, skipInactive },
      ...(options.identity ? { identity: options.identity } : {}),
    });
    if (!verdict.ok) {
      json(response, (method === 'GET' || method === 'HEAD') && !file ? 200 : 403, { status: 'refused', error: verdict.error });
      return true;
    }
    // render-hooks.ts only lets checked values through.
    speed = (verdict.options.speed as RenderSpeedOption | undefined) ?? speed;
    captions = verdict.options.captions ?? captions;
    skipInactive = verdict.options.skipInactive ?? skipInactive;
  }
  const variant = { captions, skipInactive, edits };

  if (file) {
    if (method !== 'GET' && method !== 'HEAD') {
      json(response, 405, { error: 'method not allowed' });
      return true;
    }
    const served = await serveObject(request, response, queue.storage, queue.outputKey(id, speed, variant), 'private, max-age=3600', {
      contentType: 'video/mp4',
      headers: {
        'content-disposition': `attachment; filename="${renderFilename(id, { speed, captions, skipInactive, edited: Boolean(edits) })}"`,
      },
    });
    if (!served) json(response, 404, { error: 'no rendered video yet' });
    return true;
  }

  switch (method) {
    case 'POST': {
      const summary = await options.store.summary(id);
      const limit = options.render!.maxDurationMs;
      if (summary && summary.duration > limit) {
        json(response, 422, { error: `replays longer than ${Math.round(limit / 60_000)} min are not rendered` });
        return true;
      }
      try {
        const job = await queue.enqueue(id, speed, variant, { identity: options.identity });
        json(response, job.status === 'done' ? 200 : 202, job);
      } catch (error) {
        if (error instanceof RenderQueueFullError) json(response, 429, { error: error.message });
        else throw error;
      }
      return true;
    }
    case 'GET':
    case 'HEAD': {
      const job = await queue.status(id, speed, variant);
      // No render of this variant yet is an expected answer (the viewer probes on every load), not an error: 200.
      json(response, 200, job ?? { status: 'none' });
      return true;
    }
    case 'DELETE': {
      const cancelled = await queue.cancel(id, speed, variant);
      json(response, cancelled ? 200 : 404, { cancelled });
      return true;
    }
    default:
      json(response, 405, { error: 'method not allowed' });
      return true;
  }
}
