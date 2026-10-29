import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, type Page, test } from '@playwright/test';

import { cloneBundle, openReplay, postBundle, serveApp, uniqueId, gotoHydrated } from './support.ts';

/* why: profiles declared in a config file (no plugin) drive index segments with counts, the `profile=` filter, the upload
   picker, and the viewer opening a triage replay just before its first error. The samples have no profile. */

let configDir: string;
test.beforeAll(async () => {
  configDir = await mkdtemp(join(tmpdir(), 'replays-e2e-profiles-'));
  await writeFile(
    join(configDir, 'config.json'),
    JSON.stringify({
      profiles: [
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

// why: LoadingSwap can retain a busy skeleton beside the mounted viewer during its crossfade.
const viewerShell = (page: Page) => page.getByRole('main').and(page.locator('.app-shell:not([aria-busy="true"]):visible'));

async function loadedViewer(page: Page) {
  const viewer = viewerShell(page);
  await expect(viewer).toBeVisible();
  await expect(viewer.getByTestId('replay-player').locator('iframe')).toBeAttached();
  await expect(viewer.getByRole('heading', { level: 1 })).toBeVisible();
  return viewer;
}

async function upload(request: Parameters<typeof cloneBundle>[0], profile: string | undefined, title: string) {
  const base = server().origin;
  const id = uniqueId(profile ?? 'plain');
  const bundle = await cloneBundle(request, base, 'demo-shop', id, title);
  await postBundle(request, base, { ...bundle, meta: { ...bundle.meta, ...(profile ? { profile } : {}) } });
  return id;
}

test('the index shows profile segments with counts and narrows the list; the API filters with ?profile=', async ({ page }) => {
  const base = server().origin;
  const triage = await upload(page.request, 'triage', 'Profile triage check');
  await upload(page.request, 'walkthrough', 'Profile walkthrough check');

  await gotoHydrated(page, `${base}/`);
  const segments = page.getByRole('radiogroup', { name: 'Profile' });
  await expect(segments.getByRole('radio')).toHaveCount(3);
  const segment = (name: string) => segments.locator('label', { hasText: name });
  await expect(segment('Triage').locator('.profile-segment-count')).not.toHaveText('0');
  await expect(segments.getByRole('radio', { name: /^All/ })).toBeChecked();

  await segment('Triage').click();
  await expect(page).toHaveURL(/[?&]profile=triage/);
  await expect(page.getByRole('link', { name: /^Profile triage check/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /^Profile walkthrough check/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /^Demo shop/ })).toHaveCount(0);

  // why: the segment must come back from the URL.
  await gotoHydrated(page, `${base}/?profile=walkthrough`);
  await expect(segments.getByRole('radio', { name: /^Walkthroughs/ })).toBeChecked();
  await expect(page.getByRole('link', { name: /^Profile walkthrough check/ }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: /^Profile triage check/ })).toHaveCount(0);

  const listed = (await (await page.request.get(`${base}/api/replays?profile=triage`)).json()) as Array<{ id: string; profile: string }>;
  expect(listed.map((item) => item.id)).toContain(triage);
  expect(listed.every((item) => item.profile === 'triage')).toBe(true);
  const config = (await (await page.request.get(`${base}/api/config`)).json()) as { profiles: Array<{ id: string }> };
  expect(config.profiles.map((profile) => profile.id)).toEqual(['triage', 'walkthrough', 'performance']);
});

test('an upload with an unknown profile is refused, naming the allowed ids', async ({ request }) => {
  const base = server().origin;
  const bundle = await cloneBundle(request, base, 'demo-shop', uniqueId('bad-profile'));
  const response = await request.post(`${base}/api/replays`, { data: { ...bundle, meta: { ...bundle.meta, profile: 'demo' } } });
  expect(response.status()).toBe(400);
  expect(await response.text()).toContain('must be one of triage, walkthrough, performance');
});

test('a triage replay opens one second before its first error, on that tab; a permalink still wins', async ({ page }) => {
  const id = await upload(page.request, 'triage', 'Triage opening');
  await openReplay(page, `${server().origin}/r/${id}`);
  const viewer = await loadedViewer(page);
  await expect(viewer).toHaveAttribute('data-profile', 'triage');
  // why: demo-shop's first error is the failed coupon request at 7.174 s.
  await expect(page.getByTestId('playhead')).toHaveText('0:06.2');
  await expect(page.getByTestId('network-tab')).toHaveAttribute('aria-selected', 'true');

  await openReplay(page, `${server().origin}/r/${id}?t=2`);
  await expect(page.getByTestId('playhead')).toHaveText('0:02.0');
});

test('a walkthrough opens at the start with the panel folded and captions on; a replay without a profile opens as before', async ({
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
  await expect(plainViewer).not.toHaveAttribute('data-profile');
  await expect(page.getByTestId('playhead')).toHaveText('0:00.0');
  await expect(page.getByTestId('captions-switch')).toHaveAttribute('aria-pressed', 'false');
});

test('a loading shell cannot satisfy the profile-free viewer assertions', async ({ page }) => {
  const base = server().origin;
  const id = await upload(page.request, undefined, 'Delayed profile-free replay');
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
    // why: absence alone would pass on this skeleton; the profile assertions must first await a loaded viewer.
    await expect(loading).not.toHaveAttribute('data-profile');
    await expect(viewerShell(page)).toHaveCount(0);

    release();
    const viewer = await loadedViewer(page);
    await expect(viewer.getByRole('heading', { level: 1 })).toHaveText('Delayed profile-free replay');
    await expect(viewer).not.toHaveAttribute('data-profile');
  } finally {
    release();
  }
});

test('the upload dialog offers the profiles and stores the one picked', async ({ page }) => {
  const base = server().origin;
  const bundle = await cloneBundle(page.request, base, 'demo-shop', uniqueId('picked'), 'Picked profile');
  await gotoHydrated(page, `${base}/`);
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await page.getByTestId('upload-input').setInputFiles({
    name: 'picked.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(bundle)),
  });
  await page.getByTestId('upload-profile').click();
  await page.getByRole('option', { name: 'Walkthroughs' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(page).toHaveURL(`${base}/r/${bundle.meta.id}`, { timeout: 15_000 });
  const viewer = await loadedViewer(page);
  await expect(viewer).toHaveAttribute('data-profile', 'walkthrough');
  const stored = (await (await page.request.get(`${base}/api/replays/${bundle.meta.id}`)).json()) as { meta: { profile?: string } };
  expect(stored.meta.profile).toBe('walkthrough');
});
