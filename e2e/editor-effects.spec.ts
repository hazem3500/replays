import { expect, type Page, test } from '@playwright/test';

import { serveApp } from './support.ts';

// Edit mode's effect lanes: Z zooms in on the clicks, T makes captions from the steps, a drag on the Speed lane speeds
// a stretch up, B adds a blur box that is dragged into place on the preview. The viewer then plays them: the page
// zooms, the box blurs, the caption shows, and the sped-up stretch shortens the replay.

// The beta editor is off by default: this file's own server turns it on.
const server = serveApp({ REPLAYS_BETA_EDITOR: 'true' });
const base = () => server().origin;

async function uploadHuman(page: Page, denseCaptions = false) {
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
  if (denseCaptions)
    bundle.steps = Array.from({ length: 30 }, (_, index) => ({
      at: index * 100,
      kind: 'click',
      label: `Caption ${index + 1}: complete text remains available for editing`,
    }));
  expect((await page.request.post(`${base()}/api/replays`, { data: bundle })).status()).toBe(201);
  return id;
}

test('effects: zoom on clicks, captions from steps, a speed-up and a blur box apply in the viewer', async ({ page }) => {
  test.setTimeout(45_000);
  const id = await uploadHuman(page);
  await page.goto(`${base()}/r/${id}/edit`);
  await expect(page.getByTestId('timeline')).toHaveAttribute('data-ready', 'true');
  // Start with only the recording track. Adding an effect reveals its track automatically.
  for (const lane of ['zoom', 'speed', 'blur', 'caption']) await expect(page.getByTestId(`lane-${lane}`)).toHaveCount(0);

  await page.locator('body').press('z');
  await expect(page.getByTestId('region-zoom')).toHaveCount(1);
  await expect(page.getByTestId('lane-zoom').locator('.tl-lane-empty')).toHaveCount(0);
  // Clicking a zoom shows it zoomed: the playhead lands past its ease-in, and the inspector shows its properties.
  await page.getByTestId('region-zoom').locator('.tl-region-body').click();
  await expect(page.locator('.player-host .replayer-wrapper')).toHaveAttribute('style', /scale\((?!1\))/);
  const inspector = page.getByRole('complementary', { name: 'Inspector' });
  await expect(inspector.getByRole('heading', { name: 'Zoom' })).toBeVisible();
  await expect(inspector.getByRole('slider', { name: 'Zoom level' })).toBeVisible();
  await inspector.getByRole('button', { name: 'Set zoom to 2.2×' }).click();
  await expect(inspector.getByRole('button', { name: 'Set zoom to 2.2×' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(inspector).toHaveCount(0);
  await expect(page.locator('#cursor-inspector')).toHaveCount(0);
  // Back to 0:00 from the ruler's start.
  const rulerTrack = page.getByTestId('timeline-ruler');
  await rulerTrack.scrollIntoViewIfNeeded();
  await expect(rulerTrack).toBeInViewport({ ratio: 1 });
  const ruler = (await rulerTrack.boundingBox())!;
  await page.mouse.click(ruler.x + 2, ruler.y + ruler.height / 2);
  await expect(page.getByTestId('editor-clock')).toHaveText('0:00.0');
  await page.keyboard.press('t');
  await expect(page.getByTestId('region-caption')).toHaveCount(4);

  // Empty tracks remain available for precise range drawing, without crowding the default editor.
  await page.getByTestId('add-effect').click();
  await page.getByTestId('show-empty-tracks').click();
  await expect(page.getByTestId('add-effect')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.getByTestId('lane-speed')).toContainText('Speed · drag');
  // A speed-up dragged out on its lane, then set to 8× from the control row.
  const speedTrack = page.getByTestId('lane-speed');
  await speedTrack.scrollIntoViewIfNeeded();
  await expect(speedTrack).toBeInViewport({ ratio: 1 });
  const lane = (await speedTrack.boundingBox())!;
  const y = lane.y + lane.height / 2;
  await page.mouse.move(lane.x + lane.width * 0.55, y);
  await page.mouse.down();
  await page.mouse.move(lane.x + lane.width * 0.75, y, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByTestId('region-speed')).toHaveCount(1);
  await inspector.getByRole('radio', { name: '8× faster' }).click();
  await expect(page.getByTestId('region-speed')).toContainText('8×');

  // A blur box at the playhead (0:00), dragged on the preview.
  await page.keyboard.press('Escape');
  await page.keyboard.press('b');
  await expect(page.getByTestId('blur-box')).toHaveCount(0);
  await expect(page.getByText('Drag over the area to blur, or click an element to cover it', { exact: true })).toBeVisible();
  const frame = (await page.getByTestId('blur-overlay').boundingBox())!;
  await page.mouse.move(frame.x + frame.width * 0.35, frame.y + frame.height * 0.38);
  await page.mouse.down();
  await page.mouse.move(frame.x + frame.width * 0.65, frame.y + frame.height * 0.52, { steps: 5 });
  await page.mouse.up();
  const box = page.getByTestId('blur-box');
  await expect(box).toBeVisible();
  await expect(page.getByTestId('lane-blur')).toBeInViewport({ ratio: 1 });
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
  await page.getByRole('link', { name: 'Back to the replay' }).click();
  await expect(page.getByTestId('edited-chip')).toContainText('Edited');
  await page.keyboard.press('Space');
  await page.goto(`${base()}/r/${id}?t=0.2`);
  await expect(page.getByTestId('edit-caption')).toHaveText('Open the page');
  await expect(page.getByTestId('captions-switch')).toHaveAccessibleName('Hide captions');
  await expect(page.locator('.player-host .replay-blur')).toBeVisible();
  await page.goto(`${base()}/r/${id}?t=2.1`);
  await expect(page.getByTestId('edit-caption')).toHaveText('Click the email field');
  await expect(page.locator('.player-host .replayer-wrapper')).toHaveAttribute('style', /scale\(/);
  // The speed-up shortens the edited replay.
  const total = await page.getByRole('slider', { name: 'Seek' }).getAttribute('aria-valuetext');
  expect(total).not.toMatch(/of 0:04\.\d/);
});

test('dense captions keep every edit without overlapping labels or truncating the selected text', async ({ page }) => {
  const id = await uploadHuman(page, true);
  await page.goto(`${base()}/r/${id}/edit`);
  await expect(page.getByTestId('timeline')).toHaveAttribute('data-ready', 'true');
  await page.locator('body').press('t');
  const captions = page.getByTestId('region-caption');
  await expect(captions).toHaveCount(30);
  const first = captions.first();
  await first.scrollIntoViewIfNeeded();
  await expect(first.locator('.tl-region-label')).toHaveCount(0);
  const boxes = await captions.evaluateAll((nodes) =>
    nodes.map((node) => {
      const box = node.getBoundingClientRect();
      return { left: box.left, right: box.right };
    }),
  );
  for (let index = 1; index < boxes.length; index++) expect(boxes[index]!.left).toBeGreaterThanOrEqual(boxes[index - 1]!.right);
  await first.locator('.tl-region-body').click();
  await expect(page.getByTestId('caption-text')).toHaveValue('Caption 1: complete text remains available for editing');
  await expect(page.getByTestId('save-state')).toHaveText('Saved');
  const stored = await (await page.request.get(`${base()}/api/replays/${id}/edits`)).json();
  expect(stored.captions).toHaveLength(30);
});

test('blur: a click covers the recorded element under it, and Redact saves a solid block for the viewer', async ({ page }) => {
  const id = await uploadHuman(page);
  await page.goto(`${base()}/r/${id}/edit`);
  await expect(page.getByTestId('timeline')).toHaveAttribute('data-ready', 'true');
  await page.locator('body').press('b');
  const frame = (await page.getByTestId('blur-overlay').boundingBox())!;
  await page.mouse.click(frame.x + frame.width * 0.5, frame.y + frame.height * 0.12);
  const box = page.getByTestId('blur-box');
  await expect(box).toBeVisible();
  const covered = (await box.boundingBox())!;
  expect(covered.width).toBeLessThan(frame.width * 0.95);
  const inspector = page.getByRole('complementary', { name: 'Inspector' });
  await inspector.getByRole('radio', { name: 'Redact' }).click();
  await expect(page.getByTestId('region-blur')).toContainText('Redact');
  await expect(page.getByTestId('save-state')).toHaveText('Saved');
  const stored = await (await page.request.get(`${base()}/api/replays/${id}/edits`)).json();
  expect(stored.blurs).toHaveLength(1);
  expect(stored.blurs[0].style).toBe('redact');
  await page.goto(`${base()}/r/${id}?t=0.5`);
  await expect(page.locator('.player-host .replay-blur[data-style="redact"]')).toBeVisible();
});
