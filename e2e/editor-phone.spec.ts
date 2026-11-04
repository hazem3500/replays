import { expect, test, type Page } from '@playwright/test';

import { boxOf, cloneBundle, postBundle, serveApp } from './support.ts';

const server = serveApp({ REPLAYS_BETA_EDITOR: 'true' });
const base = () => server().origin;
test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });

async function openEdited(page: Page, name: string) {
  const id = `${name}-${Date.now().toString(36)}`;
  await postBundle(page.request, base(), await cloneBundle(page.request, base(), 'demo-shop', id, 'Phone timeline check'));
  const saved = await page.request.put(`${base()}/api/replays/${id}/edits`, {
    headers: { origin: base(), 'if-match': '"e.none"' },
    data: { version: 1, cuts: [], zooms: [{ id: 'zoom-1', from: 1000, to: 5000, scale: 1.8 }] },
  });
  expect(saved.ok()).toBe(true);
  await page.goto(`${base()}/r/${id}/edit`);
  await expect(page.getByTestId('timeline')).toHaveAttribute('data-ready', 'true');
}

/** Two fingers moving apart (or together) across the middle of the lanes. */
async function pinch(page: Page, from: number, to: number) {
  const lanes = await boxOf(page.getByTestId('timeline-lanes'));
  const y = lanes.y + lanes.height / 2;
  const points = (gap: number) => [
    { x: 195 - gap, y, id: 1 },
    { x: 195 + gap, y, id: 2 },
  ];
  const session = await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(from) });
  for (let step = 1; step <= 6; step++)
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(from + ((to - from) * step) / 6) });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await session.detach();
}

test('scrolling the lanes scrubs under the centre playhead, and a scrub ending near a step settles on it', async ({ page }) => {
  await openEdited(page, 'phone-scrub');
  const clock = page.getByTestId('editor-clock');
  await expect(clock).toHaveText('0:00.0');
  const lanes = await boxOf(page.getByTestId('timeline-lanes'));
  await page.mouse.move(lanes.x + lanes.width / 2, lanes.y + lanes.height / 2);
  await page.mouse.wheel(120, 0);
  await expect(clock).not.toHaveText('0:00.0');
  await expect(page.getByTestId('phone-playhead')).not.toHaveValue('0');

  const step = await page.evaluate(() => {
    const track = document.querySelector('.phone-track');
    const scroller = document.querySelector('.phone-lanes');
    const segment = document.querySelectorAll('.phone-step')[2];
    if (!track || !scroller || !segment) return null;
    const left = segment.getBoundingClientRect().left - track.getBoundingClientRect().left;
    scroller.scrollLeft = left + 6;
    return left;
  });
  expect(step).not.toBeNull();
  await expect
    .poll(async () => Math.abs((await page.evaluate(() => document.querySelector('.phone-lanes')?.scrollLeft ?? -1)) - (step ?? 0)))
    .toBeLessThanOrEqual(1);
});

test('a step dot on the scale seeks when tapped and names its step while the label is up', async ({ page }) => {
  await openEdited(page, 'phone-dots');
  const dot = page.getByTestId('ruler-step').nth(1);
  const name = (await dot.getAttribute('aria-label')) ?? '';
  const [label = '', at = ''] = [name.split(',')[0], /at (\d+:\d\d\.\d)$/.exec(name)?.[1]];
  await dot.tap();
  await expect(page.getByTestId('step-bubble')).toContainText(label);
  await expect(page.getByTestId('editor-clock')).toHaveText(at);
});

test('a tapped region swaps the toolbar to its actions; Split, Duplicate and Delete edit it and Done brings the tools back', async ({
  page,
}) => {
  await openEdited(page, 'phone-select');
  const zooms = page.getByTestId('region-zoom');
  await expect(zooms).toHaveCount(1);
  await page.getByTestId('phone-playhead').fill('3000');
  await zooms.tap();
  const toolbar = page.getByTestId('phone-object-toolbar');
  await expect(toolbar.getByRole('button')).toHaveText(['Adjust', 'Split', 'Duplicate', 'Delete', 'Done']);
  await expect(page.getByTestId('add-caption')).toHaveCount(0);
  await page.getByTestId('phone-split').click();
  await expect(zooms).toHaveCount(2);
  await expect(zooms.nth(1)).toHaveAttribute('aria-label', /0:03\.0 to 0:05\.0/);
  await page.getByTestId('phone-duplicate').click();
  await expect(zooms).toHaveCount(3);
  await page.getByTestId('phone-done').click();
  await expect(toolbar).toHaveCount(0);
  await expect(page.getByTestId('add-caption')).toBeVisible();
  await zooms.first().tap();
  await page.getByTestId('phone-delete').click();
  await expect(zooms).toHaveCount(2);
  await expect(toolbar).toHaveCount(0);
});

test('Adjust opens the settings in a sheet under the picture; Escape closes it back to Adjust, and so does a swipe down', async ({
  page,
}) => {
  await openEdited(page, 'phone-sheet');
  const zoom = page.getByTestId('region-zoom');
  await zoom.tap();
  await page.getByTestId('phone-adjust').click();
  const sheet = page.getByTestId('phone-sheet');
  await expect(sheet.getByRole('heading', { name: 'Zoom' })).toBeVisible();
  const stage = await boxOf(page.locator('.editor-stage .stage-wrap'));
  expect((await boxOf(sheet)).y).toBeGreaterThanOrEqual(stage.y + stage.height);
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId('phone-adjust')).toBeFocused();

  await page.getByTestId('phone-adjust').click();
  await expect(sheet).toBeVisible();
  const grip = sheet.locator('[data-slot="drawer-handle"]');
  await grip.click({ trial: true });
  const handle = await boxOf(grip);
  const session = await page.context().newCDPSession(page);
  const x = handle.x + handle.width / 2;
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: handle.y + handle.height / 2 }] });
  for (let step = 1; step <= 8; step++)
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: handle.y + step * 40 }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await session.detach();
  await expect(sheet).toHaveCount(0);
});

test('a pinch zooms the timeline around the playhead, and Fit returns to the whole recording', async ({ page }) => {
  await openEdited(page, 'phone-pinch');
  const width = () => page.evaluate(() => document.querySelector('.phone-lanes')?.scrollWidth ?? 0);
  const fitted = await width();
  await expect(page.getByTestId('timeline-fit')).toBeDisabled();
  await pinch(page, 30, 120);
  await expect.poll(width).toBeGreaterThan(fitted * 2);
  await expect(page.getByTestId('editor-clock')).toHaveText('0:00.0');
  await page.getByTestId('timeline-fit').click();
  await expect.poll(width).toBe(fitted);
});
