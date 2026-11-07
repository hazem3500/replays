import { expect, test } from '@playwright/test';

import { openReplay, origin } from './support.ts';

test.use({ viewport: { width: 390, height: 800 }, hasTouch: true });

test('keeps the playback switch compact with an expanded touch target', async ({ page }, testInfo) => {
  await openReplay(page, `${origin()}/r/demo-shop`);
  await page.locator('.playback-options').click();
  const control = page.locator('.playback-skip [role="switch"]');
  await expect(control).toHaveAttribute('aria-checked', 'false');
  const geometry = await control.evaluate((node) => {
    const bounds = node.getBoundingClientRect();
    const target = getComputedStyle(node, '::after');
    return {
      coarse: matchMedia('(pointer: coarse)').matches,
      width: bounds.width,
      height: bounds.height,
      hitWidth: bounds.width - Number.parseFloat(target.left) - Number.parseFloat(target.right),
      hitHeight: bounds.height - Number.parseFloat(target.top) - Number.parseFloat(target.bottom),
    };
  });
  expect(geometry.coarse).toBe(true);
  expect(geometry.width).toBeCloseTo(28, 0);
  expect(geometry.height).toBeCloseTo(16, 0);
  expect(geometry.hitWidth).toBeGreaterThanOrEqual(40);
  expect(geometry.hitHeight).toBeGreaterThanOrEqual(40);
  await testInfo.attach('phone-playback-menu', { body: await page.screenshot(), contentType: 'image/png' });
  await testInfo.attach('phone-switch-geometry', { body: JSON.stringify(geometry), contentType: 'application/json' });
  const box = await control.boundingBox();
  if (!box) throw new Error('Playback switch is not rendered');
  await page.touchscreen.tap(box.x + box.width / 2, box.y - 5);
  await expect(control).toHaveAttribute('aria-checked', 'true');
  await page.locator('.playback-skip label').click();
  await expect(control).toHaveAttribute('aria-checked', 'false');
  await control.focus();
  await page.keyboard.press('Space');
  await expect(control).toHaveAttribute('aria-checked', 'true');
});

test('cancels a native switch animation when its connected popup becomes unrendered', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openReplay(page, `${origin()}/r/demo-shop`);
  await page.locator('.playback-options').click();
  const control = page.locator('.playback-skip [role="switch"]');
  const result = await control.evaluate(async (node) => {
    if (!(node instanceof HTMLButtonElement)) throw new Error('Expected a native switch button');
    node.click();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const thumb = node.querySelector('[data-slot="switch-thumb"]');
    const animations = thumb?.getAnimations() ?? [];
    const popup = node.closest<HTMLElement>('[data-slot="popover-content"]');
    const animation = animations[0];
    if (!popup || !thumb || !animation) throw new Error('Expected a running native thumb animation');
    popup.style.display = 'none';
    const hidden = thumb.isConnected && thumb.getClientRects().length === 0;
    let rejectedCommit = false;
    try {
      animation.commitStyles();
    } catch (error) {
      if (!(error instanceof DOMException)) throw error;
      rejectedCommit = error.name === 'InvalidStateError';
    }
    if (!(node instanceof HTMLButtonElement)) throw new Error('Expected a native switch button');
    node.click();
    return { hidden, rejectedCommit, native: animations.every((entry) => entry instanceof Animation) };
  });
  expect(result).toEqual({ hidden: true, rejectedCommit: true, native: true });
  await expect(control).toHaveAttribute('aria-checked', 'false');
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  expect(errors).toEqual([]);
});
