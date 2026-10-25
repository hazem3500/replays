import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, type Page, test } from '@playwright/test';

import { cloneBundle, openReplay, postBundle, serveApp, uniqueId } from './support.ts';

// Purposes declared in a config file (no plugin): index segments with counts, the `purpose=` filter, the upload picker,
// and the viewer opening a triage replay just before its first error. The samples have no purpose.

let configDir: string;
test.beforeAll(async () => {
  configDir = await mkdtemp(join(tmpdir(), 'replays-e2e-purposes-'));
  await writeFile(
    join(configDir, 'config.json'),
    JSON.stringify({
      purposes: [
        {
          id: 'triage',
          label: 'Triage',
          retentionDays: 90,
          viewer: { openAt: 'first-error', leadMs: 1000, inspector: 'open' },
          poster: 'first-error',
        },
        { id: 'walkthrough', label: 'Walkthroughs', order: 1, retentionDays: 0, viewer: { inspector: 'collapsed', captions: true } },
      ],
    }),
  );
});
test.afterAll(async () => {
  await rm(configDir, { recursive: true, force: true });
});

const server = serveApp(() => ({ REPLAYS_CONFIG: join(configDir, 'config.json') }));

// LoadingSwap can retain a busy skeleton beside the mounted viewer during its crossfade.
const viewerShell = (page: Page) => page.getByRole('main').and(page.locator('.app-shell:not([aria-busy="true"]):visible'));

async function loadedViewer(page: Page) {
  const viewer = viewerShell(page);
  await expect(viewer).toBeVisible();
  await expect(viewer.getByTestId('replay-player').locator('iframe')).toBeAttached();
  await expect(viewer.getByRole('heading', { level: 1 })).toBeVisible();
  return viewer;
}

async function upload(request: Parameters<typeof cloneBundle>[0], purpose: string | undefined, title: string) {
  const base = server().origin;
  const id = uniqueId(purpose ?? 'plain');
  const bundle = await cloneBundle(request, base, 'demo-shop', id, title);
  await postBundle(request, base, { ...bundle, meta: { ...bundle.meta, ...(purpose ? { purpose } : {}) } });
  return id;
}

test('the index shows purpose segments with counts and narrows the list; the API filters with ?purpose=', async ({ page }) => {
  const base = server().origin;
  const triage = await upload(page.request, 'triage', 'Purpose triage check');
  await upload(page.request, 'walkthrough', 'Purpose walkthrough check');

  await page.goto(`${base}/`);
  const segments = page.getByRole('radiogroup', { name: 'Purpose' });
  await expect(segments.getByRole('radio')).toHaveCount(3);
  const segment = (name: string) => segments.locator('label', { hasText: name });
  await expect(segment('Triage').locator('.purpose-segment-count')).not.toHaveText('0');
  await expect(segments.getByRole('radio', { name: /^All/ })).toBeChecked();

  await segment('Triage').click();
  await expect(page).toHaveURL(/[?&]purpose=triage/);
  await expect(page.getByRole('link', { name: /^Purpose triage check/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /^Purpose walkthrough check/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /^Demo shop/ })).toHaveCount(0);

  // The segment comes back from the URL.
  await page.goto(`${base}/?purpose=walkthrough`);
  await expect(segments.getByRole('radio', { name: /^Walkthroughs/ })).toBeChecked();
  await expect(page.getByRole('link', { name: /^Purpose walkthrough check/ }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: /^Purpose triage check/ })).toHaveCount(0);

  const listed = (await (await page.request.get(`${base}/api/replays?purpose=triage`)).json()) as Array<{ id: string; purpose: string }>;
  expect(listed.map((item) => item.id)).toContain(triage);
  expect(listed.every((item) => item.purpose === 'triage')).toBe(true);
  const config = (await (await page.request.get(`${base}/api/config`)).json()) as { purposes: Array<{ id: string }> };
  expect(config.purposes.map((purpose) => purpose.id)).toEqual(['triage', 'walkthrough']);
});

test('an upload with an unknown purpose is refused, naming the allowed ids', async ({ request }) => {
  const base = server().origin;
  const bundle = await cloneBundle(request, base, 'demo-shop', uniqueId('bad-purpose'));
  const response = await request.post(`${base}/api/replays`, { data: { ...bundle, meta: { ...bundle.meta, purpose: 'demo' } } });
  expect(response.status()).toBe(400);
  expect(await response.text()).toContain('must be one of triage, walkthrough');
});

test('a triage replay opens one second before its first error, on that tab; a permalink still wins', async ({ page }) => {
  const id = await upload(page.request, 'triage', 'Triage opening');
  await openReplay(page, `${server().origin}/r/${id}`);
  const viewer = await loadedViewer(page);
  await expect(viewer).toHaveAttribute('data-purpose', 'triage');
  // demo-shop's first error is the failed coupon request at 7.174 s.
  await expect(page.getByTestId('playhead')).toHaveText('0:06.2');
  await expect(page.getByTestId('network-tab')).toHaveAttribute('aria-selected', 'true');

  await openReplay(page, `${server().origin}/r/${id}?t=2`);
  await expect(page.getByTestId('playhead')).toHaveText('0:02.0');
});

test('a walkthrough opens at the start with the panel folded and captions on; a replay without a purpose opens as before', async ({
  page,
}) => {
  const walkthrough = await upload(page.request, 'walkthrough', 'Walkthrough opening');
  await openReplay(page, `${server().origin}/r/${walkthrough}`);
  await expect(page.getByTestId('playhead')).toHaveText('0:00.0');
  const viewer = await loadedViewer(page);
  await expect(viewer).toHaveAttribute('data-inspector-collapsed', 'true');
  await expect(page.getByTestId('captions-switch')).toHaveAttribute('aria-pressed', 'true');

  await openReplay(page, `${server().origin}/r/demo-shop`);
  const plainViewer = await loadedViewer(page);
  await expect(plainViewer).not.toHaveAttribute('data-purpose');
  await expect(page.getByTestId('playhead')).toHaveText('0:00.0');
  await expect(page.getByTestId('captions-switch')).toHaveAttribute('aria-pressed', 'false');
});

test('a loading shell cannot satisfy the purpose-free viewer assertions', async ({ page }) => {
  const base = server().origin;
  const id = await upload(page.request, undefined, 'Delayed purpose-free replay');
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route(`${base}/api/replays/${id}`, async (route) => {
    await gate;
    await route.continue();
  });

  try {
    await page.goto(`${base}/r/${id}`);
    const loading = page.getByRole('main', { name: 'Loading replay', exact: true });
    await expect(loading).toBeVisible();
    await expect(loading).toHaveAttribute('aria-busy', 'true');
    // Absence alone would pass on this skeleton; the purpose assertions must first await a loaded viewer.
    await expect(loading).not.toHaveAttribute('data-purpose');
    await expect(viewerShell(page)).toHaveCount(0);

    release();
    const viewer = await loadedViewer(page);
    await expect(viewer.getByRole('heading', { level: 1 })).toHaveText('Delayed purpose-free replay');
    await expect(viewer).not.toHaveAttribute('data-purpose');
  } finally {
    release();
  }
});

test('the upload dialog offers the purposes and stores the one picked', async ({ page }) => {
  const base = server().origin;
  const bundle = await cloneBundle(page.request, base, 'demo-shop', uniqueId('picked'), 'Picked purpose');
  await page.goto(`${base}/`);
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await page.getByTestId('upload-input').setInputFiles({
    name: 'picked.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(bundle)),
  });
  await page.getByTestId('upload-purpose').click();
  await page.getByRole('option', { name: 'Walkthroughs' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(page).toHaveURL(`${base}/r/${bundle.meta.id}`, { timeout: 15_000 });
  const viewer = await loadedViewer(page);
  await expect(viewer).toHaveAttribute('data-purpose', 'walkthrough');
  const stored = (await (await page.request.get(`${base}/api/replays/${bundle.meta.id}`)).json()) as { meta: { purpose?: string } };
  expect(stored.meta.purpose).toBe('walkthrough');
});
