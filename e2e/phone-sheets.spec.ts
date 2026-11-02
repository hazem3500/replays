import { expect, test } from '@playwright/test';

import { boxOf, openReplay, serveApp } from './support.ts';

const server = serveApp({ REPLAYS_BETA_EDITOR: 'true' });
const origin = () => server().origin;

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });

test('on a touch phone More opens as a bottom sheet without keyboard shortcuts, and Cancel returns focus', async ({ page }) => {
  await openReplay(page, `${origin()}/r/demo-shop`);
  const trigger = page.locator('header').getByRole('button', { name: 'More actions' });
  await trigger.tap();
  const sheet = page.locator('[data-slot="dropdown-menu-content"][data-sheet]');
  await expect(sheet).toBeVisible();
  const box = await boxOf(sheet);
  expect(Math.round(box.y + box.height)).toBe(844);
  expect(Math.round(box.width)).toBe(390);
  await expect(sheet.getByRole('menuitem', { name: /Keyboard shortcuts/ })).toHaveCount(0);
  const heights = await sheet.getByRole('menuitem').evaluateAll((items) => items.map((item) => item.getBoundingClientRect().height));
  expect(Math.min(...heights)).toBeGreaterThanOrEqual(48);

  const theme = sheet.getByTestId('theme-menu-item');
  const before = await theme.textContent();
  await theme.tap();
  await expect(theme).not.toHaveText(before ?? '');
  await expect(sheet).toBeVisible();

  await sheet.getByTestId('menu-sheet-cancel').tap();
  await expect(sheet).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('a hardware key on a touch phone reveals the keyboard shortcuts for the session', async ({ page }) => {
  await openReplay(page, `${origin()}/r/demo-shop`);
  await page.keyboard.press('Shift');
  await page.locator('header').getByRole('button', { name: 'More actions' }).tap();
  await expect(page.getByRole('menuitem', { name: /Keyboard shortcuts/ })).toBeVisible();
  await page.reload();
  await page.locator('header').getByRole('button', { name: 'More actions' }).tap();
  await expect(page.getByRole('menuitem', { name: /Keyboard shortcuts/ })).toBeVisible();
});

test('the editor’s More on a phone is the same sheet, with the theme as a row', async ({ page }) => {
  await page.goto(`${origin()}/r/demo-shop/edit`);
  await page.locator('.editor-mobile-header').getByRole('button', { name: 'More actions' }).tap();
  const sheet = page.locator('[data-slot="dropdown-menu-content"][data-sheet]');
  await expect(sheet.getByTestId('editor-done')).toHaveCount(0);
  await expect(sheet.getByTestId('theme-menu-item')).toContainText('Theme');
  await expect(sheet.getByRole('menuitem', { name: /Keyboard shortcuts/ })).toHaveCount(0);
});
