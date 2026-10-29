import { expect, type Page, test } from '@playwright/test';

import { createSuite, openReplay, origin, uniqueId } from './support.ts';

const shell = (page: Page) => page.locator('main.app-shell:not([aria-busy="true"])');

async function pickView(page: Page, label: string) {
  await page.getByTestId('view-switcher').click();
  await page.getByRole('menuitemradio', { name: label }).click();
  // why: the menu fades out; the next pick must not reach into the closing one.
  await expect(page.getByTestId('view-switcher')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('view-standard')).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
});

test('a ?view= link opens in that view: its switcher label, headline and opening moment', async ({ page }) => {
  await openReplay(page, `${origin()}/r/demo-shop?view=debug`);
  await expect(shell(page)).toHaveAttribute('data-view', 'debug');
  await expect(page.getByTestId('view-switcher')).toHaveText(/View: Debug/);
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
  await expect(page.getByTestId('view-switcher')).toHaveAttribute('data-view', 'compare');
  await page.keyboard.press('Shift+V');
  await expect(page.getByTestId('view-switcher')).toHaveAttribute('data-view', 'standard');
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

test('a suite with two runs opens in Compare, one chip per run in its headline', async ({ page }) => {
  const suite = uniqueId('views-suite');
  await createSuite(page.request, origin(), suite, [
    { id: 'one', label: 'Run 1', status: 'passed', replayId: uniqueId('views-one') },
    { id: 'two', label: 'Run 2', status: 'failed', replayId: uniqueId('views-two') },
  ]);
  await openReplay(page, `${origin()}/s/${suite}`);
  await expect(page.getByTestId('view-switcher')).toHaveText(/View: Compare/);
  await expect(page.getByTestId('compare-summary').getByRole('button')).toHaveCount(2);
});
