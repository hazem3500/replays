import { expect, type Locator, type Page, test } from '@playwright/test';

import { cloneBundle, createSuite, gotoHydrated, postBundle, serveApp, uniqueId } from './support.ts';

const server = serveApp();

async function seed(page: Page) {
  const base = server().origin;
  const id = uniqueId('row-menu');
  const title = `Row menu ${id}`;
  await postBundle(page.request, base, await cloneBundle(page.request, base, 'demo-shop', id, title));
  const suite = uniqueId('row-suite');
  await createSuite(page.request, base, suite, [
    { id: 'one', label: 'Run one', status: 'passed', replayId: `${suite}-one` },
    { id: 'two', label: 'Run two', status: 'failed', replayId: `${suite}-two` },
  ]);
  await page.setViewportSize({ width: 1280, height: 800 });
  await gotoHydrated(page, base);
  const single = page.locator('.feed-session', { has: page.getByRole('link', { name: new RegExp(`^${title},`) }) });
  const group = page.locator('.feed-suite', { has: page.getByRole('link', { name: new RegExp(`^Review ${suite},`) }) });
  return { base, id, title, suite, single, group };
}

const itemNames = (page: Page) => page.getByRole('menu').getByRole('menuitem').allTextContents();

const clipboardText = (page: Page) => page.evaluate(() => navigator.clipboard.readText());

async function recordContextMenuPrevention(page: Page) {
  await page.evaluate(() => {
    document.addEventListener('contextmenu', (event) => {
      document.documentElement.dataset['contextPrevented'] = String(event.defaultPrevented);
    });
  });
}

async function rightClick(row: Locator) {
  const box = await row.boundingBox();
  if (!box) throw new Error('row is not laid out');
  const position = { x: Math.min(box.width - 4, 420), y: Math.min(box.height - 4, 30) };
  await row.click({ button: 'right', position });
  return { x: box.x + position.x, y: box.y + position.y };
}

test.describe('index row menus: opening', () => {
  test('right click on a replay row opens its menu at the pointer, with Delete last', async ({ page }) => {
    const { single } = await seed(page);
    const at = await rightClick(single);
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    expect(await itemNames(page)).toEqual(['Open', 'Open in new tab', 'Copy link', 'Delete replay']);
    const box = await menu.boundingBox();
    expect(Math.abs((box?.x ?? 0) - at.x)).toBeLessThan(24);
    expect(Math.abs((box?.y ?? 0) - at.y)).toBeLessThan(24);
    await expect(single.getByRole('button', { name: /^Actions for / })).toBeAttached();
  });

  test('right click on a suite row offers Compare runs and no Delete', async ({ page }) => {
    const { group } = await seed(page);
    await rightClick(group);
    await expect(page.getByRole('menu')).toBeVisible();
    expect(await itemNames(page)).toEqual(['Open', 'Open in new tab', 'Copy link', 'Compare runs']);
  });

  test('the ⋯ button lists the same actions as the right-click menu on both row types', async ({ page }) => {
    const { single, group } = await seed(page);
    for (const row of [single, group]) {
      await rightClick(row);
      const fromContext = await itemNames(page);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menu')).toHaveCount(0);
      await row.hover();
      await row.getByRole('button', { name: /^Actions for / }).click();
      expect(await itemNames(page)).toEqual(fromContext);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menu')).toHaveCount(0);
    }
  });

});

test.describe('index row menus: actions', () => {
  test('Compare runs opens the suite comparing its runs', async ({ page }) => {
    const { group, suite } = await seed(page);
    await rightClick(group);
    await page.getByRole('menuitem', { name: 'Compare runs' }).click();
    await expect(page).toHaveURL(new RegExp(`/s/${suite}`));
    await expect(page.getByTestId('compare-stage')).toBeVisible();
  });

  test('Delete replay asks for the same confirmation as the ⋯ button', async ({ page }) => {
    const { single, title } = await seed(page);
    await rightClick(single);
    await page.getByRole('menuitem', { name: 'Delete replay' }).click();
    const confirmation = page.getByRole('dialog', { name: 'Delete replay?', exact: true });
    await expect(confirmation).toContainText(title);
    await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(confirmation).toBeHidden();
  });

  test('Open in new tab opens the row address in another tab', async ({ page }) => {
    const { single, id } = await seed(page);
    await rightClick(single);
    const popup = page.waitForEvent('popup');
    await page.getByRole('menuitem', { name: 'Open in new tab' }).click();
    expect(new URL((await popup).url()).pathname).toBe(`/r/${id}`);
  });

  test('Copy link writes the row address to the clipboard', async ({ page, context }) => {
    const { base, single, id } = await seed(page);
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
    await rightClick(single);
    await page.getByRole('menuitem', { name: 'Copy link' }).click();
    await expect.poll(() => clipboardText(page)).toBe(`${base}/r/${id}`);
  });

});

test.describe('index row menus: keyboard and browser menu', () => {
  test('Shift+F10 opens the menu on the focused row and Escape returns focus to it', async ({ page }) => {
    const { single, title } = await seed(page);
    const link = single.getByRole('link', { name: new RegExp(`^${title},`) });
    await link.focus();
    await page.keyboard.press('Shift+F10');
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(link).toBeFocused();
    await page.keyboard.press('ContextMenu');
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(link).toBeFocused();
  });

  test('Shift+right click leaves the browser menu alone', async ({ page }) => {
    const { single } = await seed(page);
    await recordContextMenuPrevention(page);
    const box = await single.boundingBox();
    if (!box) throw new Error('row is not laid out');
    await single.click({ button: 'right', modifiers: ['Shift'], position: { x: Math.min(box.width - 4, 420), y: 30 } });
    await expect(page.locator('html')).toHaveAttribute('data-context-prevented', 'false');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await rightClick(single);
    await expect(page.getByRole('menu')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-context-prevented', 'true');
  });
});
