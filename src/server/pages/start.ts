import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';
import { constants, createBrotliCompress, createGzip } from 'node:zlib';

import { fetchNodeHandler, NodeRequest } from 'srvx/node';

import { PAGE_HEADER, type PageDeployment, pageContexts } from '../../shared/page-context.ts';
import { type Encoding, pickEncoding } from '../compression.ts';
import { headInjector, headMetas } from './head.ts';

type NodeHandler = (request: IncomingMessage, response: ServerResponse) => void | Promise<void>;

interface StartEntry {
  fetch(request: Request): Response | Promise<Response>;
}

/**
 * One page request rendered by the TanStack Start server entry. Resolves false, with nothing sent, when the render
 * failed before its first byte: the caller then serves the single-page app instead.
 */
export interface PageRenderer {
  render(request: IncomingMessage, response: ServerResponse, page: { deployment: PageDeployment; head: string }): Promise<boolean>;
}

/** Credentials and routing headers an in-process API call carries from the page request. */
const FORWARDED = ['cookie', 'authorization', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-request-id', 'host'];

/**
 * Loads Start's built server entry (`dist/start/server/server.js`). Its loaders reach the API through `api`, our own
 * handler called in process, so auth, request policy and plugin hooks apply exactly as for the browser's requests.
 */
export async function loadStartRenderer(entryFile: string, api: NodeHandler): Promise<PageRenderer> {
  const loaded: unknown = await import(pathToFileURL(entryFile).href);
  if (!isStartModule(loaded)) throw new Error(`${entryFile} does not export a Start server entry`);
  const entry = loaded.default;
  return {
    async render(request, response, { deployment, head }) {
      const id = randomUUID();
      const forwarded = new Headers();
      for (const name of FORWARDED) {
        const value = request.headers[name];
        if (typeof value === 'string') forwarded.set(name, value);
      }
      const origin = `http://${request.headers.host ?? 'replays.invalid'}`;
      pageContexts.set(id, {
        deployment,
        metas: headMetas(head),
        cookie: typeof request.headers.cookie === 'string' ? request.headers.cookie : '',
        api: (path, init) => {
          const headers = new Headers(forwarded);
          for (const [name, value] of new Headers(init?.headers)) headers.set(name, value);
          if (!headers.has('accept')) headers.set('accept', 'application/json');
          return fetchNodeHandler(api, new Request(`${origin}${deployment.base}/api/${path}`, { ...init, headers }));
        },
      });
      // invariant: the id header is always ours: a client-sent one is overwritten before Start reads it.
      // oxlint-disable-next-line eslint/no-param-reassign -- why: Start reads the request it renders; the id travels in its headers.
      request.headers[PAGE_HEADER] = id;
      try {
        const page = await entry.fetch(new NodeRequest({ req: request, res: response }));
        if (page.status >= 500) {
          await page.body?.cancel();
          return false;
        }
        await sendPage(request, response, page, head);
        return true;
      } finally {
        pageContexts.delete(id);
      }
    },
  };
}

/** Streams the page with the deployment's head added and each chunk flushed, so the shell reaches the browser first. */
async function sendPage(request: IncomingMessage, response: ServerResponse, page: Response, head: string) {
  const html = Boolean(page.headers.get('content-type')?.startsWith('text/html'));
  const encoding = html && page.body ? pickEncoding(request.headers['accept-encoding']) : undefined;
  response.writeHead(page.status, pageHeaders(page, response.getHeader('vary'), html, encoding));
  if (!page.body || request.method === 'HEAD') {
    response.end();
    return;
  }
  const body = html ? page.body.pipeThrough(headInjector(head)) : page.body;
  const compressor = encoding ? compressorFor(encoding) : undefined;
  compressor?.pipe(response);
  const sink = compressor ?? response;
  const reader = body.getReader();
  for (let next = await reader.read(); !next.done; next = await reader.read()) {
    if (response.destroyed) {
      await reader.cancel().catch(() => {});
      return;
    }
    sink.write(next.value);
    compressor?.flush();
  }
  sink.end();
  await new Promise((done) => response.once('close', done));
}

/** The page's headers for Node: cookies kept apart, the server's `Vary` merged, compression and no shared caching. */
function pageHeaders(page: Response, serverVary: unknown, html: boolean, encoding: Encoding | undefined) {
  const headers: Record<string, string | string[]> = {};
  for (const [name, value] of page.headers) if (name !== 'set-cookie' && name !== 'content-length') headers[name] = value;
  const cookies = page.headers.getSetCookie();
  if (cookies.length) headers['set-cookie'] = cookies;
  const vary = [serverVary, page.headers.get('vary'), encoding ? 'accept-encoding' : undefined].filter(
    (value) => typeof value === 'string' && value,
  );
  if (vary.length) headers.vary = vary.join(', ');
  if (html) headers['cache-control'] = 'private, no-cache';
  if (encoding) headers['content-encoding'] = encoding;
  return headers;
}

function compressorFor(encoding: Encoding) {
  return encoding === 'br'
    ? createBrotliCompress({ params: { [constants.BROTLI_PARAM_QUALITY]: 5, [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT } })
    : createGzip({ level: 6 });
}

function isStartModule(value: unknown): value is { default: StartEntry } {
  if (typeof value !== 'object' || value === null || !('default' in value)) return false;
  const entry = value.default;
  return typeof entry === 'object' && entry !== null && 'fetch' in entry && typeof entry.fetch === 'function';
}
