import { expect, type Page, test } from '@playwright/test';

import { serveApp } from './support.ts';

// Edit mode's effect lanes: Z zooms in on the clicks, T makes captions from the steps, a drag on the Speed lane speeds
// a stretch up, B adds a blur box that is dragged into place on the preview. The viewer then plays them: the page
// zooms, the box blurs, the caption shows, and the sped-up stretch shortens the replay.

// The beta editor is off by default: this file's own server turns it on.
const server = serveApp({ REPLAYS_BETA_EDITOR: 'true' });
const base = () => server().origin;

async function uploadHuman(page: Page) {
  const id = `effects-e2e-${Date.now().toString(36)}`;
  const bundle = await (await page.request.get(`${base()}/api/replays/human-demo`)).json();
  bundle.meta.id = id;
  bundle.meta.title = 'Effects check';
  bundle.steps = [
    { at: 0, kind: 'open', label: 'Open the page' },
    { at: 847, kind: 'click', label: 'Click the name field' },
    { at: 1944, kind: 'click', label: 'Click the email field' },
    { at: 3177, kind: 'click', label: 'Tick updates' },
  ];
  expect((await page.request.post(`${base()}/api/replays`, { data: bundle })).status()).toBe(201);
  return id;
}

test('effects: zoom on clicks, captions from steps, a speed-up and a blur box apply in the viewer', async ({ page }) => {
  test.setTimeout(45_000);
  const id = await uploadHuman(page);
  await page.goto(`${base()}/r/${id}/edit`);
  await expect(page.getByTestId('timeline')).toHaveAttribute('data-ready', 'true');
  for (const lane of ['zoom', 'speed', 'blur', 'caption']) await expect(page.getByTestId(`lane-${lane}`)).toBeVisible();
  // Empty lanes say what they are and how to add to them, until they hold something.
  await expect(page.getByTestId('lane-zoom')).toContainText('Zoom · drag to add');
  await expect(page.getByTestId('lane-caption')).toContainText('T writes them from the steps');

  await page.locator('body').press('z');
  await expect(page.getByTestId('region-zoom')).toHaveCount(1);
  await expect(page.getByTestId('lane-zoom').locator('.tl-lane-empty')).toHaveCount(0);
  // Clicking a zoom shows it zoomed: the playhead lands past its ease-in, and its setting sits by the tools.
  await page.getByTestId('region-zoom').locator('.tl-region-body').click();
  await expect(page.locator('.player-host .replayer-wrapper')).toHaveAttribute('style', /scale\((?!1\))/);
  await expect(page.locator('.editor-bar > [data-testid="zoom-setting"]')).toBeVisible();
  await page.keyboard.press('Escape');
  // Back to 0:00 from the ruler's start.
  const ruler = (await page.getByTestId('timeline-ruler').boundingBox())!;
  await page.mouse.click(ruler.x + 2, ruler.y + ruler.height / 2);
  await expect(page.getByTestId('editor-clock')).toHaveText('0:00.0');
  await page.keyboard.press('t');
  await expect(page.getByTestId('region-caption')).toHaveCount(4);

  // A speed-up dragged out on its lane, then set to 8× from the control row.
  const lane = (await page.getByTestId('lane-speed').boundingBox())!;
  const y = lane.y + lane.height / 2;
  await page.mouse.move(lane.x + lane.width * 0.55, y);
  await page.mouse.down();
  await page.mouse.move(lane.x + lane.width * 0.75, y, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByTestId('region-speed')).toHaveCount(1);
  await page.getByTestId('speed-setting').click();
  await page.getByRole('menuitemradio', { name: '8× faster' }).click();
  await expect(page.getByTestId('region-speed')).toContainText('8×');

  // A blur box at the playhead (0:00), dragged on the preview.
  await page.keyboard.press('Escape');
  await page.keyboard.press('b');
  const box = page.getByTestId('blur-box');
  await expect(box).toBeVisible();
  const before = (await box.boundingBox())!;
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 - 80, before.y + before.height / 2 - 60, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await box.boundingBox())!.x).toBeLessThan(before.x - 40);

  await expect(page.getByTestId('save-state')).toHaveText('Saved');
  const stored = await (await page.request.get(`${base()}/api/replays/${id}/edits`)).json();
  expect(stored.zooms).toHaveLength(1);
  expect(stored.captions.map((caption: { text: string }) => caption.text)).toEqual([
    'Open the page',
    'Click the name field',
    'Click the email field',
    'Tick updates',
  ]);
  expect(stored.speeds).toMatchObject([{ rate: 8 }]);
  expect(stored.blurs).toMatchObject([{ from: 0 }]);
  expect(stored.blurs[0].y).toBeLessThan(0.38);

  // The viewer: captions replace the step captions, the blur box is drawn over the page, the zoom moves the page.
  await page.getByTestId('editor-done').click();
  await expect(page.getByTestId('edited-chip')).toHaveText('Edited');
  await page.keyboard.press('Space');
  await page.goto(`${base()}/r/${id}?t=0.2`);
  await expect(page.getByTestId('edit-caption')).toHaveText('Open the page');
  await expect(page.getByTestId('captions-switch')).toHaveCount(0);
  await expect(page.locator('.player-host .replay-blur')).toBeVisible();
  await page.goto(`${base()}/r/${id}?t=2.1`);
  await expect(page.getByTestId('edit-caption')).toHaveText('Click the email field');
  await expect(page.locator('.player-host .replayer-wrapper')).toHaveAttribute('style', /scale\(/);
  // The speed-up shortens the edited replay.
  const total = await page.getByRole('slider', { name: 'Seek' }).getAttribute('aria-valuetext');
  expect(total).not.toMatch(/of 0:04\.\d/);
});
