import { expect, type Page, test } from '@playwright/test';

import { gotoHydrated, origin } from './support.ts';

test.use({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark' });

/** Clicks the top bar's theme switch and reads the document in the same task. */
function flipNow(page: Page) {
  return page.evaluate(() => {
    const button = document.querySelector<HTMLButtonElement>('button[aria-label^="Switch to "]');
    button?.click();
    return {
      theme: document.documentElement.dataset.theme,
      chrome: document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content,
      held: document.querySelector('style[data-theme-switch]') !== null,
      switching: document.documentElement.dataset.themeSwitching,
    };
  });
}

test('under reduced motion the theme, its chrome colour and held transitions change in the same frame', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoHydrated(page, `${origin()}/`);
  const flipped = await flipNow(page);
  expect(flipped).toEqual({ theme: 'light', chrome: '#eff1f5', held: true, switching: undefined });
  await expect(page.locator('style[data-theme-switch]')).toHaveCount(0);
});

test('with motion the new theme crossfades, then the page settles with transitions back', async ({ page }) => {
  await gotoHydrated(page, `${origin()}/`);
  const flipped = await flipNow(page);
  expect(flipped.switching).toBe('fade');
  expect(flipped.held).toBe(true);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#eff1f5');
  await expect(page.locator('html')).not.toHaveAttribute('data-theme-switching', /./);
  await expect(page.locator('style[data-theme-switch]')).toHaveCount(0);
});

test('a rapid second toggle wins even before the first transition has committed', async ({ page }) => {
  await gotoHydrated(page, `${origin()}/`);
  const settled = await page.evaluate(() => {
    const button = document.querySelector<HTMLButtonElement>('button[aria-label^="Switch to "]');
    if (!button) throw new Error('Theme switch is missing');
    button.click();
    button.click();
    return {
      theme: document.documentElement.dataset.theme,
      chrome: document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content,
      switching: document.documentElement.dataset.themeSwitching,
    };
  });
  expect(settled).toEqual({ theme: 'dark', chrome: '#0c0e12', switching: undefined });
  await expect(page.locator('style[data-theme-switch]')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#0c0e12');
  await expect(page.getByRole('button', { name: 'Switch to light theme' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('replays-theme'))).toBe('dark');
});
