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
async function openEditor(page: Page, edits: Record<string, unknown> = {}) {
  const id = uniqueId('marks');
  const bundle = await cloneBundle(page.request, base(), 'demo-shop', id);
  await postBundle(page.request, base(), { ...bundle, steps: STEPS });
  const saved = await page.request.put(`${base()}/api/replays/${id}/edits`, {
    headers: { origin: base(), 'if-match': '"e.none"' },
    data: { version: 1, cuts: [], ...edits },
  });
  expect(saved.ok(), await saved.text()).toBe(true);
  await page.goto(`${base()}/r/${id}/edit`);
  await expect(page.getByTestId('timeline')).toHaveAttribute('data-ready', 'true');
}

const tooltip = (page: Page) => page.locator('[data-slot="tooltip-content"]');

test.describe('editor timeline marks', () => {
  test('a step dot names its step on hover and seeks there on click', async ({ page }) => {
    await openEditor(page);
    const dots = page.getByRole('group', { name: 'Steps' }).getByRole('button');
    await expect(dots).toHaveCount(3);
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

  test('the tools and the add row say what they do with their key', async ({ page }) => {
    await openEditor(page);
    await page.getByTestId('remove-waits').hover();
    await expect(tooltip(page)).toContainText('Find waits to remove');
    await expect(tooltip(page).locator('kbd')).toHaveText('W');
    await page.getByTestId('invite-zoom').hover();
    await expect(tooltip(page)).toContainText('Zoom in on every click');
    await expect(tooltip(page).locator('kbd')).toHaveText('Z');
    await expect(page.getByTestId('invite-caption').locator('.tl-invite-key')).toHaveText('T');
    await expect(page.getByTestId('invite-caption')).toHaveAccessibleName('Captions');
  });

  test('the clip shows its activity and a cut dims the bars it removes', async ({ page }) => {
    await openEditor(page, { cuts: [{ id: 'cut-1', from: 1_000, to: 5_000 }] });
    const activity = page.getByTestId('clip-activity');
    await expect(activity).toHaveAttribute('aria-hidden', 'true');
    const bars = activity.locator('rect');
    const dimmed = activity.locator('rect[data-removed]');
    await expect(dimmed.first()).toBeVisible();
    expect(await dimmed.count()).toBeLessThan(await bars.count());
    const opacity = (locator: typeof bars) => locator.evaluate((element) => Number(getComputedStyle(element).opacity));
    expect(await opacity(dimmed.first())).toBeLessThan(await opacity(activity.locator('rect:not([data-removed])').first()));
    await expect(page.getByRole('group', { name: 'Steps' }).getByRole('button').nth(1)).toHaveAttribute('data-removed', 'true');
  });
});
