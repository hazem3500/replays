import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { origin, serveApp, gotoHydrated } from './support.ts';

/** A server with no samples: the library is empty on the server itself, which a server-rendered index reads in process. */
const empty = serveApp(() => ({ SAMPLE_DIR: mkdtempSync(join(tmpdir(), 'replays-empty-')) }));

test('an empty library offers its one action without list controls', async ({ page }) => {
  await gotoHydrated(page, `${empty().origin}/`);
  await expect(page.getByRole('heading', { name: 'Your first replay' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Filter/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Sort/ })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Layout' })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Search replays' })).toBeVisible();
});

test('a search with no results keeps the list controls, since it is not a first run', async ({ page }) => {
  await gotoHydrated(page, `${origin()}/?q=nothing-matches-this`);
  await expect(page.getByRole('button', { name: /^Sort/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your first replay' })).toHaveCount(0);
});
