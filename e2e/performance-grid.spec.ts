import { expect, type Page, test } from '@playwright/test';

import { cloneBundle, openReplay, postBundle, serveApp, uniqueId } from './support.ts';

const server = serveApp();

async function openPerformance(page: Page, id: string) {
  const bundle = await cloneBundle(page.request, server().origin, 'demo-shop', id, 'Performance grid fixture');
  bundle.performance = {
    supported: ['paint', 'longtask', 'event', 'layout-shift', 'animation-frame'],
    layoutShifts: [],
    entries: [
      { at: 500, kind: 'first-contentful-paint', value: 500 },
      { at: 3000, kind: 'long-task', value: 120 },
      { at: 5000, kind: 'long-task', value: 90 },
    ],
    frames: Array.from({ length: 9 }, (_, index) => ({ at: index * 1000, frames: 100 + index, elapsed: 1000, dropped: 1 })),
  };
  await postBundle(page.request, server().origin, bundle);
  await openReplay(page, `${server().origin}/r/${id}`);
  await page.getByTestId('performance-tab').click();
  await expect(page.getByTestId('performance-timeline')).toBeVisible();
}

test('the timeline plot, stat cells and notes start at one x, and lane labels sit inside their lanes', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openPerformance(page, uniqueId('performance-grid'));
  const left = (selector: string) => page.locator(selector).evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().left));
  const [plot] = await left('.pt-plot');
  const cells = await left('.pp-stat');
  const notes = await left('.pp-group-note');
  expect(cells.length).toBeGreaterThan(4);
  for (const x of [Math.min(...cells), ...notes]) expect(Math.abs(x - plot!)).toBeLessThanOrEqual(1);

  const widths = await page.locator('.pp-stat').evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().width)));
  expect(new Set(widths).size).toBe(1);

  const gutterLefts = await page
    .locator('.pp-lead-dot, .pp-group-name, .pt-label svg')
    .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().left));
  expect(Math.max(...gutterLefts) - Math.min(...gutterLefts)).toBeLessThanOrEqual(1);

  const pairs = await page.locator('.pt-lane').evaluateAll((lanes) =>
    lanes.map((lane) => {
      const label = document.querySelector(`.pt-label[data-lane="${(lane as HTMLElement).dataset.lane}"]`)!.getBoundingClientRect();
      const box = lane.getBoundingClientRect();
      return { lane: [box.top, box.bottom], middle: (label.top + label.bottom) / 2 };
    }),
  );
  for (const { lane, middle } of pairs) {
    expect(middle).toBeGreaterThanOrEqual(lane[0]!);
    expect(middle).toBeLessThanOrEqual(lane[1]!);
  }

  const band = await page.locator('.pt-fps').evaluate((node) => {
    const box = node.getBoundingClientRect();
    return [box.top, box.bottom];
  });
  const fpsLabel = await page.locator('.pt-label[data-lane="fps"]').evaluate((node) => {
    const box = node.getBoundingClientRect();
    return (box.top + box.bottom) / 2;
  });
  expect(Math.abs(fpsLabel - (band[0]! + band[1]!) / 2)).toBeLessThanOrEqual(2);
  const guides = await page.locator('.pt-fps-axis').evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().top));
  expect(guides[1]! - guides[0]!).toBeGreaterThanOrEqual(12);
});
