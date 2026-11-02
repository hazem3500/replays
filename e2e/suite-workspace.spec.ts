import { rm } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { createSuite, openReplay, uniqueId, serveApp } from './support.ts';

const server = serveApp();

/** A suite with a passing run, a failing run and a run that never uploaded a recording. */
async function threeRuns(request: Parameters<typeof createSuite>[0]) {
  const suite = uniqueId('suite');
  const one = `${suite}-one`;
  const two = `${suite}-two`;
  await createSuite(request, server().origin, suite, [
    { id: 'attempt-1', label: 'Desktop: run 1', status: 'passed', replayId: one },
    { id: 'attempt-2', label: 'Desktop: run 2', status: 'failed', replayId: two },
    { id: 'attempt-3', label: 'Desktop: run 3', status: 'passed' },
  ]);
  return { suite, one, two };
}

test('a suite opens on its first failed run; J and Back move between runs', async ({ page }) => {
  const { suite, one, two } = await threeRuns(page.request);
  await page.goto(`${server().origin}/s/${suite}`);
  await expect(page).toHaveURL(new RegExp(`/s/${suite}/r/${two}$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Desktop: run 2' })).toBeVisible();
  await expect(page.getByTestId('run-status')).toHaveText('Failed');
  const sidebar = page.getByRole('complementary', { name: 'Review suite' });
  await expect(sidebar.locator('[aria-current="page"]')).toHaveAttribute('data-replay-id', two);
  await expect(sidebar.locator('[aria-disabled="true"]')).toContainText('No recording');

  await page.getByTestId('network-tab').click();
  await page.keyboard.press('Shift+J');
  await expect(page).toHaveURL(new RegExp(`/r/${one}$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Desktop: run 1' })).toBeVisible();
  // The inspector tab carries over; the playhead starts again at zero.
  await expect(page.getByTestId('network-tab')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('playhead')).toHaveText('0:00.0');

  await page.keyboard.press('j');
  await expect(page).toHaveURL(new RegExp(`/r/${two}$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Desktop: run 2' })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/r/${one}$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Desktop: run 1' })).toBeVisible();
});

test('a run without a source of its own shows the suite’s subject', async ({ page }) => {
  const { suite, one } = await threeRuns(page.request);
  await openReplay(page, `${server().origin}/s/${suite}/r/${one}`);
  await expect(page.getByTestId('source-chip')).toHaveAttribute('href', 'https://github.com/example-org/shop-demo/pull/9');
});

test('a suite link with #step-n keeps the step on the landing run', async ({ page }) => {
  const { suite, two } = await threeRuns(page.request);
  await page.goto(`${server().origin}/s/${suite}#step-3`);
  await expect(page).toHaveURL(new RegExp(`/s/${suite}/r/${two}#step-3$`));
  await expect(page.getByTestId('step-timeline').locator('[data-step-index="2"]')).toHaveAttribute('aria-current', 'step');
});

test('the runs sidebar opens expanded on every visit; collapsing only lasts for the visit', async ({ page }) => {
  const { suite, one } = await threeRuns(page.request);
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto(`${server().origin}/s/${suite}/r/${one}`);
  const sidebar = page.getByRole('complementary', { name: 'Review suite' });
  const heading = sidebar.getByRole('heading', { name: `Review ${suite}` });
  await expect(heading).toBeVisible();
  await sidebar.getByRole('button', { name: 'Collapse runs sidebar' }).click();
  await expect(heading).toHaveCount(0);
  await page.reload();
  await expect(heading).toBeVisible();
});

test('at 390 px the sidebar becomes a run switcher in the topbar title', async ({ page }) => {
  const { suite, one, two } = await threeRuns(page.request);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${server().origin}/s/${suite}/r/${one}`);
  await expect(page.getByRole('complementary', { name: 'Review suite' })).toHaveCount(0);
  await expect(page.getByRole('tablist', { name: 'Replay diagnostics' })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('heading', { level: 1, name: /Run 1 of 2\s+Desktop: run 1/ })).toBeVisible();
  await page.getByTestId('title-menu').click();
  await page.getByRole('menuitemradio', { name: /Desktop: run 2/ }).click();
  await expect(page).toHaveURL(new RegExp(`/r/${two}$`));
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
});

test('the index nests a suite’s runs, and a run whose replay expired is skipped and marked', async ({ page }) => {
  const { suite, one, two } = await threeRuns(page.request);
  // Retention prunes the replay; the suite still references it.
  await rm(join(server().dataDir, two), { recursive: true });
  await page.goto(`${server().origin}/s/${suite}`);
  await expect(page).toHaveURL(new RegExp(`/r/${one}$`));
  const sidebar = page.getByRole('complementary', { name: 'Review suite' });
  await expect(sidebar.locator('[aria-current="page"]')).toHaveAttribute('data-replay-id', one);
  await expect(sidebar.locator('[aria-disabled="true"]').first()).toContainText('Expired');

  await page.goto(`${server().origin}/`);
  await page.getByRole('button', { name: new RegExp(`^Runs of Review ${suite}`) }).click();
  const menu = page.getByRole('menu', { name: `Runs of Review ${suite}` });
  await expect(menu.getByRole('menuitem', { name: /Desktop: run 1/ })).toHaveAttribute('href', new RegExp(`/r/${one}$`));
  await expect(menu.getByRole('menuitem', { name: /Desktop: run 2, Expired/ })).toHaveAttribute('aria-disabled', 'true');
});

test('the sidebar pin keeps the suite on click', async ({ page }) => {
  const { suite, one } = await threeRuns(page.request);
  await openReplay(page, `${server().origin}/s/${suite}/r/${one}`);
  const pin = page.getByRole('complementary', { name: 'Review suite' }).getByTestId('keep-suite');
  await pin.click();
  await expect(pin).toHaveAttribute('aria-pressed', 'true');
});

test('the layout switch shows the suite’s runs side by side in place, without remounting a tile', async ({ page }) => {
  const { suite, one, two } = await threeRuns(page.request);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openReplay(page, `${server().origin}/s/${suite}/r/${two}`);
  const sidebar = page.getByRole('complementary', { name: 'Review suite' });
  const layouts = sidebar.getByRole('radiogroup', { name: 'Layout' });

  await layouts.getByRole('radio', { name: 'Grid' }).click();
  await expect(page).toHaveURL(new RegExp(`/s/${suite}/r/${two}\\?layout=grid$`));
  await expect(page.locator('.mt-stage-area')).toHaveAttribute('data-layout', 'grid');
  const frames = page.locator('.mt-tile iframe');
  await expect(frames).toHaveCount(2);
  await frames.evaluateAll((elements) => elements.forEach((element) => element.setAttribute('data-kept', '')));

  await layouts.getByRole('radio', { name: 'Spotlight' }).click();
  await expect(page).toHaveURL(new RegExp(`\\?layout=spotlight&pin=${two}$`));
  await expect(page.locator(`.mt-tile[data-tile-id="${two}"]`)).toHaveAttribute('data-role', 'spotlight');
  await sidebar.locator(`[data-replay-id="${one}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/r/${one}\\?layout=spotlight&pin=${one}$`));
  await expect(page.locator(`.mt-tile[data-tile-id="${one}"]`)).toHaveAttribute('data-role', 'spotlight');
  await expect(page.locator('.mt-tile iframe[data-kept]')).toHaveCount(2);

  await layouts.getByRole('radio', { name: 'Single' }).click();
  await expect(page).toHaveURL(new RegExp(`/s/${suite}/r/${one}$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Desktop: run 1' })).toBeVisible();
  await expect(page.locator('.mt-tile')).toHaveCount(0);
});

test('a suite link with ?layout=grid opens on its runs as tiles', async ({ page }) => {
  const { suite, one, two } = await threeRuns(page.request);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${server().origin}/s/${suite}?layout=grid`);
  await expect(page).toHaveURL(new RegExp(`/s/${suite}/r/${two}\\?layout=grid$`));
  await expect(page.locator('.mt-tile')).toHaveCount(2);
  await expect(page.locator(`.mt-tile[data-tile-id="${one}"] .mt-label`)).toHaveText('Desktop: run 1');
  await expect(page.getByRole('radio', { name: 'Grid' })).toHaveAttribute('aria-checked', 'true');
});

test('at 390 px “Show all runs” swaps the viewer for swipeable tiles and Single brings it back', async ({ page }) => {
  const { suite, one } = await threeRuns(page.request);
  await page.setViewportSize({ width: 390, height: 844 });
  await openReplay(page, `${server().origin}/s/${suite}/r/${one}`);
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByTestId('show-all-runs').click();
  await expect(page).toHaveURL(new RegExp(`/r/${one}\\?layout=grid$`));
  await expect(page.locator('.mt-stage-area')).toHaveAttribute('data-layout', 'carousel');
  await page
    .locator(`.mt-tile[data-tile-id="${one}"]`)
    .getByRole('button', { name: /^More for / })
    .click();
  const sheet = page.getByTestId('tile-sheet');
  await expect(sheet.getByRole('button', { name: 'Hide from comparison' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await page.getByRole('radio', { name: 'Single' }).click();
  await expect(page).toHaveURL(new RegExp(`/r/${one}$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Desktop: run 1' })).toBeVisible();
});

test('Grid keeps the diagnostics dock under the tiles, scoped to one run and flipped without moving the tiles', async ({ page }) => {
  const { suite, one, two } = await threeRuns(page.request);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${server().origin}/s/${suite}/r/${two}?layout=grid`);
  await expect(page.locator('.mt-tile iframe')).toHaveCount(2);
  await page.locator('.mt-tile iframe').evaluateAll((elements) => elements.forEach((element) => element.setAttribute('data-kept', '')));

  const dock = page.locator('.mt-dock');
  const runs = dock.getByRole('radiogroup', { name: 'Recording the diagnostics show' });
  await expect(runs.getByRole('radio', { checked: true })).toContainText('Desktop: run 1');
  await runs.getByRole('radio', { name: /Desktop: run 2/ }).click();
  await expect(runs.getByRole('radio', { checked: true })).toContainText('Desktop: run 2');
  await dock.getByRole('tab', { name: /Network/ }).click();
  await expect(dock.getByRole('tab', { name: /Network/ })).toHaveAttribute('aria-selected', 'true');

  await page.locator(`.mt-tile[data-tile-id="${one}"]`).click({ position: { x: 40, y: 40 } });
  await expect(runs.getByRole('radio', { checked: true })).toContainText('Desktop: run 1');
  await expect(page.locator('.mt-stage-area')).toHaveAttribute('data-layout', 'grid');
  await expect(page.locator('.mt-tile iframe[data-kept]')).toHaveCount(2);
});
