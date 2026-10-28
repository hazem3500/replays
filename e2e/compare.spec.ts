import { expect, type Page, test } from '@playwright/test';

import { openReplay, origin } from './support.ts';

const compareUrl = (layout = 'grid') => `${origin()}/r/demo-shop?with=human-demo&layout=${layout}`;

async function titleOf(page: Page, id: string) {
  const body: unknown = await (await page.request.get(`${origin()}/api/replays/${id}`)).json();
  const meta = typeof body === 'object' && body !== null && 'meta' in body ? body.meta : undefined;
  const title = typeof meta === 'object' && meta !== null && 'title' in meta ? meta.title : undefined;
  if (typeof title !== 'string') throw new Error(`${id} has no title`);
  return title;
}

/** Tags every tile's iframe, so a remount (a new iframe) is visible afterwards. */
async function markPlayers(page: Page) {
  await expect(page.locator('.ct-tile iframe')).toHaveCount(2);
  await page.locator('.ct-tile iframe').evaluateAll((frames) => {
    for (const frame of frames) frame.setAttribute('data-marked', '');
  });
}

test('a replay compares with another in its own viewer, each tile under its own title', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openReplay(page, compareUrl());
  const tiles = page.getByTestId('compare-stage').locator('.ct-tile');
  await expect(tiles).toHaveCount(2);
  await expect(tiles.nth(0).locator('.ct-label')).toHaveText(await titleOf(page, 'demo-shop'));
  await expect(tiles.nth(1).locator('.ct-label')).toHaveText(await titleOf(page, 'human-demo'));
  await expect(page.getByRole('group', { name: 'Playback controls' })).toHaveCount(1);
  await expect(page.getByRole('tablist', { name: 'Replay diagnostics' })).toBeVisible();
});

test('inspecting a tile scopes the title, inspector and URL to it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openReplay(page, compareUrl());
  const other = await titleOf(page, 'human-demo');
  await page.getByRole('button', { name: `Inspect B: ${other}` }).click();
  await expect(page).toHaveURL(/focus=human-demo/);
  await expect(page.getByRole('heading', { level: 1, name: other })).toBeVisible();
  await expect(page.getByTestId('compare-scope').getByRole('radio', { checked: true })).toHaveAttribute('data-scope', 'human-demo');
  await page.getByTestId('compare-scope').getByRole('radio', { name: /^A: / }).click();
  await expect(page).not.toHaveURL(/focus=/);
});

test('layouts glide the same players: Grid, Spotlight and Single never remount a tile', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openReplay(page, compareUrl());
  await markPlayers(page);
  const layouts = page.getByTestId('layout-switch');
  await layouts.getByRole('radio', { name: 'Spotlight' }).click();
  await expect(page).toHaveURL(/layout=spotlight/);
  await expect(page.locator('.ct-tile[data-role="spotlight"]')).toHaveAttribute('data-tile-id', 'demo-shop');
  await layouts.getByRole('radio', { name: 'Single' }).click();
  await expect(page).not.toHaveURL(/layout=/);
  await expect(page.locator('.ct-tile[data-role="single"]')).toHaveCount(1);
  await layouts.getByRole('radio', { name: 'Grid' }).click();
  await expect(page.locator('.ct-tile[data-role="grid"]')).toHaveCount(2);
  await expect(page.locator('.ct-tile iframe[data-marked]')).toHaveCount(2);
});

test('the shared transport plays every recording from one clock', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openReplay(page, compareUrl());
  await page.keyboard.press('k');
  await expect(page.getByTestId('playhead')).not.toHaveText('0:00.0');
  await page.keyboard.press('k');
  const paused = await page.getByTestId('playhead').textContent();
  await page.waitForTimeout(300);
  await expect(page.getByTestId('playhead')).toHaveText(paused ?? '');
});

test('the top bar’s Compare adds a recording, and Back returns to the replay alone', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openReplay(page, `${origin()}/r/demo-shop`);
  await expect(page.getByTestId('compare-with')).toHaveText('Compare');
  await page.getByTestId('compare-with').click();
  const picker = page.getByTestId('compare-picker');
  await picker.getByRole('button', { name: await titleOf(page, 'human-demo') }).click();
  await expect(page).toHaveURL(/\?with=human-demo&layout=grid$/);
  await expect(page.locator('.ct-tile')).toHaveCount(2);
  await page.goBack();
  await expect(page.getByTestId('replay-player').locator('iframe')).toBeAttached();
  await expect(page.getByTestId('compare-stage')).toHaveCount(0);
});

test('removing the added recording leaves the replay on its own', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openReplay(page, compareUrl());
  const added = page.locator('.ct-tile[data-tile-id="human-demo"]');
  await added.hover();
  await added.getByTestId('tile-remove').click();
  await expect(page).not.toHaveURL(/with=/);
  await expect(page.getByTestId('replay-player').locator('iframe')).toBeAttached();
});

test('phones swipe through the compared recordings, the one in view in focus', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openReplay(page, compareUrl());
  const stage = page.getByTestId('compare-stage');
  await expect(stage).toHaveAttribute('data-layout', 'carousel');
  await stage.evaluate((element) => element.scrollTo({ left: element.clientWidth, behavior: 'instant' }));
  await expect(page).toHaveURL(/focus=human-demo/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
});
