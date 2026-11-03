import { expect, type APIRequestContext, type Locator, type Page, test } from '@playwright/test';

import { startServer } from '../scripts/test-server.mjs';

type Server = Awaited<ReturnType<typeof startServer>>;

/** The shared, read-only server that e2e/global-setup.ts starts: only the two sample replays. */
export const origin = () => {
  const value = process.env.E2E_ORIGIN;
  if (!value) throw new Error('E2E_ORIGIN is set by e2e/global-setup.ts');
  return value;
};

export const THEME_KEY = 'replays-theme';

/**
 * A private server for a spec file that stores data (uploads, suites, keeps), so the shared server keeps its
 * two samples. Every worker that runs tests of the file starts its own, so each test must create what it needs.
 */
export function serveApp(env: Record<string, string> | (() => Record<string, string>) = {}) {
  let server: Server | undefined;
  test.beforeAll(async () => {
    server = await startServer({ env: { POSTERS_DISABLED: '1', RENDER_DISABLED: '1', ...(typeof env === 'function' ? env() : env) } });
  });
  test.afterAll(async () => {
    await server?.stop();
  });
  return () => {
    if (!server) throw new Error('the server starts in beforeAll');
    return server;
  };
}

/** A unique, valid replay id for a test. */
export const uniqueId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export interface Bundle {
  meta: Record<string, unknown> & { id: string; title: string };
  events: unknown[];
  console?: unknown[];
  network?: Array<Record<string, unknown>>;
  steps?: unknown[];
  [key: string]: unknown;
}

/** Fetches a stored replay and returns a copy under a new id, ready to be changed and posted. */
export async function cloneBundle(request: APIRequestContext, base: string, from: string, id: string, title = id): Promise<Bundle> {
  const response = await request.get(`${base}/api/replays/${from}`);
  expect(response.status()).toBe(200);
  const bundle = (await response.json()) as Bundle;
  return { ...bundle, meta: { ...bundle.meta, id, title } };
}

export async function postBundle(request: APIRequestContext, base: string, bundle: Bundle) {
  const response = await request.post(`${base}/api/replays`, { data: bundle });
  expect(response.status(), await response.text()).toBe(201);
}

/**
 * Opens a page and waits until it responds to input: a server-rendered page shows its controls before React hydrates
 * them, and a click or keystroke in between is lost. The single-page app has no such gap.
 */
export async function gotoHydrated(page: Page, url: string) {
  const response = await page.goto(url);
  await expect(page.locator('html:is([data-hydrated], :not([data-rendered]))')).toBeAttached();
  // why: the library's Activity boundary can hydrate after the outer document shell.
  if ((await page.locator('.index-shell:visible').count()) > 0)
    await expect(page.locator('.index-shell:visible')).toHaveAttribute('data-index-hydrated', '');
  return response;
}

/** Opens a replay and waits until the player has mounted the recorded page. */
export async function openReplay(page: Page, url: string) {
  await page.goto(url);
  // why: a suite with two or more recordings opens comparing them, and its tiles are the stage then.
  await expect(page.locator('[data-testid="replay-player"] iframe, [data-testid="compare-stage"] iframe').first()).toBeAttached();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

/** A fixed colour scheme from the first paint (the app stores the choice under THEME_KEY). */
export async function useTheme(page: Page, theme: 'dark' | 'light') {
  await page.addInitScript(([key, value]) => localStorage.setItem(key as string, value as string), [THEME_KEY, theme] as const);
}

type RunStatus = 'running' | 'passed' | 'failed' | 'partial';

/**
 * Registers a review suite and its runs, then uploads one replay (a copy of `demo-shop`) per run that has a
 * `replayId`. Dates are recent, or retention would prune the suite.
 */
export async function createSuite(
  request: APIRequestContext,
  base: string,
  suiteId: string,
  runs: Array<{ id: string; label: string; status: RunStatus; replayId?: string }>,
  subject: { provider: string; ref: string; url: string; label: string } | undefined = {
    provider: 'github',
    ref: 'example-org/shop-demo#9',
    url: 'https://github.com/example-org/shop-demo/pull/9',
    label: 'Example change',
  },
) {
  const now = new Date().toISOString();
  const put = async (path: string, data: unknown) => {
    const response = await request.put(`${base}/api/${path}`, { data });
    expect(response.ok(), `${path}: ${await response.text()}`).toBe(true);
  };
  await put(`suites/${suiteId}`, { version: 1, id: suiteId, title: `Review ${suiteId}`, createdAt: now, ...(subject ? { subject } : {}) });
  for (const [index, run] of runs.entries()) {
    await put(`suites/${suiteId}/runs/${run.id}`, {
      id: run.id,
      sequence: index + 1,
      label: run.label,
      status: run.status,
      startedAt: now,
    });
    if (!run.replayId) continue;
    // Without the sample's own context, so the suite's subject is the only source.
    const { context: _context, ...bundle } = await cloneBundle(request, base, 'demo-shop', run.replayId, `Recording ${run.replayId}`);
    await postBundle(request, base, { ...bundle, suiteRun: { suiteId, runId: run.id } });
  }
}

/** The laid-out box of a locator, failing clearly when it is hidden or detached. */
export async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Expected element to be laid out');
  return box;
}
