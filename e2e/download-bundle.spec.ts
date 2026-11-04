import { readFile } from 'node:fs/promises';

import { expect, type Page, test } from '@playwright/test';

import { isRecord } from '../src/shared/validate.ts';
import { openReplay, origin } from './support.ts';

const REPLAY = 'demo-shop';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.route(`**/api/replays/${REPLAY}/render*`, (route) => route.fulfill({ json: { status: 'none' } }));
});

/** The button's menu form: the replay claims a stored MP4, and the video route confirms it. */
async function withStoredVideo(page: Page) {
  await page.route(`**/api/replays/${REPLAY}`, async (route) => {
    const response = await route.fetch();
    const bundle: unknown = await response.json();
    if (!isRecord(bundle) || !isRecord(bundle.meta)) throw new Error('the stored replay has no meta');
    await route.fulfill({ response, json: { ...bundle, meta: { ...bundle.meta, videoFile: 'video.mp4' } } });
  });
  await page.route(`**/api/replays/${REPLAY}/video`, (route) => route.fulfill({ contentType: 'video/mp4', body: 'mp4' }));
}

async function savedBundle(download: { suggestedFilename(): string; path(): Promise<string> }) {
  expect(download.suggestedFilename()).toBe(`${REPLAY}.json`);
  const saved: unknown = JSON.parse(await readFile(await download.path(), 'utf8'));
  if (!isRecord(saved) || !isRecord(saved.meta) || !Array.isArray(saved.events)) throw new Error('the download is not a replay bundle');
  return { meta: { id: saved.meta.id }, events: saved.events };
}

test.describe('the download button saves the replay bundle as JSON with Shift', () => {
  for (const [name, press] of [
    ['Shift+click', (page: Page) => page.getByTestId('download-video').click({ modifiers: ['Shift'] })],
    [
      'Shift+Enter',
      (page: Page) =>
        page
          .getByTestId('download-video')
          .focus()
          .then(() => page.keyboard.press('Shift+Enter')),
    ],
    [
      'Shift+Space',
      (page: Page) =>
        page
          .getByTestId('download-video')
          .focus()
          .then(() => page.keyboard.press('Shift+Space')),
    ],
  ] as const) {
    test(`${name} downloads the bundle instead of rendering the video`, async ({ page }) => {
      let renders = 0;
      await page.route(`**/api/replays/${REPLAY}/render*`, (route) => {
        if (route.request().method() === 'POST') renders += 1;
        return route.fulfill({ json: { status: 'none' } });
      });
      await openReplay(page, `${origin()}/r/${REPLAY}`);
      await expect(page.getByTestId('download-video')).toBeVisible();
      const [download] = await Promise.all([page.waitForEvent('download'), press(page)]);
      const bundle = await savedBundle(download);
      expect(bundle.meta.id).toBe(REPLAY);
      expect(bundle.events.length).toBeGreaterThan(0);
      expect(renders).toBe(0);
    });
  }

  test('a plain click still starts the video render', async ({ page }) => {
    await openReplay(page, `${origin()}/r/${REPLAY}`);
    const started = page.waitForRequest(
      (request) => request.method() === 'POST' && request.url().includes(`/api/replays/${REPLAY}/render`),
    );
    await page.getByTestId('download-video').click();
    await started;
  });

  test('with a stored video the menu form saves the bundle on Shift+click and still opens the menu on a plain click', async ({ page }) => {
    await withStoredVideo(page);
    await openReplay(page, `${origin()}/r/${REPLAY}`);
    const button = page.getByTestId('download-video');
    await expect(button).toBeVisible();
    await button.click();
    await expect(page.getByTestId('download-mp4')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('download-mp4')).toHaveCount(0);
    const [download] = await Promise.all([page.waitForEvent('download'), button.click({ modifiers: ['Shift'] })]);
    expect((await savedBundle(download)).meta.id).toBe(REPLAY);
    await expect(page.getByTestId('download-mp4')).toHaveCount(0);
  });

  test('with a stored video Shift+Enter on the focused button saves the bundle without opening the menu', async ({ page }) => {
    await withStoredVideo(page);
    await openReplay(page, `${origin()}/r/${REPLAY}`);
    const button = page.getByTestId('download-video');
    await button.focus();
    const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Shift+Enter')]);
    expect((await savedBundle(download)).meta.id).toBe(REPLAY);
    await expect(page.getByTestId('download-mp4')).toHaveCount(0);
  });

  test('the hint names the shortcut', async ({ page }) => {
    await openReplay(page, `${origin()}/r/${REPLAY}`);
    await page.getByTestId('download-video').hover();
    await expect(page.locator('[data-slot="tooltip-content"]')).toContainText('Shift and click saves the replay as JSON');
  });
});
