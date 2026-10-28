import { expect, type Page, test } from '@playwright/test';

import { openReplay, serveApp } from './support.ts';

const server = serveApp({ REPLAYS_BETA_EDITOR: 'true' });
const replay = () => `${server().origin}/r/demo-shop`;

test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });

async function openNumbers(page: Page) {
  await page.getByRole('button', { name: /^Playback: / }).click();
  return page.getByRole('switch', { name: 'Show step numbers' });
}

async function enableCaptions(page: Page) {
  await page.addInitScript(() => localStorage.setItem('replays-captions', '1'));
}

test('captions default to unnumbered; numbering toggles, persists, and survives visibility shortcuts', async ({ page }) => {
  await enableCaptions(page);
  await openReplay(page, `${replay()}#step-2`);
  await page.getByTestId('step-timeline').locator('[data-step-index="1"]').click();
  const caption = page.getByTestId('step-caption');
  await expect(caption).toBeVisible();
  await expect(caption).toHaveAttribute('aria-hidden', 'true');
  await expect(caption.locator('.step-caption-text')).toHaveCSS('animation-duration', '0s');
  await expect(caption.locator('.step-caption-number')).toHaveCount(0);
  const label = await caption.locator('.step-caption-label').textContent();
  const numbers = await openNumbers(page);
  await expect(numbers).toHaveAttribute('aria-checked', 'false');
  await numbers.click();
  await expect(numbers).toHaveAttribute('aria-checked', 'true');
  await expect(caption.locator('.step-caption-number')).toHaveText('2');
  await expect(caption.locator('.step-caption-label')).toHaveText(label!);
  await page.keyboard.press('Escape');
  // Base UI restores focus after its closing transition. A body press cannot
  // focus the non-focusable body while the outgoing popup still owns focus.
  await expect(page.getByRole('dialog', { name: 'Playback', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Playback: / })).toBeFocused();

  await page.keyboard.press('Shift+C');
  await expect(page.getByTestId('captions-switch')).toHaveAttribute('aria-label', 'Show step captions');
  await expect(caption).toHaveCount(0);
  await page.keyboard.press('Shift+C');
  await expect(page.getByTestId('captions-switch')).toHaveAttribute('aria-label', 'Hide step captions');
  // Re-enabling mounts the overlay; seeking shows it again while paused, as before.
  await page.getByTestId('step-timeline').locator('[data-step-index="1"]').click();
  await expect(caption.locator('.step-caption-number')).toHaveText('2');
  await page.reload();
  await page.getByTestId('step-timeline').locator('[data-step-index="1"]').click();
  await expect(caption.locator('.step-caption-number')).toHaveText('2');
  await (await openNumbers(page)).click();
  await expect(caption.locator('.step-caption-number')).toHaveCount(0);
  await expect(numbers).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Escape');
  await page.reload();
  await page.getByTestId('step-timeline').locator('[data-step-index="1"]').click();
  await expect(caption).toBeVisible();
  await expect(caption.locator('.step-caption-number')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('replays-caption-numbers'))).toBe('0');
});

test('numbering follows the edited rail after cuts, including repeated labels', async ({ page }) => {
  await enableCaptions(page);
  await page.addInitScript(() => localStorage.setItem('replays-caption-numbers', '1'));
  await page.route('**/api/replays/demo-shop', async (route) => {
    const response = await route.fetch();
    const bundle = await response.json();
    bundle.steps = [
      { at: 0, kind: 'open', label: 'Removed opening' },
      { at: 1000, kind: 'click', label: 'Review the cart' },
      { at: 2000, kind: 'click', label: 'Review the cart' },
      { at: 3000, kind: 'click', label: 'Place order' },
    ];
    await route.fulfill({ response, json: bundle });
  });
  await page.route('**/api/replays/demo-shop/edits', (route) =>
    route.fulfill({ json: { version: 1, revision: 1, cuts: [{ id: 'opening', from: 0, to: 1000 }] } }),
  );
  await openReplay(page, replay());
  await expect(page.getByTestId('edited-chip')).toContainText('Edited');
  for (const index of [0, 1, 2]) {
    await page.getByTestId('step-timeline').locator(`[data-step-index="${index}"]`).click();
    const caption = page.getByTestId('step-caption');
    await expect(caption.locator('.step-caption-number')).toHaveText(String(index + 1));
    await expect(caption.locator('.step-caption-label')).toHaveText(index < 2 ? 'Review the cart' : 'Place order');
    await expect(page.getByTestId('step-count').locator('.visually-hidden')).toHaveText(`Step ${index + 1} of 3`);
  }
});

test('saved editor captions stay unnumbered even with the viewer preference on', async ({ page }) => {
  await enableCaptions(page);
  await page.addInitScript(() => localStorage.setItem('replays-caption-numbers', '1'));
  await page.route('**/api/replays/demo-shop/edits', (route) =>
    route.fulfill({
      json: {
        version: 1,
        revision: 1,
        cuts: [],
        captions: [{ id: 'written', from: 0, to: 5000, text: 'My own caption' }],
      },
    }),
  );
  await openReplay(page, `${replay()}?t=0.5`);
  const caption = page.getByTestId('edit-caption');
  await expect(caption).toHaveText('My own caption');
  await expect(caption.locator('.step-caption-number')).toHaveCount(0);
  await expect(page.getByTestId('captions-switch')).toHaveCount(0);
  await page.getByRole('button', { name: /^Playback: / }).click();
  await expect(page.getByRole('switch', { name: 'Show step numbers' })).toHaveCount(0);
});

test('blocked preference storage still allows toggling numbers for this visit', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new DOMException('Storage blocked', 'SecurityError');
    };
    Storage.prototype.setItem = () => {
      throw new DOMException('Storage blocked', 'SecurityError');
    };
  });
  await openReplay(page, `${replay()}#step-2`);
  await page.getByTestId('captions-switch').click();
  await (await openNumbers(page)).click();
  await page.keyboard.press('Escape');
  await page.getByTestId('step-timeline').locator('[data-step-index="1"]').click();
  await expect(page.getByTestId('step-caption').locator('.step-caption-number')).toHaveText('2');
});
