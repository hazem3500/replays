import { expect, test } from '@playwright/test';

import { createSuite, serveApp, uniqueId } from './support.ts';

const server = serveApp({ REPLAYS_BETA_EDITOR: 'true' });

test('phone topbar items never overlap at 320 to 430 px, even with status, edited text and source', async ({ page }) => {
  const suite = uniqueId('suite');
  const one = `${suite}-one`;
  await createSuite(page.request, server().origin, suite, [
    { id: 'attempt-1', label: 'Desktop: login with a long descriptive run label', status: 'passed', replayId: one },
    { id: 'attempt-2', label: 'Desktop: run 2', status: 'failed' },
  ]);
  const saved = await page.request.put(`${server().origin}/api/replays/${one}/edits`, {
    headers: { origin: server().origin, 'if-match': '"e.none"' },
    data: { version: 1, cuts: [], captions: [{ id: 'note', from: 500, to: 4000, text: 'Edited caption' }] },
  });
  expect(saved.ok()).toBe(true);
  for (const width of [320, 360, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`${server().origin}/s/${suite}/r/${one}`);
    await expect(page.getByTestId('edited-chip')).toBeAttached();
    const items = [
      'header.app-topbar .topbar-back',
      '[data-testid="title-menu"]',
      '[data-testid="run-status"]',
      '[data-testid="edited-chip"]',
      '[data-testid="source-chip"]',
      '[data-testid="edit-replay"]',
      'header.app-topbar .topbar-actions > :last-child',
    ];
    const boxes: Array<{ item: string; x: number; right: number }> = [];
    for (const item of items) {
      const box = await page.locator(item).first().boundingBox();
      if (box) boxes.push({ item, x: box.x, right: box.x + box.width });
    }
    boxes.sort((a, b) => a.x - b.x);
    // why: left-to-right neighbours must not intersect; a 0.5 px tolerance absorbs subpixel rounding.
    for (const [index, box] of boxes.slice(1).entries()) {
      expect(box.x, `${width}px: ${box.item} overlaps ${boxes[index]!.item}`).toBeGreaterThanOrEqual(boxes[index]!.right - 0.5);
    }
    expect(boxes.at(-1)!.right, `${width}px: bar overflows`).toBeLessThanOrEqual(width + 0.5);
  }
});
