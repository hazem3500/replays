import { expect, type Page, test } from '@playwright/test';

import { cloneBundle, postBundle, serveApp, uniqueId } from './support.ts';

const server = serveApp();

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2.625 });

/** How far the stuck day heading's top sits from the header block's bottom edge (its tab bar and border). */
function gap(page: Page) {
  return page.evaluate(() => {
    const head = document.querySelector('.index-head')?.getBoundingClientRect();
    const day = document.querySelector('.feed-day')?.getBoundingClientRect();
    return head && day ? day.top - head.bottom : Number.NaN;
  });
}

/** Scrolls 300 px into the first day's rows, so its heading is stuck, and reports how far the page got. */
function scrollIntoFirstDay(page: Page) {
  return page.evaluate(() => {
    window.scrollTo(0, 300);
    return scrollY;
  });
}

function headPadding(page: Page) {
  return page.evaluate(() => getComputedStyle(document.querySelector('.index-head') ?? document.body).paddingTop);
}

test('on a phone the stuck day heading starts exactly at the tab bar’s bottom, also after the top inset changes', async ({ page }) => {
  for (const index of Array.from({ length: 16 }, (_, slot) => slot)) {
    const id = uniqueId('sticky');
    await postBundle(page.request, server().origin, await cloneBundle(page.request, server().origin, 'demo-shop', id, `Sticky ${index}`));
  }
  await page.goto(`${server().origin}/`);
  await expect(page.locator('.feed-day').first()).toBeVisible();
  await expect.poll(() => scrollIntoFirstDay(page)).toBe(300);
  await expect.poll(() => gap(page)).toBe(0);

  // why: a phone browser's top inset moves with its toolbars after load; the header's padding follows it.
  const cdp = await page.context().newCDPSession(page);
  for (const top of [7, 3, 0]) {
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top, bottom: 24 } });
    await expect.poll(() => headPadding(page)).toBe(`${top}px`);
    await expect.poll(() => gap(page)).toBe(0);
  }
});

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 600 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1.25 });

  test('in the grid the stuck day heading starts exactly at the header’s bottom', async ({ page }) => {
    for (const index of Array.from({ length: 12 }, (_, slot) => slot)) {
      const id = uniqueId('sticky-grid');
      await postBundle(page.request, server().origin, await cloneBundle(page.request, server().origin, 'demo-shop', id, `Grid ${index}`));
    }
    await page.goto(`${server().origin}/`);
    await page.getByRole('button', { name: 'Grid', exact: true }).click();
    await expect(page.locator('.feed-list[data-view="grid"]')).toBeVisible();
    await expect.poll(() => scrollIntoFirstDay(page)).toBe(300);
    await expect.poll(() => gap(page)).toBe(0);
  });
});
