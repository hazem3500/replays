import { expect, test } from '@playwright/test';

import { createSuite, openReplay, serveApp, uniqueId } from './support.ts';

const server = serveApp();

test('switching runs while a replay plays never leaves the player stuck', async ({ page }) => {
  const suite = uniqueId('suite');
  const runs = Array.from({ length: 6 }, (_, index) => ({
    id: `attempt-${index + 1}`,
    label: `Run ${index + 1}`,
    status: 'passed' as const,
    replayId: `${suite}-${index + 1}`,
  }));
  await createSuite(page.request, server().origin, suite, runs);
  await openReplay(page, `${server().origin}/s/${suite}/r/${runs[0]?.replayId}`);
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  for (let round = 0; round < 12; round++) {
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible({ timeout: 8000 });
    await page.waitForTimeout(150 + ((round * 97) % 400));
    await page.keyboard.press(round % 4 === 3 ? 'Shift+J' : 'j');
    if (round % 3 === 0) await page.keyboard.press('j');
    await page.waitForTimeout(round % 2 === 0 ? 0 : 700);
  }
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible({ timeout: 8000 });
  const first = await page.getByTestId('playhead').textContent();
  await expect.poll(() => page.getByTestId('playhead').textContent()).not.toBe(first);
});
