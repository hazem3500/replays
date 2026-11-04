import { AxeBuilder } from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

import { assertStoredReplayEdits } from '../src/shared/edits.ts';
import { boxOf, cloneBundle, postBundle, serveApp, useTheme } from './support.ts';

const server = serveApp({ REPLAYS_BETA_EDITOR: 'true' });
const base = () => server().origin;

test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });

async function seed(page: Page, edits: Record<string, unknown>) {
  const id = `controls-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await postBundle(page.request, base(), await cloneBundle(page.request, base(), 'human-demo', id));
  const saved = await page.request.put(`${base()}/api/replays/${id}/edits`, {
    headers: { origin: base(), 'if-match': '"e.none"' },
    data: { version: 1, cuts: [], ...edits },
  });
  expect(saved.ok(), await saved.text()).toBe(true);
  await page.goto(`${base()}/r/${id}/edit`);
  await expect(page.getByTestId('timeline')).toHaveAttribute('data-ready', 'true');
  return id;
}

async function stored(page: Page, id: string) {
  const body: unknown = await (await page.request.get(`${base()}/api/replays/${id}/edits`)).json();
  assertStoredReplayEdits(body);
  return body;
}

test('zoom level: a stored quick level loads, arrows step it, Shift steps further, and each step saves and undoes', async ({ page }) => {
  const id = await seed(page, { zooms: [{ id: 'zoom-1', from: 400, to: 2400, scale: 1.4 }] });
  await page.getByTestId('region-zoom').locator('.tl-region-body').click();
  const inspector = page.getByRole('complementary', { name: 'Inspector' });
  const level = inspector.getByRole('slider', { name: 'Zoom level' });
  const readout = inspector.locator('.inspector-value').first();
  await expect(readout).toHaveText('1.4×');
  await expect(inspector.getByRole('button', { name: 'Set zoom to 1.4×' })).toHaveAttribute('aria-pressed', 'true');
  await level.focus();
  await page.keyboard.press('ArrowRight');
  await expect(readout).toHaveText('1.5×');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(readout).toHaveText('2×');
  await expect.poll(async () => (await stored(page, id)).zooms?.[0]?.scale).toBe(2);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(readout).toHaveText('1.5×');
});

test('zoom level: a drag previews every value but is one undo step', async ({ page }) => {
  await seed(page, { zooms: [{ id: 'zoom-1', from: 400, to: 2400, scale: 1.8 }] });
  await page.getByTestId('region-zoom').locator('.tl-region-body').click();
  const inspector = page.getByRole('complementary', { name: 'Inspector' });
  const readout = inspector.locator('.inspector-value').first();
  const track = await boxOf(inspector.locator('.ui-slider-control'));
  const thumb = await boxOf(inspector.locator('.ui-slider-thumb'));
  await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2);
  await page.mouse.down();
  await page.mouse.move(track.x + track.width * 0.8, thumb.y + thumb.height / 2, { steps: 6 });
  await expect(readout).not.toHaveText('1.8×');
  await page.mouse.move(track.x + track.width, thumb.y + thumb.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect(readout).toHaveText('3×');
  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+z');
  await page.getByTestId('region-zoom').locator('.tl-region-body').click();
  await expect(readout).toHaveText('1.8×');
});

test('a lone point highlight’s marker is centred on the playhead parked at its time', async ({ page }) => {
  await seed(page, { highlights: [{ id: 'here', kind: 'point', at: 2000, label: 'Here' }] });
  await page.getByTestId('timeline-highlight').click();
  await expect(page.getByTestId('editor-clock')).toHaveText('0:02.0');
  const glyph = await boxOf(page.locator('.tl-highlight-glyph'));
  const playhead = await boxOf(page.locator('.tl-playhead'));
  expect(Math.abs(glyph.x + glyph.width / 2 - (playhead.x + playhead.width / 2))).toBeLessThanOrEqual(0.5);
});

test('a caption’s end edge dragged into its neighbour stops at the neighbour’s start', async ({ page }) => {
  const id = await seed(page, {
    captions: [
      { id: 'caption-1', from: 500, to: 1500, text: 'Enter a masked receipt email' },
      { id: 'caption-2', from: 2000, to: 3500, text: 'Review the order' },
    ],
  });
  const first = page.locator('[data-region-id="caption-1"]');
  await first.locator('.tl-region-body').click();
  const edge = await boxOf(first.locator('.tl-region-edge[data-edge="to"]'));
  const neighbour = await boxOf(page.locator('[data-region-id="caption-2"]'));
  await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
  await page.mouse.down();
  await page.mouse.move(neighbour.x + neighbour.width * 0.7, edge.y + edge.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await stored(page, id)).captions?.[0]?.to).toBe(2000);
  expect((await stored(page, id)).captions?.[1]).toMatchObject({ from: 2000, to: 3500 });
});

test('a selected clip lifts a labelled Remove bubble above it, next in Tab order, and Enter or Delete removes it', async ({ page }) => {
  await seed(page, { zooms: [{ id: 'zoom-1', from: 400, to: 2400, scale: 1.8 }] });
  const region = page.getByTestId('region-zoom');
  const bubble = region.getByRole('button', { name: /^Remove Zoom / });
  await region.locator('.tl-region-body').hover();
  await expect(bubble).toHaveCSS('opacity', '0');
  await region.locator('.tl-region-body').click();
  await expect(bubble).toHaveCSS('opacity', '1');
  expect((await boxOf(bubble)).y + (await boxOf(bubble)).height).toBeLessThanOrEqual((await boxOf(region)).y);
  await region.locator('.tl-region-body').focus();
  await page.keyboard.press('Tab');
  await expect(bubble).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('region-zoom')).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+z');
  await page.getByTestId('region-zoom').locator('.tl-region-body').focus();
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('region-zoom')).toHaveCount(0);
});

test('the Remove bubble centres on its clip and moves below its lane when a label above is in the way', async ({ page }) => {
  await seed(page, {
    zooms: [{ id: 'zoom-1', from: 400, to: 2400, scale: 1.8 }],
    speeds: [{ id: 'speed-1', from: 400, to: 2400, rate: 4 }],
    blurs: [{ id: 'blur-1', from: 3000, to: 3600, x: 0.1, y: 0.1, width: 0.3, height: 0.2 }],
  });
  const speed = page.getByTestId('region-speed');
  await speed.locator('.tl-region-body').click();
  const bubble = speed.getByTestId('remove-speed');
  await expect(bubble).toHaveAttribute('data-side', 'below');
  const [own, clip] = await Promise.all([boxOf(bubble), boxOf(speed)]);
  expect(own.y).toBeGreaterThanOrEqual(clip.y + clip.height);
  expect(Math.abs(own.x + own.width / 2 - (clip.x + clip.width / 2))).toBeLessThanOrEqual(1);
});

test('a short clip gets an icon-only Remove bubble that keeps its name', async ({ page }) => {
  await seed(page, { speeds: [{ id: 'speed-1', from: 1000, to: 1150, rate: 4 }] });
  const speed = page.getByTestId('region-speed');
  await speed.locator('.tl-region-body').click();
  const bubble = speed.getByTestId('remove-speed');
  await expect(bubble).toHaveAttribute('data-compact', '');
  await expect(bubble).toHaveAccessibleName(/^Remove /);
  expect((await boxOf(bubble)).width).toBeLessThanOrEqual(24);
});

test('the inspector header names its remove action, follows the back link in Tab order and removes the object', async ({ page }) => {
  await seed(page, { captions: [{ id: 'caption-1', from: 500, to: 2500, text: 'Fill in the form' }] });
  await page.getByTestId('region-caption').locator('.tl-region-body').click();
  const inspector = page.getByRole('complementary', { name: 'Inspector' });
  await inspector.getByTestId('inspector-back').focus();
  await page.keyboard.press('Tab');
  await expect(inspector.getByRole('button', { name: 'Remove caption' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('region-caption')).toHaveCount(0);
});

for (const theme of ['light', 'dark'] as const)
  test(`every inspector panel passes axe with no serious or critical findings (${theme})`, async ({ page }) => {
    await useTheme(page, theme);
    await seed(page, {
      zooms: [{ id: 'zoom-1', from: 400, to: 1400, scale: 1.8 }],
      speeds: [{ id: 'speed-1', from: 1500, to: 2500, rate: 4 }],
      blurs: [{ id: 'blur-1', from: 200, to: 1200, x: 0.1, y: 0.1, width: 0.3, height: 0.2 }],
      captions: [{ id: 'caption-1', from: 300, to: 1300, text: 'Fill in the form' }],
      highlights: [{ id: 'here', kind: 'period', from: 2600, to: 3200, label: 'Here' }],
    });
    const panels = [
      page.getByTestId('region-zoom').locator('.tl-region-body'),
      page.getByTestId('region-speed').locator('.tl-region-body'),
      page.getByTestId('region-blur').locator('.tl-region-body'),
      page.getByTestId('region-caption').locator('.tl-region-body'),
      page.getByTestId('timeline-highlight').first(),
    ];
    for (const target of panels) {
      await target.click();
      // why: axe must measure the settled panel, not text still fading in after the selection changed.
      await page.evaluate(() =>
        Promise.all(
          document
            .getAnimations()
            .filter((animation) => animation.effect?.getComputedTiming().endTime !== Number.POSITIVE_INFINITY)
            .map((animation) => animation.finished.catch(() => undefined)),
        ),
      );
      const results = await new AxeBuilder({ page }).include('aside.editor-presentation').analyze();
      const blocking = results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical');
      expect(blocking.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`)).toEqual(
        [],
      );
    }
  });

test('hovering then selecting a clip too short to show its remove control keeps the editor open', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await seed(page, {
    captions: [
      { id: 'caption-1', from: 1000, to: 1300, text: 'Short' },
      { id: 'caption-2', from: 2000, to: 3500, text: 'Long enough to show its remove control' },
    ],
  });
  const short = page.locator('[data-region-id="caption-1"]');
  await expect(short).toHaveAttribute('data-compact');
  await short.locator('.tl-region-body').hover();
  await page.mouse.move(5, 5);
  await short.locator('.tl-region-body').hover();
  await short.locator('.tl-region-body').click();
  await expect(page.getByRole('complementary', { name: 'Inspector' }).getByRole('heading', { name: 'Caption' })).toBeVisible();
  await page.locator('[data-region-id="caption-2"] .tl-region-body').click();
  await expect(page.getByTestId('timeline')).toBeVisible();
  expect(errors).toEqual([]);
});
