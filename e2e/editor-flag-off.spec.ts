import { expect, test } from '@playwright/test';

import { origin } from './support.ts';

// The beta editor is OFF by default (REPLAYS_BETA_EDITOR unset on the shared e2e server): no editor UI, no editor
// routes, and the editor's code is never even requested. e2e/editor.spec.ts covers the same server with the flag on.

test('the viewer has no editor entry, never asks for edits and never loads the editor code', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(new URL(request.url()).pathname));
  await page.goto(`${origin()}/r/demo-shop`);
  await expect(page.getByTestId('replay-player').locator('iframe')).toBeAttached();
  await expect(page.getByTestId('edit-replay')).toHaveCount(0);
  await expect(page.getByTestId('edited-chip')).toHaveCount(0);
  await page.getByRole('button', { name: 'More actions' }).click();
  await expect(page.getByRole('menu')).not.toContainText(/edit/i);
  await expect(page.locator('meta[name="app-beta"]')).toHaveAttribute('content', '');
  expect(requests.filter((path) => /\/edits$|\/assets\/Editor-/.test(path))).toEqual([]);
});

test('there is no edit page', async ({ page }) => {
  await page.goto(`${origin()}/r/demo-shop/edit`);
  await expect(page.getByRole('heading', { name: 'There’s no page at this address' })).toBeVisible();
  await expect(page.getByTestId('editor')).toHaveCount(0);
  await expect(page.getByTestId('timeline')).toHaveCount(0);
});

test('the edits API does not exist', async ({ request }) => {
  const get = await request.get(`${origin()}/api/replays/demo-shop/edits`);
  expect(get.status()).toBe(404);
  expect(await get.json()).toEqual({ error: 'not found' });
  const put = await request.put(`${origin()}/api/replays/demo-shop/edits`, {
    headers: { 'if-match': '"e.none"' },
    data: { version: 1, cuts: [] },
  });
  expect(put.status()).toBe(404);
  const config = await (await request.get(`${origin()}/api/config`)).json();
  expect(config.beta).toEqual({ editor: false, cursorCustomization: false, malleable: false });
});
