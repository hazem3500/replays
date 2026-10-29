import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';

import { publicPath } from '../base-path.ts';
import { send, sendGenerated } from '../http/send.ts';
import { serveFile } from '../http/serve-file.ts';
import { shellHead } from '../pages/head.ts';
import type { PageRenderer } from '../pages/start.ts';

const HTML = 'text/html; charset=utf-8';

/** The page shell's sources: the client build, the dev server's hooks and the Start page renderer. */
export interface ShellContext {
  clientDir: string;
  /** The configured public base; the dev server serves under it whichever host asked. */
  defaultBase: string;
  /** User plugins are on (beta.malleable): pages may only frame themselves, blob: and data: URLs. */
  malleable: boolean;
  brandName: string;
  /** index.html as served at `base`. */
  indexPage: (html: string, base: string) => string;
  devIndexHtml?: ((url: string) => Promise<string>) | undefined;
  devMiddleware?: ((request: IncomingMessage, response: ServerResponse, next: () => void) => void) | undefined;
  pages?: { renderer: PageRenderer; clientDir: string } | undefined;
}

/** The page request: where it came in, as which app path, at which public base. */
export interface ShellRequest {
  raw: URL;
  path: string;
  base: string;
}

const wantsPage = (request: IncomingMessage): boolean => request.method === 'GET' && Boolean(request.headers.accept?.includes('text/html'));

/** why: a sandboxed plugin frame that navigates itself elsewhere (to smuggle data out in a URL) is refused by the browser. */
function restrictFrames(response: ServerResponse, context: ShellContext): void {
  if (context.malleable) response.setHeader('content-security-policy', "frame-src 'self' blob: data:");
}

/** Hands the request to the dev server; true when it answered. */
async function runDevMiddleware(request: IncomingMessage, response: ServerResponse, page: ShellRequest, context: ShellContext) {
  const middleware = context.devMiddleware;
  if (!middleware) return false;
  // oxlint-disable-next-line eslint/no-param-reassign -- why: the dev server routes by request.url under the configured base.
  request.url = `${publicPath(page.path, context.defaultBase)}${page.raw.search}`;
  await new Promise<void>((done) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      done();
    };
    response.once('finish', finish);
    response.once('close', finish);
    middleware(request, response, finish);
  });
  return response.writableEnded;
}

/** Hashed build assets for a year; assets/brand/* keep fixed names for index.html, so they revalidate daily. */
async function serveAsset(request: IncomingMessage, response: ServerResponse, path: string, context: ShellContext) {
  const cacheControl = path.startsWith('/assets/brand/') ? 'public, max-age=86400' : 'public, max-age=31536000, immutable';
  const dirs = context.pages ? [context.pages.clientDir, context.clientDir] : [context.clientDir];
  for (const dir of dirs) {
    const file = resolve(dir, `.${path}`);
    if (file.startsWith(`${resolve(dir)}/`) && (await serveFile(request, response, file, { cacheControl }))) return true;
  }
  return false;
}

async function serveIndex(request: IncomingMessage, response: ServerResponse, base: string, context: ShellContext) {
  const html = await readFile(resolve(context.clientDir, 'index.html'), 'utf8').catch(() => null);
  if (html === null) return false;
  restrictFrames(response, context);
  const page = context.indexPage(html, base);
  if (context.pages) {
    const deployment = { base, name: context.brandName };
    if (await context.pages.renderer.render(request, response, { deployment, head: shellHead(page) })) return true;
  }
  await sendGenerated(request, response, page, HTML);
  return true;
}

/**
 * Everything that is not an API or plugin route: the dev page, dev middleware or built assets, then the index page (or
 * its server-rendered Start page) for browser page loads, else 404.
 */
export async function serveShell(
  request: IncomingMessage,
  response: ServerResponse,
  page: ShellRequest,
  context: ShellContext,
): Promise<void> {
  if (context.devIndexHtml && wantsPage(request)) {
    const html = await context.devIndexHtml(`${publicPath(page.path, context.defaultBase)}${page.raw.search}`);
    restrictFrames(response, context);
    await sendGenerated(request, response, context.indexPage(html, page.base), HTML);
    return;
  }
  if (context.devMiddleware) {
    if (await runDevMiddleware(request, response, page, context)) return;
  } else if (page.path.startsWith('/assets/') && (await serveAsset(request, response, page.path, context))) return;
  if (wantsPage(request) && (await serveIndex(request, response, page.base, context))) return;
  send(response, 404, 'not found');
}
