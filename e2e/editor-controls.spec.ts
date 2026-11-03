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

test('a selected region’s remove control has a 24 px target clear of its edge handle and keeps the label still', async ({ page }) => {
  await seed(page, { zooms: [{ id: 'zoom-1', from: 400, to: 2400, scale: 1.8 }] });
  const region = page.getByTestId('region-zoom');
  const label = region.locator('.tl-region-label');
  // why: selecting scrolls the lane into view, so compare the label's place inside its region, not on the page.
  const offset = async () => {
    const [own, block] = await Promise.all([boxOf(label), boxOf(region)]);
    return { left: own.x - block.x, width: own.width };
  };
  const before = await offset();
  await region.locator('.tl-region-body').click();
  const remove = region.getByRole('button', { name: /^Remove / });
  await expect(remove).toHaveCSS('opacity', '1');
  const hit = await remove.evaluate((node) => {
    const box = node.getBoundingClientRect();
    const inset = Number.parseFloat(getComputedStyle(node, '::before').top);
    return { size: box.width - inset * 2, right: box.right - inset };
  });
  expect(hit.size).toBeGreaterThanOrEqual(24);
  const edge = await boxOf(region.locator('.tl-region-edge[data-edge="to"]'));
  expect(hit.right).toBeLessThanOrEqual(edge.x + 0.5);
  expect(await offset()).toEqual(before);
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
      const results = await new AxeBuilder({ page }).include('aside.editor-presentation').analyze();
      const blocking = results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical');
      expect(blocking.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`)).toEqual(
        [],
      );
    }
  });
