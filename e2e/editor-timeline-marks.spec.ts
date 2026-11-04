import { expect, type Page, test } from '@playwright/test';

import { cloneBundle, postBundle, serveApp, uniqueId } from './support.ts';

const server = serveApp({ REPLAYS_BETA_EDITOR: 'true' });
const base = () => server().origin;

test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });

const STEPS = [
  { at: 2_000, kind: 'click', label: 'Open the cart' },
  { at: 4_000, kind: 'fill', label: 'Enter an email address' },
  { at: 7_000, kind: 'click', label: 'Place the order' },
];

/** demo-shop with three steps far enough apart to stay three dots, and `edits` saved before the editor opens. */
async function openEditor(page: Page, { steps = STEPS, ...edits }: Record<string, unknown> & { steps?: unknown[] } = {}) {
  const id = uniqueId('marks');
  const bundle = await cloneBundle(page.request, base(), 'demo-shop', id);
  await postBundle(page.request, base(), { ...bundle, steps });
  const saved = await page.request.put(`${base()}/api/replays/${id}/edits`, {
    headers: { origin: base(), 'if-match': '"e.none"' },
    data: { version: 1, cuts: [], ...edits },
  });
  expect(saved.ok(), await saved.text()).toBe(true);
  await page.goto(`${base()}/r/${id}/edit`);
  await expect(page.getByTestId('timeline')).toHaveAttribute('data-ready', 'true');
}

const tooltip = (page: Page) => page.locator('[data-slot="tooltip-content"]');

test.describe('editor timeline step dots', () => {
  test('a step dot names its step on hover and seeks there on click', async ({ page }) => {
    await openEditor(page);
    const dots = page.getByRole('group', { name: 'Steps' }).getByRole('button');
    await expect(dots).toHaveCount(3);
    const target = await dots.nth(2).boundingBox();
    expect(Math.min(target?.width ?? 0, target?.height ?? 0)).toBeGreaterThanOrEqual(24);
    await dots.nth(2).hover();
    await expect(tooltip(page)).toContainText('Place the order');
    await dots.nth(2).click();
    await expect(page.getByTestId('editor-clock')).toHaveText('0:07.0');
  });

  test('the step dots are one tab stop whose arrows move between steps and whose Enter seeks', async ({ page }) => {
    await openEditor(page);
    const dots = page.getByRole('group', { name: 'Steps' }).getByRole('button');
    await expect(dots.nth(0)).toHaveAttribute('tabindex', '0');
    await expect(dots.nth(1)).toHaveAttribute('tabindex', '-1');
    await dots.nth(0).focus();
    await page.keyboard.press('ArrowRight');
    await expect(dots.nth(1)).toBeFocused();
    await expect(tooltip(page)).toContainText('Enter an email address');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('editor-clock')).toHaveText('0:04.0');
  });

  test('a filled dot names its action and time, and a hollow one its pause', async ({ page }) => {
    await openEditor(page, { steps: [...STEPS, { at: 8_000, kind: 'wait', label: 'Wait for the receipt' }] });
    const dots = page.getByRole('group', { name: 'Steps' }).getByRole('button');
    await dots.nth(0).hover();
    await expect(tooltip(page)).toContainText('Click · 0:02.0');
    await dots.nth(3).hover();
    await expect(tooltip(page)).toContainText(/Wait · \d+\.\d s/);
    await expect(dots.nth(3)).toHaveAccessibleName(/^Wait for the receipt, Wait of \d+\.\d seconds at 0:08\.0$/);
  });

  test('a step dot under a cut dims, and the clip itself stays plain', async ({ page }) => {
    await openEditor(page, { cuts: [{ id: 'cut-1', from: 1_000, to: 5_000 }] });
    const dots = page.getByRole('group', { name: 'Steps' }).getByRole('button');
    await expect(dots.nth(1)).toHaveAttribute('data-removed', 'true');
    await expect(dots.nth(2)).not.toHaveAttribute('data-removed');
    await expect(page.locator('.tl-clip svg')).toHaveCount(0);
  });
});

test.describe('editor tools and Add menu', () => {
  test('the tools show their keys, and the Add menu names each item briefly and says what it does on its last line', async ({ page }) => {
    await openEditor(page);
    await expect(page.getByTestId('add-cut').locator('.editor-key')).toHaveText('C');
    await expect(page.getByTestId('add-point-highlight').locator('.editor-key')).toHaveText('M');
    await page.getByTestId('add-effect').click();
    const menu = page.getByRole('menu', { name: 'Add to timeline' });
    await expect(menu.getByRole('menuitem')).toHaveText(['ZoomZ', 'Speed upF', 'BlurB', 'CaptionsT', 'HighlightM']);
    await expect(menu.getByRole('separator')).toHaveCount(1);
    await menu.getByRole('menuitem', { name: 'Zoom' }).hover();
    await expect(page.getByTestId('add-hint')).toHaveText('Zoom in on every click');
    await expect(menu.getByRole('menuitem', { name: 'Zoom' })).toHaveAccessibleDescription('Zoom in on every click');
    await expect(page.getByTestId('lane-invitation')).toHaveCount(0);
  });
});
