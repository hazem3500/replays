import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

import { serveApp } from './support.ts';

const server = serveApp({ REPLAYS_BETA_EDITOR: 'true', EDITING_ENABLED: 'false' });

// Seed an edit saved before this host disabled writes; the API deliberately cannot seed it with PUT.
test('read-only host plays saved trims and effects and offers no route into editing', async ({ page }) => {
  const { origin, dataDir } = server();
  const id = 'demo-shop';
  await mkdir(join(dataDir, id), { recursive: true });
  await writeFile(
    join(dataDir, id, 'edits.json'),
    JSON.stringify({
      version: 1,
      revision: 1,
      trim: { start: 1000, end: 5000 },
      cuts: [],
      captions: [{ id: 'saved-caption', from: 1000, to: 5000, text: 'Saved before writes disabled' }],
      zooms: [{ id: 'saved-zoom', from: 1000, to: 5000, scale: 1.5 }],
    }),
  );
  const requests: string[] = [];
  page.on('request', (request) => requests.push(new URL(request.url()).pathname));
  await page.goto(`${origin}/r/${id}/edit`);
  await expect(page.getByRole('heading', { name: 'There is no page at this address' })).toBeVisible();
  await page.goto(`${origin}/r/${id}?captions=1#step-0`);
  await expect(page.getByTestId('replay-player').locator('iframe')).toBeAttached();
  await expect(page.getByTestId('editor')).toHaveCount(0);
  await expect(page.getByTestId('edit-replay')).toHaveCount(0);
  await expect(page.getByTestId('edited-chip')).toContainText('Edited');
  await expect(page.getByRole('slider', { name: 'Seek' })).toHaveAttribute('aria-valuetext', /of 0:04/);
  await expect(page.getByText('Saved before writes disabled')).toBeVisible();
  await page.getByTestId('edited-chip').click();
  await expect(page.getByTestId('open-editor')).toHaveCount(0);
  await expect(page.getByTestId('switch-original')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('e');
  await expect(page.getByTestId('editor')).toHaveCount(0);
  await expect(page.locator('meta[name="app-editing"]')).toHaveAttribute('content', 'off');
  expect(requests.some((path) => path.endsWith('/edits'))).toBe(true);
  expect(requests.filter((path) => /\/assets\/Editor-/.test(path))).toEqual([]);
});
