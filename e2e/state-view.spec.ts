import { expect, test } from '@playwright/test';

import { boxOf, openReplay, origin } from './support.ts';

test.use({ viewport: { width: 1280, height: 800 } });

test('a missing replay says so plainly in the upper third, with one way back and the raw error folded away', async ({ page }) => {
  await page.goto(`${origin()}/r/no-such-replay-here`);
  const state = page.locator('.state-view[data-kind="not-found"]');
  const title = state.getByRole('heading', { level: 1, name: 'This replay isn’t here' });
  await expect(title).toBeVisible();
  expect((await boxOf(title)).y).toBeLessThan(800 / 3);
  await expect(state.getByRole('link', { name: 'Back to all replays' })).toBeVisible();
  await expect(state.getByRole('button', { name: 'Try again' })).toBeVisible();
  const details = state.getByRole('button', { name: 'Details' });
  await expect(details).toHaveAttribute('aria-expanded', 'false');
  await expect(state.locator('.state-view-details pre')).toBeHidden();
  await details.click();
  await expect(details).toHaveAttribute('aria-expanded', 'true');
  await expect(state.locator('.state-view-details pre')).toContainText('no-such-replay-here');
});

test('an imported recording without console says why it matters and how its source captures it', async ({ page }) => {
  await openReplay(page, `${origin()}/r/human-demo`);
  await page.getByTestId('console-tab').click();
  const state = page.getByTestId('console-not-captured');
  await expect(state.getByRole('heading', { name: 'This recording has no console output' })).toBeVisible();
  await expect(state.locator('.not-captured-snippet code').first()).toHaveText("capture: { console: ['log', 'warn', 'error'] }");
  await state.getByText('Using the command line?').click();
  await expect(state.locator('.not-captured-cli code')).toHaveText(/^replays capture /);
});
