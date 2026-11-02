import { rm } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { boxOf, createSuite, openReplay, uniqueId, serveApp, gotoHydrated } from './support.ts';

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
  // why: comparing, the switch above the stage names the runs and says which is on show; the title keeps its room.
  await expect(page.getByRole('heading', { level: 1, name: 'Desktop: run 1', exact: true })).toBeVisible();
  await expect(page.getByTestId('phone-switch').getByRole('radio', { checked: true })).toHaveAccessibleName(/^Run 1\b/);
  await page.getByTestId('title-menu').click();
  await page.getByRole('menuitemradio', { name: /Desktop: run 2/ }).click();
  await expect(page).toHaveURL(new RegExp(`/r/${two}$`));
  await expect(page.getByTestId('phone-switch').getByRole('radio', { checked: true })).toHaveAccessibleName(/^Run 2\b/);
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

  await gotoHydrated(page, `${server().origin}/`);
  await page.getByRole('button', { name: new RegExp(`^Runs of Review ${suite}`) }).click();
  const menu = page.getByRole('menu', { name: `Runs of Review ${suite}` });
  await expect(menu.getByRole('menuitem', { name: /Desktop: run 1/ })).toHaveAttribute('href', new RegExp(`/r/${one}$`));
  await expect(menu.getByRole('menuitem', { name: /Desktop: run 2, Expired/ })).toHaveAttribute('aria-disabled', 'true');
});

test('a suite with two recordings opens comparing its runs; the sidebar moves the focus, not the players', async ({ page }) => {
  const { suite, one } = await threeRuns(page.request);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openReplay(page, `${server().origin}/s/${suite}`);
  const tiles = page.getByTestId('compare-stage').locator('.ct-tile');
  // why: the shared "Desktop:" is dropped, so each tile, and the scope, reads by what tells it apart.
  await expect(tiles.locator('.ct-name')).toHaveText(['Run 1', 'Run 2']);
  await expect(page.getByTestId('compare-scope').getByRole('radio')).toHaveText(['Run 1', 'Run 2']);
  await expect(page.locator('.ct-tile iframe')).toHaveCount(2);
  await page.locator('.ct-tile iframe').evaluateAll((frames) => {
    for (const frame of frames) frame.setAttribute('data-marked', '');
  });
  await page.getByRole('complementary', { name: 'Review suite' }).locator(`[data-replay-id="${one}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/r/${one}$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Desktop: run 1' })).toBeVisible();
  await page.getByTestId('layout-switch').getByRole('radio', { name: 'Single' }).click();
  await expect(page).toHaveURL(new RegExp(`/r/${one}\\?layout=single$`));
  await expect(page.locator('.ct-tile iframe[data-marked]')).toHaveCount(2);
});

test('a suite link that names a run opens comparing, that run in the spotlight', async ({ page }) => {
  const { suite, two } = await threeRuns(page.request);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openReplay(page, `${server().origin}/s/${suite}/r/${two}`);
  await expect(page.locator('.ct-tile[data-role="spotlight"]')).toHaveAttribute('data-tile-id', two);
  await expect(page.getByTestId('layout-switch').getByRole('radio', { checked: true })).toHaveAttribute('data-layout', 'spotlight');
});

test('on phones a suite row puts its run strip on the line under its meta, a short suite as well as a long one', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const short = uniqueId('short');
  const long = uniqueId('long');
  await createSuite(page.request, server().origin, short, [{ id: 'attempt-1', label: 'Desktop', status: 'passed' }]);
  const runs = Array.from({ length: 8 }, (_, index) => ({
    id: `attempt-${index + 1}`,
    label: `Run ${index + 1}`,
    status: 'passed' as const,
  }));
  await createSuite(page.request, server().origin, long, runs);
  await page.goto(`${server().origin}/`);
  for (const id of [short, long]) {
    const row = page.locator('.feed-suite', { has: page.getByRole('link', { name: new RegExp(`^Review ${id},`) }) });
    const facts = await boxOf(row.locator('.feed-facts'));
    const strip = await boxOf(row.getByRole('button', { name: new RegExp(`^Runs of Review ${id}`) }));
    expect(strip.y).toBeGreaterThanOrEqual(facts.y + facts.height);
  }
});

test('the suite thumbnail and title both open the card in grid view', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const { suite } = await threeRuns(page.request);
  for (const target of ['thumbnail', 'title'] as const) {
    await gotoHydrated(page, server().origin);
    const grid = page.getByRole('button', { name: 'Grid', exact: true });
    if ((await grid.getAttribute('aria-pressed')) !== 'true') await grid.click();
    const card = page.locator(`[data-entry-id="suite:${suite}"]`);
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('data-view', 'grid');
    if (target === 'thumbnail') {
      const poster = card.locator('.shuffle-window > .poster:not(.poster-outgoing)');
      const box = await boxOf(poster);
      const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await expect
        .poll(() => page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('a')?.classList.contains('row-target'), point))
        .toBe(true);
      await page.mouse.click(point.x, point.y);
    } else await card.locator('.row-target').click();
    await expect(page).toHaveURL(new RegExp(`/s/${suite}/r/`));
  }
});
