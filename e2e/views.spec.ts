import { expect, type Page, test } from '@playwright/test';

import { createSuite, openReplay, origin, uniqueId } from './support.ts';

const shell = (page: Page) => page.locator('main.app-shell:not([aria-busy="true"])');

async function pickView(page: Page, label: string) {
  await page.getByRole('button', { name: 'More actions', exact: true }).click();
  await page.getByTestId('view-submenu-trigger').click();
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

test('Standard leads with Console while Performance keeps its own tab order', async ({ page }) => {
  await openReplay(page, `${origin()}/r/demo-shop?view=performance`);
  const diagnostics = page.getByRole('tablist', { name: 'Replay diagnostics' });
  const order = () =>
    diagnostics
      .getByRole('tab')
      .evaluateAll((tabs) => tabs.map((tab) => tab.id).filter((id) => ['console-tab', 'network-tab', 'performance-tab'].includes(id)));
  await expect.poll(order).toEqual(['performance-tab', 'network-tab', 'console-tab']);
  await pickView(page, 'Standard');
  await expect(shell(page)).toHaveAttribute('data-view', 'standard');
  await expect.poll(order).toEqual(['console-tab', 'network-tab', 'performance-tab']);
});

test('comparison keeps its context instead of offering unrelated view presets', async ({ page }) => {
  await openReplay(page, `${origin()}/r/demo-shop?with=human-demo&layout=grid&view=review`);
  await expect(page.getByTestId('compare-stage')).toBeVisible();
  await expect(shell(page)).toHaveAttribute('data-view', 'compare');
  await page.keyboard.press('v');
  await expect(shell(page)).toHaveAttribute('data-view', 'compare');
  await page.keyboard.press('Shift+V');
  await expect(shell(page)).toHaveAttribute('data-view', 'compare');
  await page.getByRole('button', { name: 'More actions', exact: true }).click();
  await expect(page.getByTestId('view-submenu-trigger')).toHaveCount(0);
  await expect(page.getByTestId('view-reset')).toHaveText('Reset view');
});

test('the viewer keeps recording details and appearance in More', async ({ page }) => {
  await page.route('**/api/replays/demo-shop/render*', (route) => route.fulfill({ json: { status: 'none' } }));
  await openReplay(page, `${origin()}/r/demo-shop`);
  const header = page.locator('.app-topbar');
  await expect(header.getByTestId('copy-link')).toBeVisible();
  await expect(header.getByRole('button', { name: 'Replay details', exact: true })).toHaveCount(0);
  await expect(header.getByTestId('download-video')).toBeVisible();
  await header.getByRole('button', { name: 'More actions', exact: true }).click();
  await expect(page.getByTestId('theme-menu-item')).toBeVisible();
  await expect(page.getByRole('menuitem').first()).toHaveAttribute('data-testid', 'replay-details');
  await expect(page.getByRole('menuitem', { name: /^Compare with/ })).toHaveCount(0);
  const items = page.getByRole('menuitem');
  await expect(items.last()).toHaveAttribute('data-testid', 'delete-replay');
  await expect(items.nth((await items.count()) - 2)).toHaveAttribute('data-testid', 'view-reset');
  await expect(page.getByTestId('keep-replay')).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Replay details', exact: true }).click();
  await expect(page.getByTestId('replay-info')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(header.getByRole('button', { name: 'More actions', exact: true })).toBeFocused();
});

for (const width of [1280, 390]) {
  test(`More keeps presets secondary and reset separate at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await openReplay(page, `${origin()}/r/demo-shop`);
    await page.getByRole('button', { name: 'More actions', exact: true }).click();
    const trigger = page.getByTestId('view-submenu-trigger');
    await expect(trigger).toHaveAccessibleName('View: Standard');
    await expect(page.getByRole('menuitemradio')).toHaveCount(0);
    await expect(page.getByTestId('view-reset')).toHaveText('Reset view');
    await trigger.click();
    const submenu = page.getByTestId('view-submenu');
    await expect(submenu.getByRole('menuitemradio', { name: 'Standard', exact: true })).toHaveAttribute('aria-checked', 'true');
    await expect(submenu.getByTestId('view-reset')).toHaveCount(0);
    if (width === 390) {
      await submenu.getByRole('menuitem', { name: 'Back to actions' }).click();
      await expect(submenu).toBeHidden();
      await expect(trigger).toBeVisible();
      await trigger.click();
    }
    await submenu.getByRole('menuitemradio', { name: 'Review', exact: true }).click();
    await expect(shell(page)).toHaveAttribute('data-view', 'review');
    await expect(page.getByRole('menu')).toHaveCount(0);
  });
}

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

test('a suite never shows the comparison strip: its sidebar or title menu switches runs', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const suite = uniqueId('views-suite');
  await createSuite(page.request, origin(), suite, [
    { id: 'one', label: 'Run 1', status: 'passed', replayId: uniqueId('views-one') },
    { id: 'two', label: 'Run 2', status: 'failed', replayId: uniqueId('views-two') },
  ]);
  await openReplay(page, `${origin()}/s/${suite}`);
  await expect(shell(page)).toHaveAttribute('data-view', 'compare');
  await page.getByRole('button', { name: 'Collapse runs sidebar' }).click();
  await expect(page.locator('.suite-workspace')).toHaveAttribute('data-rail', 'true');
  await expect(page.getByTestId('compare-summary')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('compare-summary')).toHaveCount(0);
  await expect(page.getByTestId('title-menu')).toBeVisible();
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
