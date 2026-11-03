import { expect, test } from '@playwright/test';

import { gotoHydrated, origin } from './support.ts';

test('a closing modal stays mounted for its Motion exit and returns focus after the animations finish', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await gotoHydrated(page, origin());
  const trigger = page.getByRole('button', { name: 'Settings', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  await dialog.evaluate(async (node) => {
    await Promise.all(node.getAnimations().map((animation) => animation.finished));
  });
  const exiting = await dialog.evaluate(async (node) => {
    node.querySelector<HTMLButtonElement>('[aria-label="Close settings"]')?.click();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const animations = node.getAnimations();
    for (const animation of animations) animation.pause();
    return { connected: node.isConnected, ending: node.hasAttribute('data-ending-style'), animations: animations.length };
  });
  expect(exiting.connected).toBe(true);
  expect(exiting.ending).toBe(true);
  expect(exiting.animations).toBeGreaterThan(0);
  await page.locator('.settings-dialog').evaluate((node) => {
    for (const animation of node.getAnimations()) animation.finish();
  });
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('reduced motion opens and switches settings without creating surface animations', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoHydrated(page, origin());
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('tab', { name: 'Keyboard', exact: true }).click();
  const surface = await dialog.evaluate((node) => ({
    animations: node.getAnimations().length,
    opacity: getComputedStyle(node).opacity,
    paneOpacity: getComputedStyle(node.querySelector('.settings-pane-body') ?? node).opacity,
  }));
  expect(surface).toEqual({ animations: 0, opacity: '1', paneOpacity: '1' });
});
