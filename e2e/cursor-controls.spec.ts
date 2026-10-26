import { expect, test } from '@playwright/test';
import { serveApp } from './support.ts';

const server = serveApp({ REPLAYS_BETA_EDITOR: 'true' });
test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });

for (const width of [1280, 390]) {
  test(`cursor controls: keyboard, undo, autosave and viewer at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    const base = server().origin;
    const id = `cursor-${width}-${Date.now().toString(36)}`;
    const bundle = await (await page.request.get(`${base}/api/replays/human-demo`)).json();
    bundle.meta.id = id;
    expect((await page.request.post(`${base}/api/replays`, { data: bundle })).status()).toBe(201);
    const blur = { id: 'private', from: 0, to: 3000, x: 0.2, y: 0.2, width: 0.2, height: 0.2 };
    expect(
      (
        await page.request.put(`${base}/api/replays/${id}/edits`, {
          headers: { origin: base, 'if-match': '"e.none"' },
          data: { version: 1, cuts: [], blurs: [blur] },
        })
      ).ok(),
    ).toBe(true);
    await page.goto(`${base}/r/${id}/edit`);
    await expect(page.getByTestId('timeline')).toHaveAttribute('data-ready', 'true');
    const trigger = page.getByRole('button', { name: 'Cursor', exact: true });
    await trigger.focus();
    await page.keyboard.press('Space');
    const inspector = page.getByRole('dialog', { name: 'Cursor', exact: true });
    await expect(inspector).toBeVisible();
    await expect(inspector.getByRole('heading')).toBeFocused();
    const bounds = (await inspector.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    await page.keyboard.press('Tab');
    await expect(inspector.getByRole('button', { name: 'Close cursor options' })).toBeFocused();
    const visible = inspector.getByRole('switch', { name: 'Show cursor', exact: true });
    await visible.focus();
    await page.keyboard.press('Space');
    await expect(visible).toHaveAttribute('aria-checked', 'false');
    await expect(inspector.getByRole('slider', { name: 'Size' })).toBeDisabled();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(visible).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(visible).toHaveAttribute('aria-checked', 'false');
    await page.keyboard.press('Space');
    const size = inspector.getByRole('slider', { name: 'Size' });
    await size.focus();
    await page.keyboard.press('ArrowRight');
    await expect(inspector.locator('output')).toHaveText('105%');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(inspector.locator('output')).toHaveText('100%');
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(inspector.locator('output')).toHaveText('105%');
    await inspector.getByRole('switch', { name: 'Hide when idle' }).click();
    await inspector.getByRole('switch', { name: 'Click feedback' }).click();
    await page.keyboard.press('Escape');
    await expect(inspector).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(page.getByTestId('save-state')).toHaveText('Saved');
    const stored = await (await page.request.get(`${base}/api/replays/${id}/edits`)).json();
    expect(stored.cursor).toEqual({ size: 1.05, hideWhenIdle: false, clickFeedback: false });
    expect(stored.blurs).toEqual([blur]);
    await page.reload();
    await trigger.click();
    await expect(inspector.locator('output')).toHaveText('105%');
    await expect(inspector.getByRole('switch', { name: 'Hide when idle' })).toHaveAttribute('aria-checked', 'false');
    await inspector.getByRole('button', { name: 'Close cursor options' }).click();
    await page.getByTestId('editor-done').click();
    await expect(page.getByTestId('edited-chip')).toHaveText('Edited');
    await page.goto(`${base}/r/${id}?t=2`);
    const cursor = page.locator('.player-host .replay-cursor');
    await expect(cursor).toBeVisible();
    await expect(page.locator('.player-host .replay-blur')).toBeVisible();
    await page.getByTestId('edit-replay').click();
    await trigger.click();
    await inspector.getByRole('button', { name: 'Reset', exact: true }).click();
    await expect(inspector.locator('output')).toHaveText('100%');
    await expect(page.getByTestId('save-state')).toHaveText('Saved');
    const reset = await (await page.request.get(`${base}/api/replays/${id}/edits`)).json();
    expect(reset.cursor).toBeUndefined();
    expect(reset.blurs).toEqual([blur]);
  });
}
