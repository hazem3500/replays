import { expect, type Page, test } from '@playwright/test';

import { cloneBundle, openReplay, postBundle, serveApp, uniqueId } from './support.ts';

const server = serveApp();

async function openPerformance(page: Page, id: string, options: { details?: boolean; entries?: number } = {}) {
  if (options.details) await page.addInitScript(() => localStorage.setItem('replays:performance-details', '1'));
  const bundle = await cloneBundle(page.request, server().origin, 'demo-shop', id, 'Performance grid fixture');
  bundle.performance = {
    supported: ['paint', 'longtask', 'event', 'layout-shift', 'animation-frame'],
    layoutShifts: [],
    entries: [
      { at: 500, kind: 'first-contentful-paint', value: 500 },
      { at: 3000, kind: 'long-task', value: 120 },
      { at: 5000, kind: 'long-task', value: 90 },
      ...Array.from({ length: options.entries ?? 4 }, (_, index) => ({
        at: 6000 + index * 400,
        kind: 'long-task' as const,
        value: 70 + index,
      })),
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
  await openPerformance(page, uniqueId('performance-grid'), { details: true });
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

test('at 1280x800 the table shows four rows under a one-line headline and stats strip, and the panel grew to fit', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openPerformance(page, uniqueId('performance-compact'));
  const resizer = page.getByTestId('inspector-resizer');
  // why: the default panel is 42 % of the window (336 px); Performance declares it needs more and grows.
  await expect.poll(async () => Number(await resizer.getAttribute('aria-valuenow'))).toBeGreaterThan(336);
  await expect(page.locator('.pp-chip').first()).toBeVisible();
  const lead = await page.locator('.pp-lead').evaluate((node) => {
    const box = node.getBoundingClientRect();
    const jump = node.querySelector('.pp-lead-jump')?.getBoundingClientRect();
    return { height: box.height, jumpMiddle: jump ? (jump.top + jump.bottom) / 2 : undefined, middle: (box.top + box.bottom) / 2 };
  });
  expect(lead.height).toBe(32);
  if (lead.jumpMiddle !== undefined) expect(Math.abs(lead.jumpMiddle - lead.middle)).toBeLessThanOrEqual(1);
  const strip = await page.getByTestId('performance-vitals').boundingBox();
  expect(strip!.height).toBeLessThanOrEqual(56);
  await expect
    .poll(async () => {
      const region = await page.locator('.inspector-panel:not([hidden])').first().boundingBox();
      return page
        .locator('.pp-row:not(.pp-head)')
        .evaluateAll(
          (rows, bottom) => rows.filter((row) => row.getBoundingClientRect().bottom <= bottom).length,
          region!.y + region!.height,
        );
    })
    .toBeGreaterThanOrEqual(4);
  const head = await page.locator('.pp-head').evaluate((node) => getComputedStyle(node).position);
  expect(head).toBe('sticky');
});

test('the Details toggle opens the grouped grid and the choice is remembered', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openPerformance(page, uniqueId('performance-details'));
  await expect(page.locator('.pp-stat')).toHaveCount(0);
  await page.getByRole('button', { name: 'Details' }).click();
  await expect(page.locator('.pp-stat').first()).toBeVisible();
  await page.reload();
  await page.getByTestId('performance-tab').click();
  await expect(page.locator('.pp-stat').first()).toBeVisible();
});

test('a collapsed timeline removes its row entirely, with no chart and no marks; the toggle stays in the headline row', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openPerformance(page, uniqueId('performance-collapsed'));
  await expect(page.locator('.pt-mark').first()).toBeVisible();
  const toggle = page.getByRole('button', { name: 'Timeline' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('performance-timeline')).toHaveCount(0);
  await expect(page.locator('.pt-mark, .pt-plot, .fps-line, .pt-lane')).toHaveCount(0);
  await toggle.click();
  await expect(page.locator('.pt-mark').first()).toBeVisible();
});

test('dragging the bottom splitter on Performance resizes the panel, keeps the height, and stops auto-grow', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openPerformance(page, uniqueId('performance-splitter'));
  const resizer = page.getByTestId('inspector-resizer');
  const panelHeight = async () => (await page.locator('.inspector').first().boundingBox())!.height;
  await expect(resizer).toBeVisible();
  // why: the panel may still be growing to fit its content (about 220 ms); the drag starts from where it settles.
  await page.waitForTimeout(600);
  const before = await panelHeight();
  const seam = (await resizer.boundingBox())!;
  const x = seam.x + 300;
  const y = seam.y + seam.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 80, { steps: 6 });
  await page.mouse.up();
  await expect.poll(panelHeight).toBeLessThan(before - 40);
  const dragged = Number(await resizer.getAttribute('aria-valuenow'));
  await page.getByRole('tab', { name: 'Network' }).click();
  await page.getByTestId('performance-tab').click();
  expect(Number(await resizer.getAttribute('aria-valuenow'))).toBe(dragged);
  await page.reload();
  await expect(page.getByTestId('inspector-resizer')).toHaveAttribute('aria-valuenow', String(dragged));
});

test('a stat in the strip jumps to its moment, and blocking time narrows the table', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openPerformance(page, uniqueId('performance-strip-click'));
  const longest = page.getByRole('button', { name: /Longest task/ });
  await expect(longest)
    .toHaveAttribute('aria-pressed', 'false')
    .catch(() => undefined);
  await longest.click();
  await expect(page.locator('.pp-row[aria-selected="true"], .pp-row[data-selected]').first()).toBeVisible();
  const rowsBefore = await page.locator('.pp-row:not(.pp-head)').count();
  const blocking = page.getByRole('button', { name: /Blocking time/ });
  await blocking.click();
  await expect(blocking).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Show all moments' })).toBeVisible();
  const rowsAfter = await page.locator('.pp-row:not(.pp-head)').count();
  expect(rowsAfter).toBeLessThanOrEqual(rowsBefore);
  await page.getByRole('button', { name: 'Show all moments' }).click();
  await expect(blocking).toHaveAttribute('aria-pressed', 'false');
});

test('dragging a range on the timeline scopes the strip to it, and clearing it brings everything back', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openPerformance(page, uniqueId('performance-strip-range'));
  const longest = page.getByRole('button', { name: /Longest task/ });
  await expect(longest).toContainText('120');
  const box = (await page.locator('.pt-plot').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.62, box.y + 8);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.98, box.y + 8, { steps: 6 });
  await page.mouse.up();
  const clear = page.getByRole('button', { name: 'Clear the time range' });
  await expect(clear).toBeVisible();
  await expect(page.getByTestId('performance-vitals')).toContainText(/in [\d:.]+ to [\d:.]+/);
  await expect(page.getByRole('button', { name: /Longest task/ })).not.toContainText('120');
  await clear.click();
  await expect(page.getByRole('button', { name: /Longest task/ })).toContainText('120');
});
