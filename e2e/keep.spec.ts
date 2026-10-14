import { expect, type Page, test } from '@playwright/test';

import { cloneBundle, createSuite, openReplay, postBundle, uniqueId, serveApp } from './support.ts';

// Keep (no expiry): a "More" item on an uploaded replay with a toast and the Replay details "Retention" row;
// a pin in a review suite's sidebar (More on phones) keeps the suite and its runs.

const server = serveApp();

async function openMore(page: Page) {
  await page.getByRole('button', { name: 'More actions' }).click();
  await expect(page.getByRole('menu')).toBeVisible();
}

async function retention(page: Page) {
  await page.getByRole('button', { name: 'Replay details' }).click();
  const text = page.getByTestId('replay-retention');
  await expect(text).toBeVisible();
  return text;
}

async function closeDetails(page: Page) {
  await page.keyboard.press('Escape');
  // Closing returns the keyboard to the details button; wait, or that closes the next menu.
  await expect(page.getByTestId('replay-info')).toBeHidden();
}

test('keeping a replay pins it, and releasing it restores the expiry', async ({ page }) => {
  const id = uniqueId('keep');
  const base = server().origin;
  await postBundle(page.request, base, await cloneBundle(page.request, base, 'demo-shop', id, 'Keep check'));
  await openReplay(page, `${base}/r/${id}`);

  await expect(await retention(page)).toHaveText(/Expires in (29|30) days/);
  await closeDetails(page);

  await openMore(page);
  await page.getByTestId('keep-replay').click();
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Kept' })).toBeVisible();
  await expect(await retention(page)).toContainText('Kept by');
  await closeDetails(page);
  await expect((await page.request.get(`${base}/api/replays/${id}/keep`)).json()).resolves.toMatchObject({
    kept: { by: expect.any(String) },
    expiresAt: null,
  });

  // The item now reads "Kept"; choosing it releases the replay.
  await openMore(page);
  await expect(page.getByTestId('keep-replay')).toContainText('Kept');
  await page.getByTestId('keep-replay').click();
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'No longer kept' })).toBeVisible();
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

test('a kept suite shows as pinned in the sidebar and keeps its runs; More keeps and releases on phones', async ({ page }) => {
  const base = server().origin;
  const suite = uniqueId('keep-suite');
  const replayId = `${suite}-run`;
  await createSuite(page.request, base, suite, [{ id: 'attempt-1', label: 'Desktop: keep', status: 'passed', replayId }]);
  const keepApi = `${base}/api/suites/${suite}/keep`;

  await openReplay(page, `${base}/s/${suite}`);
  const pin = page.getByRole('complementary', { name: 'Review suite' }).getByTestId('keep-suite');
  await expect(pin).toHaveAttribute('aria-pressed', 'false');
  await expect(await retention(page)).toHaveText(/Expires in (29|30) days/);
  await closeDetails(page);

  // Kept elsewhere (the API), the pin shows it and the run is kept with the suite.
  expect((await page.request.put(keepApi)).ok()).toBe(true);
  await page.reload();
  await expect(page.getByRole('complementary', { name: 'Review suite' }).getByTestId('keep-suite')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('complementary', { name: 'Review suite' }).getByTestId('keep-suite')).toHaveAccessibleName(/^Kept by /);
  await expect(await retention(page)).toHaveText('Doesn’t expire');
  await closeDetails(page);
  expect((await page.request.delete(keepApi)).ok()).toBe(true);

  // Phones have no sidebar: "Keep suite" is in More.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole('complementary', { name: 'Review suite' })).toHaveCount(0);
  await openMore(page);
  await page.getByTestId('keep-suite').click();
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Suite kept' })).toBeVisible();
  await expect.poll(async () => (await (await page.request.get(keepApi)).json()).expiresAt).toBeNull();
  await page.keyboard.press('Escape');
  await openMore(page);
  await expect(page.getByTestId('keep-suite')).toContainText('Suite kept');
  await page.getByTestId('keep-suite').click();
  await expect.poll(async () => (await (await page.request.get(keepApi)).json()).kept).toBeUndefined();
});
