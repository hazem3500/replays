import { expect, type Page, test } from '@playwright/test';

import { cloneBundle, gotoHydrated, openReplay, postBundle, serveApp, uniqueId } from './support.ts';

const server = serveApp();

async function recording(page: Page) {
  const base = server().origin;
  const id = uniqueId('delete-ui');
  const title = `Delete UI ${id}`;
  await postBundle(page.request, base, await cloneBundle(page.request, base, 'demo-shop', id, title));
  return { base, id, title };
}

async function viewerDelete(page: Page) {
  await page.getByRole('button', { name: 'More actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delete replay', exact: true }).click();
  return page.getByRole('dialog', { name: 'Delete replay?', exact: true });
}

test('the replay card names its recording and cancel sends no deletion request', async ({ page }) => {
  const { base, id, title } = await recording(page);
  let deletes = 0;
  await page.route(`**/api/replays/${id}`, async (route) => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    deletes += 1;
    await route.fulfill({ status: 204 });
  });
  await gotoHydrated(page, base);
  const actions = page.getByRole('button', { name: `Actions for ${title}`, exact: true });
  await actions.click();
  await page.getByRole('menuitem', { name: 'Delete replay', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Delete replay?', exact: true });
  await expect(confirmation).toContainText(title);
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(confirmation).toBeHidden();
  expect(deletes).toBe(0);
});

test('the replay card dispatches deletion only for its own recording', async ({ page }) => {
  const { base, id, title } = await recording(page);
  const removed: string[] = [];
  await page.route('**/api/replays/**', async (route) => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    removed.push(new URL(route.request().url()).pathname);
    await route.fulfill({ status: 204 });
  });
  await gotoHydrated(page, base);
  await page.getByRole('button', { name: `Actions for ${title}`, exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delete replay', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Delete replay?', exact: true });
  await expect(confirmation).toContainText(title);
  await confirmation.getByRole('button', { name: 'Move to trash', exact: true }).click();
  await expect(confirmation).toBeHidden();
  expect(removed).toEqual([`/api/replays/${id}`]);
  expect(new URL(page.url()).pathname).toBe('/');
});

test('deleting from the viewer targets only that recording and returns to the feed', async ({ page }) => {
  const { base, id, title } = await recording(page);
  const removed: string[] = [];
  await page.route('**/api/replays/**', async (route) => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    removed.push(new URL(route.request().url()).pathname);
    await route.fulfill({ status: 204 });
  });
  await openReplay(page, `${base}/r/${id}`);
  const confirmation = await viewerDelete(page);
  await expect(confirmation).toContainText(title);
  await confirmation.getByRole('button', { name: 'Move to trash', exact: true }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe('/');
  expect(removed).toEqual([`/api/replays/${id}`]);
});

test('a kept replay stays in its confirmation with the server protection message', async ({ page }) => {
  const { base, id, title } = await recording(page);
  let deletes = 0;
  await page.route(`**/api/replays/${id}`, async (route) => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    deletes += 1;
    await route.fulfill({ status: 409, json: { error: 'kept' } });
  });
  await openReplay(page, `${base}/r/${id}`);
  const confirmation = await viewerDelete(page);
  await confirmation.getByRole('button', { name: 'Move to trash', exact: true }).click();
  await expect(confirmation.getByRole('alert')).toHaveText('This replay is kept. Release its keep before deleting it.');
  await expect(confirmation).toContainText(title);
  await expect(confirmation.getByRole('button', { name: 'Move to trash', exact: true })).toBeEnabled();
  expect(deletes).toBe(1);
  expect(new URL(page.url()).pathname).toBe(`/r/${id}`);
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(confirmation).toBeHidden();
});
