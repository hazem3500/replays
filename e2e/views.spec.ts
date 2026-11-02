import { expect, type Page, test } from '@playwright/test';

import { createSuite, openReplay, origin, uniqueId } from './support.ts';

const shell = (page: Page) => page.locator('main.app-shell:not([aria-busy="true"])');

async function pickView(page: Page, label: string) {
  await page.getByRole('button', { name: 'More actions', exact: true }).click();
  await page.getByRole('menuitemradio', { name: label }).click();
  // why: the menu fades out; the next pick must not reach into the closing one.
  await expect(page.getByTestId('view-standard')).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
});

test('a ?view= link opens in that view with its headline and opening moment', async ({ page }) => {
  await openReplay(page, `${origin()}/r/demo-shop?view=debug`);
  await expect(shell(page)).toHaveAttribute('data-view', 'debug');
  await expect(page.getByTestId('view-switcher')).toHaveCount(0);
  await expect(page.getByTestId('headline-issues')).toContainText('first at');
  // why: demo-shop's first error is the failed coupon request at 7.174 s; Debug lands one second before it.
  await expect(page.getByTestId('playhead')).toHaveText('0:06.2');
  await expect(page.getByTestId('network-tab')).toHaveAttribute('aria-selected', 'true');
});

test('switching views keeps the player and the playhead, and the address names the view', async ({ page }) => {
  await openReplay(page, `${origin()}/r/demo-shop?t=3`);
  await page
    .getByTestId('replay-player')
    .locator('iframe')
    .evaluate((frame) => frame.setAttribute('data-marked', ''));
  await pickView(page, 'Review');
  await expect(page).toHaveURL(/\?t=3&view=review$/);
  await expect(shell(page)).toHaveAttribute('data-view', 'review');
  // why: Review leads with Comments (on in this server), then Context.
  await expect(page.getByRole('tab').first()).toHaveAttribute('id', 'comments-tab');
  await expect(page.getByTestId('comments-tab')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('replay-player').locator('iframe[data-marked]')).toHaveCount(1);
  await expect(page.getByTestId('playhead')).toHaveText('0:03.0');
  await pickView(page, 'Standard');
  await expect(page).not.toHaveURL(/view=/);
});

test('V steps to the next view and Shift V back', async ({ page }) => {
  await openReplay(page, `${origin()}/r/demo-shop`);
  await page.keyboard.press('v');
  await expect(shell(page)).toHaveAttribute('data-view', 'compare');
  await page.keyboard.press('Shift+V');
  await expect(shell(page)).toHaveAttribute('data-view', 'standard');
});

test('Walkthrough hides the inspector until Show details opens it for this visit', async ({ page }) => {
  await openReplay(page, `${origin()}/r/demo-shop?view=walkthrough`);
  await expect(shell(page)).toHaveAttribute('data-inspector-hidden', 'true');
  await expect(page.getByTestId('console-tab')).toHaveCount(0);
  await page.getByTestId('show-details').click();
  await expect(page.getByTestId('console-tab')).toBeVisible();
});

test('a folded panel is remembered in the view it was folded in only', async ({ page }) => {
  await openReplay(page, `${origin()}/r/demo-shop`);
  await page.getByTestId('inspector-collapse').click();
  await expect(shell(page)).toHaveAttribute('data-inspector-collapsed', 'true');
  await pickView(page, 'Debug');
  await expect(shell(page)).not.toHaveAttribute('data-inspector-collapsed');
  await pickView(page, 'Standard');
  await expect(shell(page)).toHaveAttribute('data-inspector-collapsed', 'true');
});

test('a suite shows comparison chips only when its runs sidebar is collapsed', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const suite = uniqueId('views-suite');
  await createSuite(page.request, origin(), suite, [
    { id: 'one', label: 'Run 1', status: 'passed', replayId: uniqueId('views-one') },
    { id: 'two', label: 'Run 2', status: 'failed', replayId: uniqueId('views-two') },
  ]);
  await openReplay(page, `${origin()}/s/${suite}`);
  await expect(shell(page)).toHaveAttribute('data-view', 'compare');
  await expect(page.getByTestId('compare-summary')).toHaveCount(0);
  await page.getByRole('button', { name: 'Collapse runs sidebar' }).click();
  await expect(page.getByTestId('compare-summary').getByRole('button')).toHaveCount(2);
  await page.getByRole('button', { name: 'Expand runs sidebar' }).click();
  await expect(page.getByTestId('compare-summary')).toHaveCount(0);
});

test('switching suite runs keeps the export action while the next run is checked', async ({ page }) => {
  const suite = uniqueId('stable-toolbar');
  const one = uniqueId('toolbar-one');
  const two = uniqueId('toolbar-two');
  await createSuite(page.request, origin(), suite, [
    { id: 'one', label: 'First run', status: 'passed', replayId: one },
    { id: 'two', label: 'Second run', status: 'passed', replayId: two },
  ]);
  let release!: () => void;
  let checking = false;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/replays/*/render*', async (route) => {
    if (route.request().url().includes(two)) {
      checking = true;
      await held;
    }
    await route.fulfill({ json: { status: 'none' } });
  });
  try {
    await openReplay(page, `${origin()}/s/${suite}/r/${one}`);
    const download = page.getByTestId('download-video');
    await expect(download).toBeVisible();
    await page.locator(`[data-replay-id="${two}"]`).click();
    await expect.poll(() => checking).toBe(true);
    await expect(download).toBeVisible();
    await expect(download).toHaveAttribute('aria-disabled', 'true');
    release();
    await expect(download).not.toHaveAttribute('aria-disabled', 'true');
  } finally {
    release();
  }
});
