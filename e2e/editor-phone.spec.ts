import { expect, test, type Page } from '@playwright/test';

import { boxOf, cloneBundle, postBundle, serveApp } from './support.ts';

const server = serveApp({ REPLAYS_BETA_EDITOR: 'true' });
const base = () => server().origin;
test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });

async function openEdited(page: Page, name: string, extra: Record<string, unknown> = {}) {
  const id = `${name}-${Date.now().toString(36)}`;
  await postBundle(page.request, base(), await cloneBundle(page.request, base(), 'demo-shop', id, 'Phone timeline check'));
  const saved = await page.request.put(`${base()}/api/replays/${id}/edits`, {
    headers: { origin: base(), 'if-match': '"e.none"' },
    data: { version: 1, cuts: [], zooms: [{ id: 'zoom-1', from: 1000, to: 5000, scale: 1.8 }], ...extra },
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

test('the whole recording opens across the screen from 0:00 at its left margin, under the playhead', async ({ page }) => {
  await openEdited(page, 'phone-flush');
  const lanes = await boxOf(page.getByTestId('timeline-lanes'));
  const clip = await boxOf(page.getByTestId('phone-clip'));
  const playhead = await boxOf(page.locator('.phone-snap-marker'));
  expect(clip.x - lanes.x).toBeCloseTo(16, 0);
  expect(clip.x + clip.width).toBeLessThanOrEqual(lanes.x + lanes.width - 15);
  expect(playhead.x + playhead.width / 2).toBeCloseTo(clip.x, 0);
});

test('the timeline bar reads what the edits leave as the desktop does, after the time', async ({ page }) => {
  await openEdited(page, 'phone-durations', { cuts: [{ id: 'cut-1', from: 2000, to: 5000 }] });
  const durations = page.getByTestId('durations');
  await expect(durations).toHaveText(/^\d:\d\d\.\d\s*after edits$/, { useInnerText: true });
  await expect(page.locator('.phone-time')).toContainText('/ 0:');
});

test('dragging along the scale scrubs, and a scrub ending near a step settles on it', async ({ page }) => {
  await openEdited(page, 'phone-scrub');
  const clock = page.getByTestId('editor-clock');
  await expect(clock).toHaveText('0:00.0');
  const scale = await boxOf(page.getByTestId('phone-scale'));
  const segment = await boxOf(page.locator('.phone-step').nth(2));
  const y = scale.y + 6;
  await page.mouse.move(scale.x + 20, y);
  await page.mouse.down();
  await page.mouse.move(segment.x + 40, y, { steps: 4 });
  await page.mouse.move(segment.x + 1, y, { steps: 4 });
  await expect(page.getByTestId('phone-playhead')).not.toHaveValue('0');
  await page.mouse.up();
  const start = await page.evaluate(() => {
    const track = document.querySelector('.phone-track')?.getBoundingClientRect();
    const step = document.querySelectorAll('.phone-step')[2]?.getBoundingClientRect();
    return track && step ? step.left - track.left : -1;
  });
  await expect
    .poll(async () => {
      const at = await page.evaluate(() => getComputedStyle(document.querySelector('.phone-track')!).getPropertyValue('--playhead'));
      return Math.abs(Number.parseFloat(at) - start);
    })
    .toBeLessThanOrEqual(1.5);
});

test('a step dot on the scale seeks when tapped and names its step under it, clear of the time', async ({ page }) => {
  await openEdited(page, 'phone-dots');
  const dot = page.locator('[data-testid="ruler-step"]:not([data-kind="wait"])').nth(1);
  const name = (await dot.getAttribute('aria-label')) ?? '';
  const [label = '', at = ''] = [name.split(',')[0], /at (\d+:\d\d\.\d)$/.exec(name)?.[1]];
  const target = await boxOf(dot);
  expect(Math.min(target.width, target.height)).toBeGreaterThanOrEqual(24);
  const hit = await page.evaluate(
    ({ x, y, w, h }) =>
      [
        [x + 2, y + h / 2],
        [x + w - 2, y + h / 2],
        [x + w / 2, y + 2],
        [x + w / 2, y + h - 2],
      ].every(([px, py]) => document.elementFromPoint(px ?? 0, py ?? 0)?.closest('[data-testid="ruler-step"]') !== null),
    { x: target.x, y: target.y, w: target.width, h: target.height },
  );
  expect(hit).toBe(true);
  await dot.tap();
  const bubble = page.getByTestId('step-bubble');
  await expect(bubble).toContainText(label);
  await expect(page.getByTestId('editor-clock')).toHaveText(at);
  const [shown, time] = [await boxOf(bubble), await boxOf(page.locator('.phone-time'))];
  expect(shown.y).toBeGreaterThanOrEqual(time.y + time.height);
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
