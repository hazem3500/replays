import { http, HttpResponse, type RequestHandler } from 'msw';
import { setupWorker } from 'msw/browser';

/** Story parameters: `parameters.network.handlers` answer this story's requests through the Mock Service Worker. */
export type NetworkParameters = { handlers?: readonly RequestHandler[] };

const worker = setupWorker();
let started: Promise<unknown> | undefined;

// invariant: an /api call without a story handler fails loudly instead of reaching Storybook's static server.
const unmocked = http.all('*/api/*', ({ request }) =>
  HttpResponse.json({ error: `No story handler for ${request.method} ${new URL(request.url).pathname}` }, { status: 501 }),
);

/** Registers the worker once per preview; the script is served next to iframe.html by msw/vite. */
export function startNetwork(): Promise<unknown> {
  // why: a canvas without service workers (an insecure origin) still renders stories that make no requests.
  started ??= worker
    .start({ serviceWorker: { url: './mockServiceWorker.js' }, onUnhandledFrame: 'bypass', quiet: true })
    .catch((error: unknown) => console.error('Story network mocks are off: the Mock Service Worker did not start.', error));
  return started;
}

/** Replaces every handler with this story's, so nothing leaks between stories. */
export function applyStoryHandlers(parameters: NetworkParameters | undefined): void {
  worker.resetHandlers(...(parameters?.handlers ?? []), unmocked);
}
