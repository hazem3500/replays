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
  // Long labels wrap in the phone title sheet so the selected check/status centering is real geometry.
  const longOne = 'Turning the mock on from a review link, so the phone run sheet wraps this label onto a second line';
  const longTwo = 'A second wrapped run label for switching away from the selected two-line row';
  const suite = uniqueId('suite');
  const one = `${suite}-one`;
  const two = `${suite}-two`;
  await createSuite(page.request, server().origin, suite, [
    { id: 'attempt-1', label: longOne, status: 'passed', replayId: one },
    { id: 'attempt-2', label: longTwo, status: 'failed', replayId: two },
    { id: 'attempt-3', label: 'Desktop: run 3', status: 'passed' },
  ]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${server().origin}/s/${suite}/r/${one}`);
  await expect(page.getByRole('complementary', { name: 'Review suite' })).toHaveCount(0);
  await expect(page.getByRole('tablist', { name: 'Replay diagnostics' })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('heading', { level: 1, name: longOne, exact: true })).toBeVisible();
  await expect(page.getByTestId('compare-stage')).toHaveAttribute('data-layout', 'single');
  await expect(page.locator('.ct-label')).toHaveCount(0);
  await expect(page.locator('.ct-tile[data-role="single"]')).toHaveAccessibleName(new RegExp(longOne.slice(0, 24)));
  await expect(page.getByTestId('phone-switch')).toHaveCount(0);
  await page.getByTestId('title-menu').click();
  const selected = page.getByRole('menuitemradio', { checked: true });
  await expect(selected).toContainText(longOne.slice(0, 24));
  const label = selected.locator('.run-picker-label');
  await expect.poll(async () => (await label.boundingBox())?.height ?? 0).toBeGreaterThan(20);
  await expect
    .poll(async () => {
      const check = await selected.locator('[data-slot="dropdown-menu-radio-item-indicator"]').boundingBox();
      const status = await selected.locator('.status-dot').boundingBox();
      if (!check || !status) return Number.POSITIVE_INFINITY;
      const checkMid = check.y + check.height / 2;
      const statusMid = status.y + status.height / 2;
      return Math.abs(checkMid - statusMid);
    })
    .toBeLessThan(4);
  await page.getByRole('menuitemradio', { name: new RegExp(longTwo.slice(0, 24)) }).click();
  await expect(page).toHaveURL(new RegExp(`/r/${two}$`));
  await expect(page.locator('.ct-tile[data-role="single"]')).toHaveAccessibleName(new RegExp(longTwo.slice(0, 24)));
  await expect(page.locator('.ct-label')).toHaveCount(0);
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

test('a comparison suite opens single and retains grid switching and layout history', async ({ page }) => {
  const { suite, one } = await threeRuns(page.request);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openReplay(page, `${server().origin}/s/${suite}?view=compare&layout=single`);
  const tiles = page.getByTestId('compare-stage').locator('.ct-tile');
  await expect(page.getByTestId('compare-stage')).toHaveAttribute('data-layout', 'single');
  await expect(tiles.locator('.ct-label')).toHaveCount(0);
  await page.getByTestId('layout-switch').getByRole('radio', { name: 'Grid', exact: true }).click();
  await expect(page.getByTestId('compare-stage')).toHaveAttribute('data-layout', 'grid');
  await expect(tiles.locator('.ct-name')).toHaveText(['Run 1', 'Run 2']);
  await expect(page.getByTestId('compare-scope').getByRole('radio')).toHaveText(['Run 1', 'Run 2']);
  await expect(page.locator('.ct-tile iframe')).toHaveCount(2);
  await page.locator('.ct-tile iframe').evaluateAll((frames) => {
    for (const frame of frames) frame.setAttribute('data-marked', '');
  });
  await page.getByRole('complementary', { name: 'Review suite' }).locator(`[data-replay-id="${one}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/r/${one}\\?view=compare$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Desktop: run 1' })).toBeVisible();
  await page.getByTestId('layout-switch').getByRole('radio', { name: 'Single' }).click();
  await expect(page).toHaveURL(new RegExp(`/r/${one}\\?view=compare&layout=single$`));
  await expect(tiles.locator('.ct-label')).toHaveCount(0);
  await page.goBack();
  await expect(page.getByTestId('compare-stage')).toHaveAttribute('data-layout', 'grid');
  await page.goForward();
  await expect(page.getByTestId('compare-stage')).toHaveAttribute('data-layout', 'single');
  await page.getByTestId('layout-switch').getByRole('radio', { name: 'Grid', exact: true }).click();
  await expect(page.getByTestId('compare-stage')).toHaveAttribute('data-layout', 'grid');
  await expect(page.locator('.ct-tile iframe[data-marked]')).toHaveCount(2);
});

test('each grid tile retains its sidebar colour and hover identity', async ({ page }) => {
  const { suite, one, two } = await threeRuns(page.request);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openReplay(page, `${server().origin}/s/${suite}?view=compare`);
  const sidebar = page.getByRole('complementary', { name: 'Review suite' });
  const stage = page.getByTestId('compare-stage');
  for (const id of [one, two]) {
    const swatch = await sidebar
      .locator(`[data-replay-id="${id}"] .run-swatch`)
      .evaluate((element) => getComputedStyle(element).backgroundColor);
    await expect
      .poll(() => stage.locator(`[data-tile-id="${id}"]`).evaluate((tile) => getComputedStyle(tile, '::after').boxShadow))
      .toContain(swatch);
  }
  const label = stage.locator(`[data-tile-id="${two}"] .ct-label`);
  await expect(label).toBeHidden();
  await stage.locator(`[data-tile-id="${two}"]`).hover();
  await expect(label).toBeVisible();
  await expect(label).toHaveText('Run 2');
  await page.mouse.move(0, 0);
  await expect(label).toBeHidden();
});

test('a suite that is not a comparison has no layout switcher and swaps runs in place', async ({ page }) => {
  const { suite, one, two } = await threeRuns(page.request);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openReplay(page, `${server().origin}/s/${suite}/r/${two}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Desktop: run 2' })).toBeVisible();
  await expect(page.getByTestId('layout-switch')).toHaveCount(0);
  await expect(page.getByTestId('compare-stage')).toHaveCount(0);
  await page.getByRole('complementary', { name: 'Review suite' }).locator(`[data-replay-id="${one}"]`).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Desktop: run 1' })).toBeVisible();
  await expect(page.getByTestId('layout-switch')).toHaveCount(0);
});

for (const search of ['?view=compare&layout=grid', '?view=compare&layout=spotlight', '?view=compare', '?view=compare&layout=single']) {
  test(`a suite honors explicit layout intent ${search}`, async ({ page }) => {
    const { suite, two } = await threeRuns(page.request);
    await openReplay(page, `${server().origin}/s/${suite}/r/${two}${search}`);
    let expected = 'grid';
    if (search.includes('spotlight')) expected = 'spotlight';
    if (search.includes('single')) expected = 'single';
    await expect(page.getByTestId('compare-stage')).toHaveAttribute('data-layout', expected);
    await expect(page.locator('.ct-label')).toHaveCount(expected === 'single' ? 0 : 2);
  });
}

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

test('Motion keeps the original card lift and preserves the entry through list and grid changes', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 1280, height: 800 });
  const { suite } = await threeRuns(page.request);
  await gotoHydrated(page, server().origin);
  await page.getByRole('button', { name: 'Grid', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.hasAttribute('data-feed-transition'))).toBe(false);
  const card = page.locator(`[data-entry-id="suite:${suite}"]`);
  await expect(card).toBeVisible();
  await card.evaluate((element) => element.setAttribute('data-persistent-entry', ''));
  const before = await boxOf(card);
  await card.hover();
  await expect.poll(async () => Math.abs((await boxOf(card)).y - before.y + 2)).toBeLessThan(0.25);
  await expect(card.locator('.feed-hover')).toHaveCSS('opacity', '1');
  await page.mouse.move(0, 0);
  await expect.poll(async () => Math.abs((await boxOf(card)).y - before.y)).toBeLessThan(0.25);
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.hasAttribute('data-feed-transition'))).toBe(false);
  await expect(card).toHaveAttribute('data-persistent-entry', '');
  await page.getByRole('button', { name: 'Grid', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.hasAttribute('data-feed-transition'))).toBe(false);
  await expect(card).toHaveAttribute('data-persistent-entry', '');
});

test('the redesigned sidebar keeps full suite headings and readable run identities when an old narrow width was saved', async ({
  page,
}) => {
  const suite = uniqueId('checkout-design-review-before-after-across-browsers');
  const before = `${suite}-before`;
  await createSuite(page.request, server().origin, suite, [
    { id: 'before', label: 'Checkout design review · Before · fictional demo', status: 'passed', replayId: before },
    { id: 'after', label: 'Checkout design review · After · fictional demo', status: 'passed', replayId: `${suite}-after` },
  ]);
  await page.addInitScript(() => localStorage.setItem('suite-sidebar-width', '201'));
  await page.setViewportSize({ width: 1000, height: 800 });
  await openReplay(page, `${server().origin}/s/${suite}/r/${before}`);
  const sidebar = page.getByRole('complementary', { name: 'Review suite' });
  expect((await boxOf(sidebar)).width).toBeGreaterThanOrEqual(240);
  const heading = sidebar.getByRole('heading', { name: `Review ${suite}` });
  expect(await heading.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);
  await expect(sidebar.locator('.run-label')).toHaveText(['Before', 'After']);
  await expect(sidebar.locator('.suite-sidebar-overview')).toContainText('2 runs');
  expect(
    await sidebar.locator('.suite-sidebar-overview').evaluate((element) => element.scrollWidth - element.clientWidth),
  ).toBeLessThanOrEqual(1);
  await expect(sidebar.locator('[aria-current="page"]')).toHaveAccessibleName(/Checkout design review · Before · fictional demo/);
  const selected = sidebar.locator('[aria-current="page"]');
  expect(await selected.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
});

test.describe('Add a recording', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test('is offered on a single replay and in no part of a suite', async ({ page }) => {
    const more = page.getByRole('button', { name: 'More actions', exact: true });

    await openReplay(page, `${server().origin}/r/demo-shop`);
    await more.click();
    await expect(page.getByTestId('compare-with')).toHaveText('Compare with…');
    await page.keyboard.press('Escape');

    const { suite } = await threeRuns(page.request);
    await openReplay(page, `${server().origin}/s/${suite}`);
    await expect(page.getByTestId('compare-stage')).toBeVisible();
    await more.click();
    await expect(page.getByTestId('delete-replay')).toBeVisible();
    await expect(page.getByTestId('compare-with')).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: 'Add a recording' })).toHaveCount(0);
    await page.keyboard.press('Escape');

    const solo = uniqueId('solo');
    const run = `${solo}-run`;
    await createSuite(page.request, server().origin, solo, [{ id: 'only', label: 'Only run', status: 'passed', replayId: run }]);
    await openReplay(page, `${server().origin}/s/${solo}/r/${run}`);
    await expect(page.getByTestId('compare-stage')).toHaveCount(0);
    await more.click();
    await expect(page.getByTestId('delete-replay')).toBeVisible();
    await expect(page.getByTestId('compare-with')).toHaveCount(0);
  });
});
