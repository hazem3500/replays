import { expect, test, type Page } from '@playwright/test';

import { cloneBundle, openReplay, postBundle, serveApp, uniqueId } from './support.ts';

const server = serveApp({ REPLAYS_BETA_EDITOR: 'true' });

/** A copy of the demo replay whose saved edit list carries its own caption from 0:00.5 to 0:04.0. */
async function replayWithEditedCaption(page: Page) {
  const base = server().origin;
  const id = uniqueId('edited-caption');
  await postBundle(page.request, base, await cloneBundle(page.request, base, 'demo-shop', id));
  const saved = await page.request.put(`${base}/api/replays/${id}/edits`, {
    headers: { origin: base, 'if-match': '"e.none"' },
    data: { version: 1, cuts: [], captions: [{ id: 'note', from: 500, to: 4000, text: 'Edited caption' }] },
  });
  expect(saved.ok()).toBe(true);
  return id;
}

for (const [width, height, mobile] of [
  [1280, 800, false],
  [390, 844, true],
] as const) {
  test.describe(`${width} px`, () => {
    test.use({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, reducedMotion: 'reduce' });

    test('a replay with steps shows the step captions toggle, and it switches them', async ({ page }) => {
      await openReplay(page, `${server().origin}/r/demo-shop`);
      const toggle = page.getByTestId('captions-switch');
      await expect(toggle).toBeVisible();
      const pressed = await toggle.getAttribute('aria-pressed');
      await toggle.click();
      await expect(toggle).not.toHaveAttribute('aria-pressed', pressed ?? '');
      await expect(toggle).toHaveAccessibleName(pressed === 'true' ? 'Show step captions' : 'Hide step captions');
    });

    test('a replay with edited captions keeps the captions toggle, and it hides and shows them', async ({ page }) => {
      const id = await replayWithEditedCaption(page);
      await openReplay(page, `${server().origin}/r/${id}?t=2`);
      const toggle = page.getByTestId('captions-switch');
      const caption = page.getByTestId('edit-caption');
      await expect(toggle).toBeVisible();
      await expect(toggle).toHaveAccessibleName('Hide captions');
      await expect(caption).toContainText('Edited caption');
      await toggle.click();
      await expect(toggle).toHaveAccessibleName('Show captions');
      await expect(caption).toHaveCount(0);
      await toggle.click();
      await expect(caption).toContainText('Edited caption');
    });
  });
}
