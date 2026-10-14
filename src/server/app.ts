import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';

import { buildHumanBundle, defaultId } from '../capture/human-bundle.ts';
import { sanitizeReplayBundle } from '../capture/sanitize.ts';
import { assertReplayBundle, assertReplayTags, type ReplayBundle, type ReplayFilters, isReplayTag } from '../shared/replay.ts';
import {
  assertReviewRunRegistration,
  assertReviewSuite,
  assertReviewSuiteRegistration,
  type ResolvedSuiteRegistration,
} from '../shared/review-suite.ts';
import type { SourceProviders } from '../shared/source-providers.ts';
import type { AuthAdapter, Identity } from './auth/types.ts';
import { COMPRESSIBLE, CompressionCache, compress, pickEncoding } from './compression.ts';
import { appPath, publicPath, withBase } from './base-path.ts';
import { type BrandingConfig, pageBranding, publicConfig } from './branding.ts';
import type { ContextSchema } from './context-schema.ts';
import { handleKeepApi } from './keep-routes.ts';
import { handlePosterApi } from './posters.ts';
import { handleInternalRender, handleRenderApi, type RenderService } from './render-routes.ts';
import { serveObject } from './serve-object.ts';
import { ReplayConflictError, type ReplayStore } from './store.ts';
import { recordError, setRequestAttributes, traceRequest, withSpan } from './tracing.ts';

const MIME: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

export interface AppOptions {
  auth: AuthAdapter;
  store: ReplayStore;
  clientDir: string;
  branding: BrandingConfig;
  /** Resolves `context.sources` references into links; defaults to the built-in providers. */
  sources: SourceProviders;
  /** Optional JSON Schema for `context.fields` (context-schema.ts). */
  contextSchema?: ContextSchema;
  devMiddleware?: (request: IncomingMessage, response: ServerResponse, next: () => void) => void;
  /** Server-side video renders; absent means every render route answers 503. */
  render?: RenderService;
  /** Where the app lives publicly (base-path.ts): `''` at the root of its own domain, else e.g. `/replays`. */
  basePath?: string;
  /** Public origin (`https://replays.example.com`); only auth adapters that redirect need it. */
  publicOrigin?: string;
}

/** What a trace may say about an uploaded replay (tracing.ts): its id, counts and enum fields, never contents. */
function uploadAttributes(bundle: ReplayBundle) {
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

/** The server's privacy pass over an upload, in its own span (it walks every event). */
const sanitize = (bundle: ReplayBundle) =>
  withSpan('replay.sanitize', { 'replay.event_count': bundle.events.length }, () => sanitizeReplayBundle(bundle));

function replayReceipt(base: string, bundle: ReplayBundle) {
  return JSON.stringify({
    id: bundle.meta.id,
    url: publicPath(`/r/${bundle.meta.id}`, base),
    ...(bundle.suiteRun ? { suiteId: bundle.suiteRun.suiteId, runId: bundle.suiteRun.runId } : {}),
  });
}

/**
 * Default caching for dynamic responses: `private` (an auth layer sits in front, so shared caches must never keep
 * them) and `no-cache` (the browser revalidates every time). Not `no-store`: a page whose own document or
 * whose fetches answered `no-store` is kept out of the back/forward cache, so Back would reload the replay.
 */
export const REVALIDATE = 'private, no-cache';
/** Uploaded replay bundles never change (save() refuses an existing id), so they are cached for a day. */
export const IMMUTABLE_PRIVATE = 'private, max-age=86400, immutable';

export function send(
  response: ServerResponse,
  status: number,
  body: string,
  contentType = 'text/plain; charset=utf-8',
  cacheControl = REVALIDATE,
  headers: Record<string, string> = {},
) {
  response.writeHead(status, { ...headers, 'content-type': contentType, 'cache-control': cacheControl });
  response.end(body);
}

/** A validator for a generated body: weak, because the same entity goes out br, gzip or identity-encoded. */
export function bodyEtag(body: Buffer | string) {
  return `W/"${createHash('sha1').update(body).digest('base64url')}"`;
}

/**
 * Like send(), but gzip/brotli-encodes larger bodies when the client accepts it, and tags 200s with an
 * ETag so a revalidation (`no-cache`) costs a 304 instead of the body.
 */
async function sendCompressed(
  request: IncomingMessage,
  response: ServerResponse,
  status: number,
  body: string,
  contentType: string,
  /** Extra `Vary` (e.g. `Host` for a page that differs by host); the 304 carries it too. */
  vary?: string,
) {
  const buffer = Buffer.from(body);
  const etag = status === 200 ? bodyEtag(buffer) : undefined;
  const common = { 'cache-control': REVALIDATE, vary: vary ? `Accept-Encoding, ${vary}` : 'Accept-Encoding', ...(etag ? { etag } : {}) };
  if (etag && notModified(request, etag)) {
    response.writeHead(304, common);
    response.end();
    return;
  }
  const encoding =
    buffer.byteLength >= 1024 && COMPRESSIBLE.test(contentType) ? pickEncoding(request.headers['accept-encoding']) : undefined;
  const payload = encoding ? await compress(buffer, encoding) : buffer;
  response.writeHead(status, {
    ...common,
    'content-type': contentType,
    'content-length': String(payload.byteLength),
    ...(encoding ? { 'content-encoding': encoding } : {}),
  });
  response.end(request.method === 'HEAD' ? undefined : payload);
}

/** True when If-None-Match (weak comparison) matches `etag`. */
export function notModified(request: IncomingMessage, etag: string) {
  const header = request.headers['if-none-match'];
  if (!header) return false;
  const bare = etag.replace(/^W\//, '');
  return header === '*' || header.split(',').some((tag) => tag.trim().replace(/^W\//, '') === bare);
}

async function readBody(request: IncomingMessage, maxBytes: number) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > maxBytes) throw Object.assign(new Error('body too large'), { status: 413 });
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

const MAX_REPLAY_BYTES = 25 * 1024 * 1024;
const gunzipAsync = promisify(gunzip);

function httpError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}

/**
 * Reads a JSON upload of at most `maxBytes`, before and after decompression.
 * `Content-Encoding: gzip` is accepted so browsers can send large recordings compressed.
 */
async function readJsonUpload(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  const encoding = String(request.headers['content-encoding'] ?? 'identity')
    .trim()
    .toLowerCase();
  if (encoding !== 'identity' && encoding !== 'gzip') throw httpError(415, `unsupported content-encoding: ${encoding}`);
  let body: Buffer = await readBody(request, maxBytes).catch((error: unknown) => {
    throw (error as { status?: number }).status === 413 ? httpError(413, `upload is larger than ${maxBytes / 1024 / 1024} MB`) : error;
  });
  setRequestAttributes(request, { 'http.request.body.size': body.byteLength });
  if (encoding === 'gzip') {
    try {
      body = await gunzipAsync(body, { maxOutputLength: maxBytes });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE' || error instanceof RangeError)
        throw httpError(413, `upload is larger than ${maxBytes / 1024 / 1024} MB once decompressed`);
      throw httpError(400, 'body is not valid gzip');
    }
  }
  if (body.byteLength === 0) throw httpError(400, 'body is empty');
  // Sizes only (tracing.ts): the request's span never sees the body itself.
  setRequestAttributes(request, { 'replay.upload.bytes': body.byteLength, 'replay.upload.gzip': encoding === 'gzip' });
  try {
    return withSpan('replay.parse', { 'replay.upload.bytes': body.byteLength }, () => JSON.parse(body.toString('utf8')) as unknown);
  } catch {
    throw httpError(400, 'body is not valid JSON');
  }
}

/** Saves a bundle; without a caller-chosen id, retries with a fresh random id on collision. */
async function saveWithFreshId(store: ReplayStore, bundle: ReplayBundle, idWasChosen: boolean) {
  for (let attempt = 0; ; attempt++) {
    try {
      await store.save(bundle);
      return;
    } catch (error) {
      if (!(error instanceof ReplayConflictError) || idWasChosen || attempt >= 4) throw error;
      const url = /^https?:/i.test(bundle.meta.url) ? bundle.meta.url : 'https://recording.invalid/';
      bundle.meta.id = defaultId(url, new Date(bundle.meta.capturedAt));
    }
  }
}

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
  return filters;
}

function parseReplayPath(path: string) {
  const match = /^\/api\/replays\/([a-z0-9][a-z0-9-]{0,79})(\/video)?$/.exec(path);
  return match ? { id: match[1]!, video: Boolean(match[2]) } : undefined;
}

const compressionCache = new CompressionCache();

/**
 * Starts the new replay's list poster and hover preview in the background; uploads never wait. The poster job
 * shoots the opening still on the way, so it is not queued separately (a separate job could run first and render
 * twice); a replay whose poster fails still gets its still lazily when `/open` is requested.
 */
function requestListMedia(options: AppOptions, id: string) {
  const queue = options.render?.posters;
  if (!queue) return;
  for (const kind of ['poster', 'preview'] as const)
    void queue.request(id, kind).catch((error: unknown) => console.error(`${kind} ${id}: request failed:`, error));
}

/**
 * Streams a file, or serves a cached gzip/brotli copy for compressible types.
 * `etag` enables If-None-Match revalidation.
 */
export async function serveFile(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  cacheControl: string,
  options: { contentType?: string; etag?: boolean; headers?: Record<string, string>; ranges?: boolean } = {},
) {
  const info = await stat(path).catch(() => undefined);
  if (!info?.isFile()) return false;
  const contentType = options.contentType ?? MIME[extname(path)] ?? 'application/octet-stream';
  const etag = `W/"${info.size.toString(36)}-${Math.floor(info.mtimeMs).toString(36)}"`;
  const headers: Record<string, string> = { ...options.headers, 'content-type': contentType, 'cache-control': cacheControl };
  if (options.etag) headers.etag = etag;
  if (options.etag && notModified(request, etag)) {
    response.writeHead(304, headers);
    response.end();
    return true;
  }
  // Single byte ranges for media (<video> needs them in Safari); multi-range requests get the whole file.
  if (options.ranges) {
    headers['accept-ranges'] = 'bytes';
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(request.headers.range ?? '').trim());
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
      if (start > end || start >= info.size) {
        response.writeHead(416, { ...headers, 'content-range': `bytes */${info.size}` });
        response.end();
        return true;
      }
      response.writeHead(206, {
        ...headers,
        'content-range': `bytes ${start}-${end}/${info.size}`,
        'content-length': String(end - start + 1),
      });
      if (request.method === 'HEAD') response.end();
      else createReadStream(path, { start, end }).pipe(response);
      return true;
    }
  }
  const encoding = COMPRESSIBLE.test(contentType) && info.size >= 1024 ? pickEncoding(request.headers['accept-encoding']) : undefined;
  if (COMPRESSIBLE.test(contentType)) headers.vary = 'Accept-Encoding';
  if (encoding) {
    const payload = await compressionCache.get(`${path}|${etag}`, encoding, () => readFile(path));
    response.writeHead(200, { ...headers, 'content-encoding': encoding, 'content-length': String(payload.byteLength) });
    response.end(request.method === 'HEAD' ? undefined : payload);
    return true;
  }
  response.writeHead(200, { ...headers, 'content-length': String(info.size) });
  if (request.method === 'HEAD') response.end();
  else createReadStream(path).pipe(response);
  return true;
}

/** Browsers send `Sec-Fetch-Site`; a state-changing request from another site is refused. CLI clients send none. */
export function sameOrigin(request: IncomingMessage) {
  const site = request.headers['sec-fetch-site'];
  return site === undefined || site === 'same-origin';
}

/** A top-level page load from a browser, as opposed to a health check or API client. */
export function isBrowserNavigation(request: IncomingMessage) {
  if (request.headers['sec-fetch-mode'] === 'navigate') return true;
  const accept = request.headers.accept ?? '';
  return accept.includes('text/html');
}

/** Applies the deployment's source providers and context schema to an uploaded bundle (in place). */
function resolveContext(bundle: ReplayBundle, options: AppOptions) {
  const context = bundle.context;
  if (!context) return;
  if (context.sources) {
    context.sources = context.sources.map((source, index) => options.sources.resolve(source, `replay.context.sources[${index}]`));
  }
  if (context.fields !== undefined && options.contextSchema) {
    const problem = options.contextSchema.validate(context.fields);
    if (problem) throw httpError(400, problem);
  }
}

export function createApp(options: AppOptions) {
  const base = options.basePath ?? '';
  const page = pageBranding(options.branding);
  const routeContext = { base, ...(options.publicOrigin ? { publicOrigin: options.publicOrigin } : {}) };
  const json = 'application/json; charset=utf-8';

  /** Everything past the health checks, inside the request's span. */
  async function serve(request: IncomingMessage, response: ServerResponse, raw: URL, path: string) {
    try {
      // Loopback + per-process token only (render-routes.ts); never reachable through the public path.
      if (path.startsWith('/internal/render/')) {
        await handleInternalRender(request, response, path, options);
        return;
      }

      // The adapter's own routes (sign-in, callback) come first: they run without an identity.
      if (options.auth.handle && options.auth.routes?.includes(path) && (await options.auth.handle(request, response, routeContext)))
        return;

      const user: Identity | undefined = await options.auth.authenticate(request);
      if (!user) {
        const login = options.auth.loginUrl?.(request, routeContext);
        if (login && request.method === 'GET' && isBrowserNavigation(request) && !path.startsWith('/api/')) {
          response.writeHead(302, { location: login, 'cache-control': 'no-store' });
          response.end();
          return;
        }
        send(response, login ? 401 : 403, login ? 'sign in required' : 'forbidden');
        return;
      }
      if (!['GET', 'HEAD'].includes(request.method ?? 'GET') && !sameOrigin(request)) {
        send(response, 403, 'cross-site request');
        return;
      }
      if (await handleRenderApi(request, response, path, raw.searchParams, options)) return;
      if (await handlePosterApi(request, response, path, { store: options.store, posters: options.render?.posters })) return;
      if (await handleKeepApi(request, response, path, { store: options.store, user: user.id })) return;

      if (path === '/api/me' && request.method === 'GET') {
        // Names the signed-in person: private and revalidated on every use (never served stale to another
        // sign-in), but not `no-store`, which would keep the index out of the back/forward cache.
        send(response, 200, JSON.stringify(user), json, REVALIDATE);
        return;
      }
      if (path === '/api/config' && request.method === 'GET') {
        const body = publicConfig(options.branding, {
          ...(options.contextSchema ? { contextSchema: options.contextSchema.schema } : {}),
          sourceProviders: options.sources.ids,
          auth: options.auth.name,
        });
        send(response, 200, JSON.stringify(body), json, REVALIDATE);
        return;
      }
      if (path === '/api/replays' && request.method === 'GET') {
        const summaries = await options.store.list(replayFilters(raw.searchParams));
        await sendCompressed(request, response, 200, JSON.stringify(summaries), json);
        return;
      }
      if (path === '/api/suites' && request.method === 'GET') {
        await sendCompressed(
          request,
          response,
          200,
          JSON.stringify(
            raw.searchParams.get('expand') === 'runs'
              ? await options.store.listSuiteIndex(Number(raw.searchParams.get('limit') ?? 100))
              : await options.store.listSuiteSummaries(Number(raw.searchParams.get('limit') ?? 20)),
          ),
          json,
        );
        return;
      }
      const suitePath = /^\/api\/suites\/([a-z0-9][a-z0-9-]{0,79})(?:\/runs\/([a-zA-Z0-9][a-zA-Z0-9-]{0,79}))?$/.exec(path);
      if (suitePath && request.method === 'GET' && !suitePath[2]) {
        const suite = await options.store.loadSuite(suitePath[1]!);
        // `?expand=runs` adds the index's runDetails (replay summaries per run); the plain shape is unchanged.
        const body =
          suite && raw.searchParams.get('expand') === 'runs'
            ? { ...suite, runDetails: (await options.store.suiteIndexEntry(suite)).runDetails }
            : suite;
        // Suites change while runs register: revalidated (ETag), never assumed fresh.
        await sendCompressed(request, response, suite ? 200 : 404, JSON.stringify(body ?? { error: 'suite not found' }), json);
        return;
      }
      if (suitePath && request.method === 'PUT') {
        const body = await readBody(request, 64 * 1024);
        const input: unknown = JSON.parse(body.toString('utf8'));
        if (suitePath[2]) {
          assertReviewRunRegistration(input, suitePath[2]);
          if (input.context) resolveContext({ context: input.context } as ReplayBundle, options);
          const suite = await options.store.registerRun(suitePath[1]!, suitePath[2]!, input);
          send(response, 200, JSON.stringify(suite), json);
        } else {
          assertReviewSuiteRegistration(input, suitePath[1]!);
          const { subject, ...rest } = input;
          const registration: ResolvedSuiteRegistration = {
            ...rest,
            ...(subject ? { subject: options.sources.resolve(subject, 'suite.subject') } : {}),
          };
          if (registration.context) resolveContext({ context: registration.context } as ReplayBundle, options);
          // The resolved registration is what is stored, so check the whole thing again (a link, not a reference).
          assertReviewSuite({ ...registration, runs: [] });
          const suite = await options.store.registerSuite(suitePath[1]!, registration);
          send(response, 200, JSON.stringify(suite), json);
        }
        return;
      }
      if (path === '/api/replays/import' && request.method === 'POST') {
        // Plain rrweb JSON in the body; `title`, `url`, `id` and `tag` (repeatable) as query parameters.
        const input = await readJsonUpload(request, MAX_REPLAY_BYTES);
        const title = raw.searchParams.get('title')?.trim().slice(0, 200) || 'Imported recording';
        const url = raw.searchParams.get('url')?.trim() || undefined;
        const id = raw.searchParams.get('id')?.trim() || undefined;
        const tags = raw.searchParams.getAll('tag');
        if (tags.length) assertReplayTags(tags, 'tag');
        // The same privacy pass as POST /replays, so query-parameter text (the title) is redacted too.
        const bundle = sanitize(
          buildHumanBundle(input, {
            title,
            ...(url ? { url } : {}),
            ...(id ? { id } : {}),
            ...(tags.length ? { tags } : {}),
          }),
        );
        setRequestAttributes(request, uploadAttributes(bundle));
        await saveWithFreshId(options.store, bundle, Boolean(id));
        setRequestAttributes(request, { 'replay.id': bundle.meta.id });
        void options.store.pruneSoon();
        send(response, 201, replayReceipt(base, bundle), json, REVALIDATE);
        return;
      }
      if (path === '/api/replays' && request.method === 'POST') {
        const replay = await readJsonUpload(request, MAX_REPLAY_BYTES);
        // Source references are resolved into links first: the stored shape always has a link.
        const sources = (replay as { context?: { sources?: unknown } } | null)?.context?.sources;
        if (Array.isArray(sources)) {
          (replay as { context: { sources: unknown[] } }).context.sources = sources.map((source, index) =>
            options.sources.resolve(source as never, `replay.context.sources[${index}]`),
          );
        }
        assertReplayBundle(replay);
        resolveContext(replay, options);
        // Stored data never depends on the uploader having sanitized it.
        const bundle = sanitize(replay);
        setRequestAttributes(request, uploadAttributes(bundle));
        if (bundle.suiteRun) {
          await options.store.assertSuiteRunCanAttach(bundle.suiteRun.suiteId, bundle.suiteRun.runId, bundle.meta.id);
          const existing = await options.store.load(bundle.meta.id);
          if (existing) {
            if (JSON.stringify(existing) !== JSON.stringify(bundle))
              throw Object.assign(new Error('replay already exists'), { status: 409 });
            await options.store.attachReplay(bundle.suiteRun.suiteId, bundle.suiteRun.runId, bundle);
            send(response, 200, replayReceipt(base, bundle), json, REVALIDATE);
            return;
          }
        }
        await options.store.save(bundle);
        if (bundle.suiteRun) await options.store.attachReplay(bundle.suiteRun.suiteId, bundle.suiteRun.runId, bundle);
        requestListMedia(options, bundle.meta.id);
        void options.store.pruneSoon();
        send(response, 201, replayReceipt(base, bundle), json, REVALIDATE);
        return;
      }

      const replayPath = parseReplayPath(path);
      if (replayPath && request.method === 'GET' && !replayPath.video) {
        // Bundles are validated on save (samples are committed), so the stored
        // file is served as-is: no parse/stringify, cached compression. Uploads are immutable, so the
        // browser keeps them for a day without asking again (reopening a replay reads its disk cache);
        // committed samples can change with a deploy, so they revalidate (ETag).
        const located = await options.store.locate(replayPath.id);
        if (
          !located ||
          !(await serveObject(request, response, located.storage, located.key, located.uploaded ? IMMUTABLE_PRIVATE : REVALIDATE, {
            contentType: 'application/json; charset=utf-8',
            etag: true,
            info: located.info,
          }))
        ) {
          send(response, 404, 'replay not found');
        }
        return;
      }
      if (replayPath && request.method === 'PUT' && replayPath.video) {
        if (!(await options.store.locate(replayPath.id))) {
          send(response, 404, 'upload the replay before its video');
          return;
        }
        const video = await readBody(request, 100 * 1024 * 1024);
        setRequestAttributes(request, { 'http.request.body.size': video.byteLength });
        await options.store.saveVideo(replayPath.id, video);
        send(response, 201, JSON.stringify({ id: replayPath.id }), 'application/json; charset=utf-8');
        return;
      }
      // HEAD lets the viewer confirm a stored MP4 exists before it offers the download.
      if (replayPath && (request.method === 'GET' || request.method === 'HEAD') && replayPath.video) {
        const headers = { 'content-disposition': `attachment; filename="${replayPath.id}.mp4"` };
        if (
          !(await serveObject(request, response, options.store.storage, options.store.videoKey(replayPath.id), 'private, max-age=3600', {
            headers,
          }))
        ) {
          send(response, 404, 'video not found');
        }
        return;
      }

      // An unknown or malformed API path is a JSON 404, never the SPA page (the viewer would try to parse HTML).
      if (path.startsWith('/api/')) {
        send(response, 404, JSON.stringify({ error: 'not found' }), json);
        return;
      }

      if (options.devMiddleware) {
        // The dev server's base is the configured public one (vite.config.ts).
        request.url = `${publicPath(path, base)}${raw.search}`;
        await new Promise<void>((done) => {
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            done();
          };
          response.once('finish', finish);
          response.once('close', finish);
          options.devMiddleware!(request, response, finish);
        });
        if (response.writableEnded) return;
      } else if (path.startsWith('/assets/')) {
        const file = resolve(options.clientDir, `.${path}`);
        if (
          file.startsWith(`${resolve(options.clientDir)}/`) &&
          (await serveFile(request, response, file, 'public, max-age=31536000, immutable'))
        )
          return;
      }

      if (request.method === 'GET' && request.headers.accept?.includes('text/html')) {
        const html = await readFile(resolve(options.clientDir, 'index.html'), 'utf8').catch(() => undefined);
        if (html) {
          await sendCompressed(request, response, 200, withBase(html, base, page), 'text/html; charset=utf-8');
          return;
        }
      }
      send(response, 404, 'not found');
    } catch (error) {
      fail(request, response, error);
    }
  }

  return async function handle(request: IncomingMessage, response: ServerResponse) {
    try {
      const raw = new URL(request.url ?? '/', 'http://app');
      const path = appPath(raw.pathname, base);

      // Health checks (load balancer, Docker, deploy curl): `/healthz` always, and `/` for anything that is not
      // a browser page load, so the check path stays the same wherever the app lives.
      if (path === '/healthz' || (path === '/' && !(request.method === 'GET' && isBrowserNavigation(request)))) {
        send(response, 200, 'ok');
        return;
      }
      // A prefixed deployment answers its bare address with the list, so `/replays` and `/replays/` both work.
      await traceRequest(request, response, path, () => serve(request, response, raw, path));
    } catch (error) {
      fail(request, response, error);
    }
  };
}

/**
 * The error response for a failed request: explicit statuses win; input validation (assert* throws plain
 * Errors), bad JSON and bad URLs are 400s with their message; anything else (fs, programming errors) is a
 * generic 500. The request's span gets the error's type only (tracing.ts), never its message.
 */
function fail(request: IncomingMessage, response: ServerResponse, error: unknown) {
  const { status: explicit, code, syscall } = (error ?? {}) as { status?: unknown; code?: unknown; syscall?: unknown };
  const invalidInput =
    error instanceof SyntaxError ||
    code === 'ERR_INVALID_URL' ||
    (error instanceof Error && error.constructor === Error && code === undefined && syscall === undefined);
  const status = explicit !== undefined ? Number(explicit) : invalidInput ? 400 : 500;
  recordError(error, status);
  const requestId = request.headers['x-request-id'] ?? request.headers['x-cloud-trace-context'] ?? '-';
  console.error(`request failed: ${request.method} ${request.url?.split('?')[0]} (request ${String(requestId)}, status ${status})`, error);
  if (response.headersSent) response.end();
  else if (status >= 500) send(response, status, JSON.stringify({ error: 'internal error' }), 'application/json; charset=utf-8');
  else send(response, status, (error as Error).message);
}
