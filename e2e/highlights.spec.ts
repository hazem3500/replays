import { expect, test, type Locator, type Page } from '@playwright/test';

import { boxOf, cloneBundle, postBundle, serveApp } from './support.ts';

const server = serveApp({ REPLAYS_BETA_EDITOR: 'true' });

async function dragOnClip(page: Page, x1: number, x2: number, touch: boolean) {
  const clip = await boxOf(page.getByTestId('lane-clip'));
  const y = clip.y + clip.height / 2;
  const from = clip.x + clip.width * x1;
  const to = clip.x + clip.width * x2;
  if (touch) {
    const session = await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from, y }] });
    for (let step = 1; step <= 5; step++)
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from + ((to - from) * step) / 5, y }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await session.detach();
  } else {
    await page.mouse.move(from, y);
    await page.mouse.down();
    await page.mouse.move(to, y, { steps: 5 });
    await page.mouse.up();
  }
}

async function dragFromViewerMarker(page: Page, touch: boolean) {
  const marker = await boxOf(page.locator('.scrubber-highlight-marker').first());
  const from = { x: marker.x + marker.width / 2, y: marker.y + marker.height / 2 };
  const to = { x: from.x + 56, y: from.y };
  if (touch) {
    const session = await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
    for (let step = 1; step <= 5; step++)
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (56 * step) / 5, y: from.y }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await session.detach();
  } else {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 5 });
    await page.mouse.up();
  }
}

async function activate(marker: Locator, page: Page, touch: boolean) {
  if (!touch) return marker.click();
  await marker.focus();
  await page.keyboard.press('Enter');
}

async function finishEditing(page: Page, touch: boolean) {
  if (touch) await page.locator('.editor-mobile-header').getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('link', { name: 'Back to the replay' }).click();
}

async function runHighlightFlow(page: Page, width: number, height: number, touch: boolean) {
  await page.setViewportSize({ width, height });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const base = server().origin;
  const id = `highlights-${width}-${Date.now().toString(36)}`;
  await postBundle(page.request, base, await cloneBundle(page.request, base, 'human-demo', id, 'Highlight check'));

  await page.goto(`${base}/r/${id}/edit`);
  await expect(page.getByTestId('timeline')).toHaveAttribute('data-ready', 'true');

  await page.locator('body').press('m');
  await expect(page.getByTestId('timeline-highlight')).toHaveCount(1);
  await page.getByRole('textbox', { name: 'Highlight label' }).fill('Entry point');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByRole('textbox', { name: 'Highlight label' })).toHaveValue('');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(page.getByRole('textbox', { name: 'Highlight label' })).toHaveValue('Entry point');
  await page.getByRole('spinbutton', { name: 'Time in seconds' }).fill('0.5');
  await expect(page.getByRole('spinbutton', { name: 'Time in seconds' })).toHaveValue('0.5');

  await dragOnClip(page, 0.3, 0.7, touch);
  await expect(page.getByTestId('range-selection')).toBeVisible();
  await page.getByTestId('add-period-highlight').click();
  await expect(page.getByTestId('timeline-highlight')).toHaveCount(3);
  const label = page.getByRole('textbox', { name: 'Highlight label' });
  await label.fill('Checkout flow');
  await expect(page.getByTestId('save-state')).toHaveText('Saved');

  await dragOnClip(page, 0.45, 0.55, touch);
  await page.keyboard.press('c');
  await expect(page.getByTestId('region-cut')).toHaveCount(1);
  await finishEditing(page, touch);
  await expect(page.getByTestId('scrubber-highlights')).toBeVisible();
  await expect(page.locator('.scrubber-highlight-marker')).toHaveCount(5);
  const seek = page.getByRole('slider', { name: 'Seek' });
  const viewerMark = page.locator('.scrubber-highlight-marker').nth(0);
  if (touch) await viewerMark.tap();
  else {
    await viewerMark.focus();
    await page.keyboard.press('Enter');
  }
  await expect(seek).not.toHaveValue('0');
  const seekBeforeDrag = await seek.inputValue();
  await dragFromViewerMarker(page, touch);
  await expect(seek).not.toHaveValue(seekBeforeDrag);

  const stored: unknown = await (await page.request.get(`${base}/api/replays/${id}/edits`)).json();
  expect(stored).toHaveProperty('highlights.length', 2);
  expect(stored).toMatchObject({
    highlights: expect.arrayContaining([expect.objectContaining({ kind: 'period' }), expect.objectContaining({ kind: 'point' })]),
  });
  await page.goto(`${base}/r/${id}/edit`);
  await expect(page.getByTestId('timeline')).toHaveAttribute('data-ready', 'true');
  await page.locator('.tl-highlight-marker[data-kind="period"]').first().click();
  await expect(page.getByRole('textbox', { name: 'Highlight label' })).toHaveValue('Checkout flow');
  await activate(page.locator('.tl-highlight-marker[data-kind="point"]'), page, touch);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('i');
  await expect(page.getByTestId('save-state')).toHaveText('Saved');
  await finishEditing(page, touch);
  await expect(page.locator('.scrubber-highlight-marker')).toHaveCount(4);

  await page.goto(`${base}/r/${id}/edit`);
  await expect(page.getByTestId('timeline')).toHaveAttribute('data-ready', 'true');
  await activate(page.locator('.tl-highlight-marker[data-kind="point"]'), page, touch);
  await page.getByTestId('remove-highlight').click();
  await expect(page.getByTestId('timeline-highlight')).toHaveCount(2);
  await expect(page.getByTestId('save-state')).toHaveText('Saved');
  await page.reload();
  await expect(page.getByTestId('timeline')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByTestId('timeline-highlight')).toHaveCount(2);
}

test.describe('desktop', () => {
  test('create, edit, delete, undo/redo, autosave, reload and navigate through a cut', async ({ page }) => {
    await runHighlightFlow(page, 1280, 800, false);
  });
});

/** The phone timeline selects by tapping and edits in its sheet: More adds and selects a stretch, Adjust opens settings. */
async function runPhoneHighlightFlow(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const base = server().origin;
  const id = `highlights-phone-${Date.now().toString(36)}`;
  await postBundle(page.request, base, await cloneBundle(page.request, base, 'human-demo', id, 'Highlight check'));
  await page.goto(`${base}/r/${id}/edit`);
  await expect(page.getByTestId('timeline')).toHaveAttribute('data-ready', 'true');
  const more = page.locator('.editor-add-more');
  const sheet = page.getByTestId('phone-sheet');
  const label = sheet.getByRole('textbox', { name: 'Highlight label' });

  await more.click();
  await page.getByTestId('add-point-highlight').click();
  await expect(page.getByTestId('timeline-highlight')).toHaveCount(1);
  await label.fill('Entry point');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(label).toHaveValue('');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(label).toHaveValue('Entry point');
  await sheet.getByTestId('mobile-object-done').click();
  await expect(sheet).toHaveCount(0);
  await page.getByTestId('phone-done').click();

  await page.getByTestId('phone-playhead').fill('3000');
  await more.click();
  await page.getByTestId('select-range').click();
  await page.getByTestId('phone-adjust').click();
  await sheet.getByTestId('add-period-highlight').click();
  await expect(page.getByTestId('timeline-highlight')).toHaveCount(2);
  await label.fill('Checkout flow');
  await expect(page.getByTestId('save-state')).toHaveText('Saved');
  await sheet.getByTestId('mobile-object-done').click();
  await page.getByTestId('phone-done').click();

  await page.locator('[data-testid="timeline-highlight"][data-kind="point"]').tap();
  await page.getByTestId('phone-adjust').click();
  await expect(label).toHaveValue('Entry point');
  await sheet.getByTestId('mobile-object-done').click();
  await page.getByTestId('phone-delete').click();
  await expect(page.getByTestId('timeline-highlight')).toHaveCount(1);
  await expect(page.getByTestId('save-state')).toHaveText('Saved');
  await page.reload();
  await expect(page.getByTestId('timeline')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('[data-testid="timeline-highlight"][data-kind="period"]')).toHaveCount(1);
  await finishEditing(page, true);
  await expect(page.locator('.scrubber-highlight-marker[data-kind="period"]')).toHaveCount(2);
  await expect(page.locator('.scrubber-highlight-marker[data-kind="point"]')).toHaveCount(0);
}

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test('adds a moment and a stretch from More, labels them in the sheet, removes one and keeps the other', async ({ page }) => {
    await runPhoneHighlightFlow(page);
  });
});
