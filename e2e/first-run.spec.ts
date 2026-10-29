import { expect, type Page, test } from '@playwright/test';

import { origin } from './support.ts';

/** An empty library: the server lists no replays and no suites. */
async function emptyLibrary(page: Page) {
  await page.route(/\/api\/(replays|suites)(\?|$)/, (route) =>
    route.request().method() === 'GET' ? route.fulfill({ json: [] }) : route.continue(),
  );
}

test('an empty library offers its one action without list controls', async ({ page }) => {
  await emptyLibrary(page);
  await page.goto(`${origin()}/`);
  await expect(page.getByRole('heading', { name: 'Your first replay' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Filter/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Sort/ })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Layout' })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Search replays' })).toBeVisible();
});

test('a search with no results keeps the list controls, since it is not a first run', async ({ page }) => {
  await page.goto(`${origin()}/?q=nothing-matches-this`);
  await expect(page.getByRole('button', { name: /^Sort/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your first replay' })).toHaveCount(0);
});
