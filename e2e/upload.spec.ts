import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

import { expect, type Page, test } from '@playwright/test';

import { uniqueId, serveApp, gotoHydrated } from './support.ts';

const server = serveApp();
const sample = JSON.parse(readFileSync(resolve(import.meta.dirname, '../sample/human-demo.json'), 'utf8')) as {
  meta: Record<string, unknown>;
  events: unknown[];
};

async function openDialog(page: Page) {
  await gotoHydrated(page, `${server().origin}/`);
  if ((page.viewportSize()?.width ?? 1280) <= 640) {
    // why: phones fold Upload into the header's menu sheet (IndexPhoneMenu.tsx).
    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('button', { name: /^Upload a replay/ }).click();
  } else await page.getByRole('button', { name: 'Upload', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Upload a replay' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Choose file…' })).toBeFocused();
  return dialog;
}

const upload = (dialog: ReturnType<Page['getByRole']>) => dialog.getByRole('button', { name: 'Upload', exact: true });

for (const width of [1280, 390]) {
  test(`uploads plain rrweb events with tags and opens the viewer at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    const dialog = await openDialog(page);
    await page.getByTestId('upload-input').setInputFiles({
      name: 'signup-flow.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(sample.events)),
    });
    const facts = dialog.getByRole('definition');
    await expect(facts.getByText('rrweb recording', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('status')).toHaveText(/^rrweb recording ready: \d+ events/);
    const title = dialog.getByRole('textbox', { name: 'Title' });
    await expect(title).toBeFocused();
    const label = `Uploaded at ${width} ${uniqueId('t')}`;
    await title.fill(label);
    await dialog.getByTestId('upload-tags').fill(`uploaded, width-${width}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    await upload(dialog).click();
    await expect(page).toHaveURL(/\/r\/[a-z0-9-]+$/);
    await expect(page.getByRole('heading', { level: 1, name: label })).toBeVisible();

    // The tags made it to the index filter.
    await gotoHydrated(page, `${server().origin}/?tag=width-${width}`);
    await expect(page.getByRole('link', { name: new RegExp(`^${label}`) })).toBeVisible();
  });
}

test('uploads a gzipped bundle and keeps its meta, tags included', async ({ page }) => {
  const dialog = await openDialog(page);
  const id = uniqueId('bundle');
  const bundle = { ...sample, meta: { ...sample.meta, id, title: 'Bundle from disk', tags: ['from-disk'] } };
  await page.getByTestId('upload-input').setInputFiles({
    name: 'replay.json.gz',
    mimeType: 'application/gzip',
    buffer: gzipSync(JSON.stringify(bundle)),
  });
  await expect(dialog.getByText('Replay bundle · human session')).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'Title' })).toHaveValue('Bundle from disk');
  await expect(dialog.getByTestId('upload-tags')).toHaveValue('from-disk');
  await upload(dialog).click();
  await expect(page).toHaveURL(new RegExp(`/r/${id}$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Bundle from disk' })).toBeVisible();
  const stored = (await (await page.request.get(`${server().origin}/api/replays/${id}`)).json()) as { meta: { tags?: string[] } };
  expect(stored.meta.tags).toEqual(['from-disk']);
});

test('a bundle uploaded for a review suite run opens in the suite workspace', async ({ page }) => {
  const api = `${server().origin}/api`;
  const suiteId = uniqueId('upload-suite');
  const now = new Date().toISOString();
  expect(
    (await page.request.put(`${api}/suites/${suiteId}`, { data: { version: 1, id: suiteId, title: 'Upload suite', createdAt: now } })).ok(),
  ).toBe(true);
  const registered = await page.request.put(`${api}/suites/${suiteId}/runs/attempt-1`, {
    data: { id: 'attempt-1', sequence: 1, label: 'Desktop: upload', status: 'passed', startedAt: now },
  });
  expect(registered.ok()).toBe(true);
  const dialog = await openDialog(page);
  const id = `${suiteId}-run`;
  const bundle = { ...sample, meta: { ...sample.meta, id, title: 'Suite upload' }, suiteRun: { suiteId, runId: 'attempt-1' } };
  await page.getByTestId('upload-input').setInputFiles({
    name: 'replay.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(bundle)),
  });
  await upload(dialog).click();
  await expect(page).toHaveURL(new RegExp(`/s/${suiteId}/r/${id}$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Desktop: upload' })).toBeVisible();
});

test('explains a file it cannot use and recovers', async ({ page }) => {
  const dialog = await openDialog(page);
  await page
    .getByTestId('upload-input')
    .setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{"events": [') });
  await expect(dialog.getByRole('alert')).toHaveText('This file is not valid JSON.');
  await expect(dialog.getByRole('button', { name: 'Choose file…' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Upload', exact: true })).toBeFocused();
});

test('rejects malformed tags before sending and keeps the preview editable', async ({ page }) => {
  const dialog = await openDialog(page);
  await page.getByTestId('upload-input').setInputFiles({
    name: 'tags.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(sample.events)),
  });
  await dialog.getByTestId('upload-tags').fill('Not Valid!');
  await upload(dialog).click();
  await expect(dialog.getByRole('alert')).toContainText('Tags use lower-case letters');
  await expect(dialog.getByTestId('upload-tags')).toBeFocused();
});

test('a server rejection is shown inline and the preview stays editable', async ({ page }) => {
  const dialog = await openDialog(page);
  const bundle = { ...sample, meta: { ...sample.meta, id: 'human-demo' } };
  await page.getByTestId('upload-input').setInputFiles({
    name: 'human-demo.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(bundle)),
  });
  await upload(dialog).click();
  await expect(dialog.getByRole('alert')).toContainText('A replay with this id is already stored.');
  await expect(dialog.getByRole('link', { name: 'Open the stored replay' })).toHaveAttribute('href', /\/r\/human-demo$/);
  await expect(dialog.getByRole('textbox', { name: 'Title' })).toBeEnabled();
});
