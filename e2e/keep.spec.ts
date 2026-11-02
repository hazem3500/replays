import { expect, type Page, test } from '@playwright/test';

import { cloneBundle, createSuite, openReplay, postBundle, uniqueId, serveApp } from './support.ts';

// why: suite retention remains an API operation; uploaded replays retain their own More action.

const server = serveApp();

async function openMore(page: Page) {
  await page.getByRole('button', { name: 'More actions' }).click();
  await expect(page.getByRole('menu')).toBeVisible();
}

async function retention(page: Page) {
  await openMore(page);
  await page.getByRole('menuitem', { name: 'Replay details', exact: true }).click();
  const text = page.getByTestId('replay-retention');
  await expect(text).toBeVisible();
  return text;
}

async function closeDetails(page: Page) {
  await page.keyboard.press('Escape');
  // Closing returns the keyboard to the details button; wait, or that closes the next menu.
  await expect(page.getByTestId('replay-info')).toBeHidden();
}

test('replay retention remains available through its API without a Keep item in More', async ({ page }) => {
  const id = uniqueId('keep');
  const base = server().origin;
  await postBundle(page.request, base, await cloneBundle(page.request, base, 'demo-shop', id, 'Keep check'));
  await openReplay(page, `${base}/r/${id}`);

  await expect(await retention(page)).toHaveText(/Expires in (29|30) days/);
  await closeDetails(page);

  await openMore(page);
  await expect(page.getByTestId('keep-replay')).toHaveCount(0);
  await page.keyboard.press('Escape');
  expect((await page.request.put(`${base}/api/replays/${id}/keep`)).ok()).toBe(true);
  await page.reload();
  await expect(await retention(page)).toContainText('Kept by');
  await closeDetails(page);
  await expect((await page.request.get(`${base}/api/replays/${id}/keep`)).json()).resolves.toMatchObject({
    kept: { by: expect.any(String) },
    expiresAt: null,
  });

  await openMore(page);
  await expect(page.getByTestId('keep-replay')).toHaveCount(0);
  await page.keyboard.press('Escape');
  expect((await page.request.delete(`${base}/api/replays/${id}/keep`)).ok()).toBe(true);
  await page.reload();
  await expect(await retention(page)).toHaveText(/Expires in (29|30) days/);
});

test('committed samples never expire and offer no Keep', async ({ page }) => {
  await openReplay(page, `${server().origin}/r/demo-shop`);
  await expect(await retention(page)).toHaveText('Doesn’t expire');
  await closeDetails(page);
  await openMore(page);
  await expect(page.getByRole('menuitem', { name: /Keyboard shortcuts/ })).toBeVisible();
  await expect(page.getByTestId('keep-replay')).toHaveCount(0);
});

test('suite retention stays visible without a suite keep action in More', async ({ page }) => {
  const base = server().origin;
  const suite = uniqueId('keep-suite');
  const replayId = `${suite}-run`;
  await createSuite(page.request, base, suite, [{ id: 'attempt-1', label: 'Desktop: keep', status: 'passed', replayId }]);
  const keepApi = `${base}/api/suites/${suite}/keep`;

  await openReplay(page, `${base}/s/${suite}`);
  const sidebar = page.getByRole('complementary', { name: 'Review suite' });
  await expect(sidebar.getByTestId('keep-suite')).toHaveCount(0);
  await expect(sidebar.getByTestId('suite-kept')).toHaveCount(0);
  await expect(await retention(page)).toHaveText(/Expires in (29|30) days/);
  await closeDetails(page);

  // Kept elsewhere (the API), the sidebar says so and the run is kept with the suite.
  expect((await page.request.put(keepApi)).ok()).toBe(true);
  await page.reload();
  await expect(sidebar.getByTestId('suite-kept')).toHaveText(/^Kept by /);
  await expect(await retention(page)).toHaveText('Doesn’t expire');
  await closeDetails(page);
  expect((await page.request.delete(keepApi)).ok()).toBe(true);
  await page.reload();
  await openMore(page);
  await expect(page.getByTestId('keep-suite')).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole('complementary', { name: 'Review suite' })).toHaveCount(0);
  await openMore(page);
  await expect(page.getByTestId('keep-suite')).toHaveCount(0);
  await page.keyboard.press('Escape');
  expect((await page.request.get(keepApi)).ok()).toBe(true);
  await expect(await retention(page)).toHaveText(/Expires in (29|30) days/);
});
