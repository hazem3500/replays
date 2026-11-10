import { expect, test, type Page } from '@playwright/test';

import { openReplay, origin } from './support.ts';

test.use({ viewport: { width: 390, height: 800 } });

const menuNames = [/^Replay details$/, /^Theme/, /^Keyboard shortcuts/, /^Delete replay$/, /^Reset view$/];

async function pointerGestures({ page }: { page: Page }) {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openReplay(page, `${origin()}/r/demo-shop`);
  await page.getByRole('button', { name: 'More actions', exact: true }).click();
  const menu = page.getByRole('menu');
  for (const name of menuNames) {
    const item = menu.getByRole('menuitem', { name });
    const icon = item.locator('svg.animated-icon');
    await expect(icon).toHaveCount(1);
    await item.hover();
    await expect(icon).toHaveAttribute('data-playing', '');
    await expect(icon).not.toHaveAttribute('data-playing', '', { timeout: 1500 });
    const replayed = await icon.evaluate(
      (element) =>
        new Promise<boolean>((resolve) => {
          let restarted = false;
          const observer = new MutationObserver(() => {
            if (element.hasAttribute('data-playing')) restarted = true;
          });
          observer.observe(element, { attributes: true, attributeFilter: ['data-playing'] });
          window.setTimeout(() => {
            observer.disconnect();
            resolve(restarted);
          }, 420);
        }),
    );
    expect(replayed).toBe(false);
  }
  await expect(menu.getByRole('menuitem', { name: 'Delete replay', exact: true })).toHaveAttribute('data-variant', 'destructive');
}

async function keyboardGestures({ page }: { page: Page }) {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openReplay(page, `${origin()}/r/demo-shop`);
  const more = page.getByRole('button', { name: 'More actions', exact: true });
  await more.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu');
  await page.keyboard.press('Home');
  const rows = menu.getByRole('menuitem');
  const count = await rows.count();
  let animated = 0;
  for (let index = 0; index < count; index += 1) {
    const highlighted = menu.locator('[role="menuitem"][data-highlighted]');
    await expect(highlighted).toHaveCount(1);
    const icon = highlighted.locator('svg.animated-icon');
    if (await icon.count()) {
      await expect(icon).toHaveAttribute('data-playing', '');
      animated += 1;
    }
    if (index < count - 1) await page.keyboard.press('ArrowDown');
  }
  expect(animated).toBeGreaterThanOrEqual(menuNames.length);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(more).toBeFocused();
}

async function reducedGestures({ page }: { page: Page }) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openReplay(page, `${origin()}/r/demo-shop`);
  await page.getByRole('button', { name: 'More actions', exact: true }).click();
  const menu = page.getByRole('menu');
  await expect(menu.locator('svg.animated-icon[data-playing]')).toHaveCount(0);
  for (const name of menuNames) {
    await menu.getByRole('menuitem', { name }).hover();
    await expect(menu.locator('svg.animated-icon[data-playing]')).toHaveCount(0);
  }
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown');
  await expect(menu.locator('svg.animated-icon[data-playing]')).toHaveCount(0);
}

test.describe('More action icon gestures', () => {
  test('More actions play purposeful one-shot icon gestures on pointer entry', pointerGestures);
  test('Base UI keyboard highlights animate menu icons without activating their actions', keyboardGestures);
  test('reduced motion keeps pointer and highlighted menu icons at rest', reducedGestures);
});
