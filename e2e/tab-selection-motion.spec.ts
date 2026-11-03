import { expect, test, type Page } from '@playwright/test';

import { openReplay, origin } from './support.ts';

test.use({ viewport: { width: 1280, height: 800 } });

/** The selected-tab surface's left edge and every tab's, relative to the tab row, on each of the next `count` frames. */
async function trace(page: Page, count: number, act: () => Promise<void>) {
  const frames = page.evaluate(
    (total) =>
      new Promise<Array<{ surface: number; tabs: Record<string, number> }>>((done) => {
        const out: Array<{ surface: number; tabs: Record<string, number> }> = [];
        const tick = () => {
          const row = document.querySelector('.inspector-tabs');
          const surface = row?.querySelector('[data-slot="tabs-indicator"]');
          const left = row?.getBoundingClientRect().x ?? 0;
          const tabs: Record<string, number> = {};
          for (const tab of row?.querySelectorAll('.inspector-tab') ?? [])
            tabs[tab.textContent?.replace(/\d|\s/g, '') ?? ''] = Math.round(tab.getBoundingClientRect().x - left);
          out.push({ surface: Math.round((surface?.getBoundingClientRect().x ?? 0) - left), tabs });
          if (out.length >= total) done(out);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    count,
  );
  await page.waitForTimeout(32);
  await act();
  return frames;
}

async function open(page: Page) {
  await openReplay(page, `${origin()}/r/demo-shop`);
  await page.getByRole('tab', { name: /^Console/ }).click();
  await page.mouse.move(640, 300);
  await page.waitForTimeout(400);
}

test('choosing the tab under the pointer glides the selected surface over from the old tab', async ({ page }) => {
  await open(page);
  const network = page.getByRole('tab', { name: /^Network/ });
  await network.hover();
  const frames = await trace(page, 20, () => network.click());
  const from = frames[0]?.tabs.Console ?? 0;
  const to = frames[0]?.tabs.Network ?? 0;
  const surfaces = frames.map((frame) => frame.surface);
  for (let index = 1; index < surfaces.length; index++) expect(surfaces[index] ?? 0).toBeGreaterThanOrEqual(surfaces[index - 1] ?? 0);
  expect(surfaces.some((x) => x > from && x < to)).toBe(true);
  expect(surfaces.at(-1)).toBe(to);
});

test('hover is a much lighter surface than the selection and leaves a tab as it becomes selected', async ({ page }) => {
  await open(page);
  const network = page.getByRole('tab', { name: /^Network/ });
  const hover = page.locator('.inspector-tabs > .hover-glide');
  await network.hover();
  await expect(hover).toHaveAttribute('data-visible', 'true');
  const fills = await page.evaluate(() => {
    const glide = document.querySelector('.inspector-tabs > .hover-glide');
    const selected = document.querySelector('.inspector-tabs [data-slot="tabs-indicator"]');
    return [glide ? getComputedStyle(glide, '::before').backgroundColor : '', selected ? getComputedStyle(selected).backgroundColor : ''];
  });
  expect(fills[0]).not.toBe(fills[1]);
  await network.click();
  await expect(hover).toHaveAttribute('data-visible', 'false');
});

test('switching tabs from the keyboard glides the selected surface from the old tab to the new one', async ({ page }) => {
  await open(page);
  const frames = await trace(page, 20, () => page.keyboard.press('n'));
  const from = frames[0]?.tabs.Console ?? 0;
  const to = frames[0]?.tabs.Network ?? 0;
  const surfaces = frames.map((frame) => frame.surface);
  for (let index = 1; index < surfaces.length; index++) expect(surfaces[index] ?? 0).toBeGreaterThanOrEqual(surfaces[index - 1] ?? 0);
  expect(surfaces.some((x) => x > from && x < to)).toBe(true);
  expect(surfaces.at(-1)).toBe(to);
});
