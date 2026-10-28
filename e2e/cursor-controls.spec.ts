import { expect, test, type Page } from '@playwright/test';
import { cloneBundle, postBundle, serveApp } from './support.ts';

const server = serveApp({ REPLAYS_BETA_EDITOR: 'true' });
test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });

async function seedReplayWithBlur(page: Page, base: string, id: string, blur: Record<string, unknown>) {
  await postBundle(page.request, base, await cloneBundle(page.request, base, 'human-demo', id));
  const saved = await page.request.put(`${base}/api/replays/${id}/edits`, {
    headers: { origin: base, 'if-match': '"e.none"' },
    data: { version: 1, cuts: [], blurs: [blur] },
  });
  expect(saved.ok()).toBe(true);
}

/** On a phone the cursor options open from More into a panel; on desktop they sit in the standing presentation panel. */
function cursorLocators(page: Page, mobile: boolean) {
  const trigger = page.locator('.editor-mobile-more > summary');
  const inspector = mobile
    ? page.getByRole('region', { name: 'Cursor properties', exact: true })
    : page.getByRole('complementary', { name: 'Replay presentation' }).getByRole('group', { name: 'Cursor', exact: true });
  const openCursor = async () => {
    if (!mobile) return;
    await trigger.click();
    await page.getByRole('button', { name: 'Cursor options', exact: true }).click();
  };
  return { trigger, inspector, openCursor };
}

for (const width of [1280, 390]) {
  test(`cursor controls: keyboard, undo, autosave and viewer at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    const base = server().origin;
    const id = `cursor-${width}-${Date.now().toString(36)}`;
    const blur = { id: 'private', from: 0, to: 3000, x: 0.2, y: 0.2, width: 0.2, height: 0.2 };
    await seedReplayWithBlur(page, base, id, blur);
    await page.goto(`${base}/r/${id}/edit`);
    await expect(page.getByTestId('timeline')).toHaveAttribute('data-ready', 'true');
    const mobile = width < 720;
    const { trigger, inspector, openCursor } = cursorLocators(page, mobile);
    await openCursor();
    await expect(inspector).toBeVisible();
    if (mobile) await expect(inspector.getByRole('heading')).toBeFocused();
    else {
      await expect(page.locator('.topbar').getByRole('button', { name: 'Cursor', exact: true })).toHaveCount(0);
      await expect(page.getByRole('dialog', { name: 'Cursor', exact: true })).toHaveCount(0);
    }
    const bounds = (await inspector.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    if (mobile) {
      await page.keyboard.press('Tab');
      await expect(inspector.getByTestId('mobile-object-done')).toBeFocused();
    }
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
    if (mobile) {
      await expect(inspector).toHaveCount(0);
      await expect(trigger).toBeFocused();
    } else await expect(inspector).toBeVisible();
    await expect(page.getByTestId('save-state')).toHaveText('Saved');
    const stored = await (await page.request.get(`${base}/api/replays/${id}/edits`)).json();
    expect(stored.cursor).toEqual({ size: 1.05, hideWhenIdle: false, clickFeedback: false });
    expect(stored.blurs).toEqual([blur]);
    await page.reload();
    await openCursor();
    await expect(inspector.locator('output')).toHaveText('105%');
    await expect(inspector.getByRole('switch', { name: 'Hide when idle' })).toHaveAttribute('aria-checked', 'false');
    if (mobile) {
      await inspector.getByTestId('mobile-object-done').click();
      await trigger.click();
    }
    await page.getByTestId('editor-done').click();
    await expect(page.getByTestId('edited-chip')).toContainText('Edited');
    await page.goto(`${base}/r/${id}?t=2`);
    const cursor = page.locator('.player-host .replay-cursor');
    await expect(cursor).toBeVisible();
    await expect(page.locator('.player-host .replay-blur')).toBeVisible();
    await page.getByTestId('edit-replay').click();
    await openCursor();
    await inspector.getByRole('button', { name: 'Reset', exact: true }).click();
    await expect(inspector.locator('output')).toHaveText('100%');
    await expect(page.getByTestId('save-state')).toHaveText('Saved');
    const reset = await (await page.request.get(`${base}/api/replays/${id}/edits`)).json();
    expect(reset.cursor).toBeUndefined();
    expect(reset.blurs).toEqual([blur]);
  });
}
