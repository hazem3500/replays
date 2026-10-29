import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { pathToFileURL } from 'node:url';
import { constants, createBrotliCompress, createGzip } from 'node:zlib';

import { fetchNodeHandler, NodeRequest } from 'srvx/node';

import { PAGE_HEADER, type PageDeployment, pageContexts } from '../../shared/page-context.ts';
import { pickEncoding } from '../compression.ts';
import { headInjector } from './head.ts';

type NodeHandler = (request: IncomingMessage, response: ServerResponse) => void | Promise<void>;

interface StartEntry {
  fetch(request: Request): Response | Promise<Response>;
}

/** One page request rendered by the TanStack Start server entry. */
export interface PageRenderer {
  render(request: IncomingMessage, response: ServerResponse, page: { deployment: PageDeployment; head: string }): Promise<void>;
}

/** Credentials and routing headers an in-process API call carries from the page request. */
const FORWARDED = ['cookie', 'authorization', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-request-id', 'host'];

/**
 * Loads Start's built server entry (`dist/start/server/server.js`). Its loaders reach the API through `api`, our own
 * handler called in process, so auth, request policy and plugin hooks apply exactly as for the browser's requests.
 */
export async function loadStartRenderer(entryFile: string, api: NodeHandler): Promise<PageRenderer> {
  const loaded = (await import(pathToFileURL(entryFile).href)) as { default: StartEntry };
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
        api: (path, init) => {
          const headers = new Headers(forwarded);
          for (const [name, value] of new Headers(init?.headers)) headers.set(name, value);
          if (!headers.has('accept')) headers.set('accept', 'application/json');
          return fetchNodeHandler(api, new Request(`${origin}${deployment.base}/api/${path}`, { ...init, headers }));
        },
      });
      // invariant: the id header is always ours: a client-sent one is overwritten before Start reads it.
      request.headers[PAGE_HEADER] = id;
      try {
        const page = await entry.fetch(new NodeRequest({ req: request, res: response }));
        await sendPage(request, response, page, head);
      } finally {
        pageContexts.delete(id);
      }
    },
  };
}

/** Streams the page with the deployment's head added and each chunk flushed, so the shell reaches the browser first. */
async function sendPage(request: IncomingMessage, response: ServerResponse, page: Response, head: string) {
  const html = page.headers.get('content-type')?.startsWith('text/html');
  const headers: Record<string, string | string[]> = {};
  for (const [name, value] of page.headers) if (name !== 'set-cookie' && name !== 'content-length') headers[name] = value;
  const cookies = page.headers.getSetCookie();
  if (cookies.length) headers['set-cookie'] = cookies;
  const vary = [response.getHeader('vary'), page.headers.get('vary')].filter(Boolean);
  const encoding = html && page.body ? pickEncoding(request.headers['accept-encoding']) : undefined;
  if (encoding) vary.push('accept-encoding');
  if (vary.length) headers.vary = vary.join(', ');
  if (html) headers['cache-control'] = 'private, no-cache';
  if (encoding) headers['content-encoding'] = encoding;
  response.writeHead(page.status, headers);
  if (!page.body || request.method === 'HEAD') {
    response.end();
    return;
  }
  const body = html ? page.body.pipeThrough(headInjector(head)) : page.body;
  const source = Readable.fromWeb(body as NodeReadableStream<Uint8Array>);
  if (!encoding) {
    source.pipe(response);
    await new Promise((done) => response.once('close', done));
    return;
  }
  const compressor =
    encoding === 'br'
      ? createBrotliCompress({ params: { [constants.BROTLI_PARAM_QUALITY]: 5, [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT } })
      : createGzip({ level: 6 });
  compressor.pipe(response);
  for await (const chunk of source) {
    compressor.write(chunk);
    compressor.flush();
  }
  compressor.end();
  await new Promise((done) => response.once('close', done));
}
