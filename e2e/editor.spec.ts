import { expect, type Page, test } from '@playwright/test';

import { boxOf, serveApp } from './support.ts';
import { editListOf, editsVersion } from '../src/shared/edits.ts';

// Edit mode (/r/<id>/edit), reached from the viewer's top-bar Edit button: "Remove waits" suggestions applied with
// Enter, a range dragged on the clip and cut with C, undo/redo, a trim edge moved by keyboard, autosave that records
// the editor; Done (and browser Back) return to the viewer, which plays the edits and shows the quiet "Edited" label.

// The beta editor is off by default: this file's own server turns it on.
const server = serveApp({ REPLAYS_BETA_EDITOR: 'true' });
const base = () => server().origin;

/** A copy of the sample without its click step, so its first wait runs on long enough for "Remove waits" to cut. */
async function uploadCopy(page: Page, name: string) {
  const id = `${name}-${Date.now().toString(36)}`;
  const bundle = await (await page.request.get(`${base()}/api/replays/demo-shop`)).json();
  bundle.meta.id = id;
  bundle.meta.title = 'Editor check';
  bundle.steps = bundle.steps.filter((step: { kind: string }) => step.kind !== 'click');
  expect((await page.request.post(`${base()}/api/replays`, { data: bundle })).status()).toBe(201);
  return id;
}

async function openEditor(page: Page, id: string) {
  await page.goto(`${base()}/r/${id}`);
  await expect(page.getByTestId('replay-player').locator('iframe')).toBeAttached();
  await page.getByTestId('edit-replay').click();
  await expect(page).toHaveURL(new RegExp(`/r/${id}/edit$`));
  await expect(page.getByTestId('timeline')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByTestId('replay-player').locator('iframe')).toBeAttached();
}

/** Drags across the clip lane from `from` to `to` (fractions of its width). */
async function dragOnClip(page: Page, from: number, to: number) {
  const box = (await page.getByTestId('lane-clip').boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * from, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * to, y, { steps: 5 });
  await page.mouse.up();
}

test('desktop editor fills the viewport and keeps timeline regions still across interaction states', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const id = await uploadCopy(page, 'editor-layout');
  await openEditor(page, id);
  const panel = page.getByRole('complementary', { name: 'Inspector' });
  await expect(panel).toHaveCount(0);
  await page.locator('body').press('t');
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Caption', exact: true })).toBeVisible();
  const frame = page.locator('.editor-stage > .stage-wrap');
  await expect(frame).toHaveCSS('box-shadow', 'none');
  await expect(frame).toHaveCSS('border-radius', '0px');
  const frameBox = await boxOf(frame);
  const panelBox = await boxOf(panel);
  expect(frameBox.width).toBeGreaterThan(500);
  expect(frameBox.x + frameBox.width).toBeLessThanOrEqual(panelBox.x + 1);
  const dock = page.getByRole('region', { name: 'Timeline', exact: true });
  const dockBox = await boxOf(dock);
  expect(Math.abs(dockBox.y + dockBox.height - 800)).toBeLessThanOrEqual(1);

  const splitter = page.getByRole('separator', { name: 'Resize timeline' });
  await splitter.focus();
  // why: the dock already grows to hold its lanes, so the first presses may only catch up with that height.
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect.poll(async () => (await boxOf(dock)).height).toBeGreaterThan(dockBox.height);
  const grown = (await boxOf(dock)).height;
  await page.keyboard.press('ArrowUp');
  await expect.poll(async () => (await boxOf(dock)).height).toBeCloseTo(grown + 24, 0);
  const region = page.getByTestId('region-caption').first();
  const body = region.locator('.tl-region-body');
  await body.scrollIntoViewIfNeeded();
  const geometry = () =>
    body.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return { width: box.width, height: box.height, padding: style.padding, transform: style.transform, scale: style.scale };
    });
  const resting = await geometry();
  await body.hover();
  expect(await geometry()).toEqual(resting);
  await body.click();
  expect(await geometry()).toEqual(resting);
  await expect(body).toHaveAttribute('aria-pressed', 'true');

  const play = page.getByTestId('editor-play');
  await play.hover();
  await page.mouse.down();
  // why: an unset scale (none) and scale 1 both mean the press leaves the button at its size.
  expect(['1', 'none']).toContain(await play.evaluate((element) => getComputedStyle(element).scale));
  await expect(play).toHaveCSS('transform', 'none');
  await page.mouse.up();
  await play.click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(body).toHaveCSS('transition-duration', '0s');
  await expect(play).toHaveCSS('transition-duration', '0s');
});

test('edit mode: remove waits, cut a range, undo, trim; Done plays the edits with the Edited label', async ({ page }) => {
  test.setTimeout(45_000);
  const id = await uploadCopy(page, 'editor-e2e');

  // The entry is the first item of the top bar's actions, not a menu item.
  await page.goto(`${base()}/r/${id}`);
  await expect(page.getByTestId('edited-chip')).toHaveCount(0);
  await page.getByRole('button', { name: 'More actions' }).click();
  await expect(page.getByRole('menu')).not.toContainText('Edit');
  await page.keyboard.press('Escape');
  await openEditor(page, id);
  await expect(page.getByTestId('save-state')).toHaveText('Not edited yet');
  await expect(page.getByTestId('editor-hint')).toHaveCount(0);
  await expect(page.getByTestId('editor-operation-status')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Back to the replay' })).toHaveAttribute('href', new RegExp(`/r/${id}$`));

  // Remove waits: suggested first, applied with Enter (the demo recording has more than one wait to cut).
  await page.locator('body').press('w');
  const waits = await page.getByTestId('wait-suggestion').count();
  expect(waits).toBeGreaterThan(0);
  await expect(page.getByTestId('wait-suggestions')).toContainText(`${waits} wait${waits === 1 ? '' : 's'} found`);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('wait-suggestion')).toHaveCount(0);
  await expect(page.getByTestId('region-cut')).toHaveCount(waits);
  const regionIds = () =>
    page.locator('[data-region-id]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-region-id')!));
  const waitIds = await regionIds();

  // A range dragged on the clip, cut with C; undone, redone, then removed with Backspace.
  await dragOnClip(page, 0.08, 0.2);
  await expect(page.getByTestId('range-selection')).toBeVisible();
  await page.keyboard.press('c');
  await expect(page.getByTestId('region-cut')).toHaveCount(waits + 1);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByTestId('region-cut')).toHaveCount(waits);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(page.getByTestId('region-cut')).toHaveCount(waits + 1);
  // A selected cut is removed with Backspace.
  await page.locator(`[data-region-id="${waitIds[0]}"] .tl-region-body`).click();
  await page.keyboard.press('Backspace');
  await expect(page.getByTestId('region-cut')).toHaveCount(waits);

  // The trim end, one second earlier from its edge.
  const lengthBefore = await page.getByTestId('edited-length').innerText();
  await page.getByTestId('trim-end').focus();
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(page.getByTestId('edited-length')).not.toHaveText(lengthBefore);
  const editedLength = await page.getByTestId('edited-length').innerText();

  // Autosave, quietly.
  await expect(page.getByTestId('save-state')).toHaveText('Saved');
  const stored = await (await page.request.get(`${base()}/api/replays/${id}/edits`)).json();
  expect(stored).toMatchObject({ version: 1, updatedBy: 'anonymous' });
  expect(stored.cuts).toHaveLength(waits);
  expect(stored.cuts[0]).toMatchObject({ id: expect.any(String), from: expect.any(Number), to: expect.any(Number) });
  expect(stored.trim.start).toBe(0);

  // Done: back to the viewer, which shows (and plays) the edited replay with its quiet label.
  await page.getByRole('link', { name: 'Back to the replay' }).click();
  await expect(page).toHaveURL(new RegExp(`/r/${id}$`));
  await expect(page.getByTestId('editor')).toHaveCount(0);
  await expect(page.locator('.editor-dock')).toHaveCount(0);
  await expect(page.getByTestId('replay-player')).toBeVisible();
  const chip = page.getByTestId('edited-chip');
  await expect(chip).toContainText('Edited');
  const seek = page.getByRole('slider', { name: 'Seek' });
  await expect(seek).toHaveAttribute('aria-valuetext', new RegExp(`of ${editedLength.replace('.', '\\.')}`));
  await chip.click();
  await expect(page.getByRole('menu')).toContainText('Edited by anonymous');
  await page.getByTestId('switch-original').click();
  await expect(chip).toContainText('Original recording');
  await expect(page).toHaveURL(/[?&]original=1/);
  await expect(seek).not.toHaveAttribute('aria-valuetext', new RegExp(`of ${editedLength.replace('.', '\\.')}`));
  await chip.click();
  await page.getByTestId('switch-original').click();
  await expect(chip).toContainText('Edited');
  await expect(page).not.toHaveURL(/original=1/);
});

test('browser Back from edit mode saves the change and returns to the edited viewer', async ({ page }) => {
  const id = await uploadCopy(page, 'editor-back');
  await openEditor(page, id);
  await page.locator('body').press('c');
  await expect(page.getByTestId('region-cut')).toHaveCount(1);
  // At once, before the autosave's quiet moment has passed.
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/r/${id}$`));
  await expect(page.getByTestId('editor')).toHaveCount(0);
  await expect(page.getByTestId('replay-player')).toBeVisible();
  await expect(page.getByTestId('edited-chip')).toContainText('Edited');
  await expect.poll(async () => (await (await page.request.get(`${base()}/api/replays/${id}/edits`)).json()).cuts.length).toBe(1);
});

test('a server without the edits API reads as a quiet detail, not an error headline', async ({ page }) => {
  const id = await uploadCopy(page, 'editor-404');
  await page.route(`**/api/replays/${id}/edits`, (route) =>
    route.request().method() === 'PUT' ? route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' }) : route.fallback(),
  );
  await openEditor(page, id);
  await page.locator('body').press('c');
  await expect(page.getByTestId('save-state')).toHaveText('Editing isn’t available on this server');
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
});

test('a save over newer edits is refused with the current list', async ({ page }) => {
  const id = await uploadCopy(page, 'editor-409');
  const url = `${base()}/api/replays/${id}/edits`;
  const first = await page.request.get(url);
  const etag = first.headers().etag!;
  const body = { version: 1, cuts: [{ id: 'cut-1', from: 1000, to: 2000 }] };
  expect((await page.request.put(url, { data: body, headers: { 'if-match': etag } })).status()).toBe(200);
  const stale = await page.request.put(url, {
    data: { version: 1, cuts: [], trim: { start: 0, end: 2000 } },
    headers: { 'if-match': etag },
  });
  expect(stale.status()).toBe(409);
  expect(await stale.json()).toMatchObject({ current: { revision: 1, cuts: [{ id: 'cut-1' }] } });
});

test('on a phone the preview fits and a no-op shows a temporary accessible operation result', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const id = await uploadCopy(page, 'editor-phone');
  await page.goto(`${base()}/r/${id}/edit`);
  await expect(page.getByTestId('timeline')).toHaveAttribute('data-ready', 'true');
  const frame = (await page.getByTestId('replay-player').locator('iframe').boundingBox())!;
  expect(frame.width).toBeGreaterThan(300);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  // why: removing the standing hint must preserve feedback when an operation has nothing left to change.
  await page.locator('body').press('w');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('region-cut').first()).toBeVisible();
  await page.keyboard.press('w');
  await expect(page.getByTestId('editor-operation-status')).toHaveText('No waits left to cut');
  await expect(page.getByTestId('editor-operation-status')).toBeVisible();
  await expect(page.getByTestId('editor-operation-announcement')).toHaveText('No waits left to cut');
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
  await expect(page.getByTestId('editor-operation-status')).toHaveCount(0, { timeout: 5000 });
  await expect(page.getByRole('button', { name: 'Back to the replay' })).toBeInViewport();
});

test('with the flag on, the server says so and the viewer offers the editor', async ({ page }) => {
  const config = await (await page.request.get(`${base()}/api/config`)).json();
  expect(config.beta).toEqual({ editor: true, cursorCustomization: false, malleable: false });
  await page.goto(`${base()}/r/demo-shop/edit`);
  await expect(page.getByTestId('timeline')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('#cursor-inspector')).toHaveCount(0);
  await page.goto(`${base()}/r/demo-shop`);
  await expect(page.locator('meta[name="app-beta"]')).toHaveAttribute('content', 'editor');
  await expect(page.getByTestId('edit-replay')).toBeVisible();
  expect((await page.request.get(`${base()}/api/replays/demo-shop/edits`)).status()).toBe(200);
});

test('editor entry has a stable stage and timeline skeleton, without a viewer inspector', async ({ page }) => {
  const id = await uploadCopy(page, 'editor-loading');
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/replays/${id}`, async (route) => {
    await gate;
    await route.continue();
  });
  const meta = (await (await page.request.get(`${base()}/api/replays/${id}`)).json()).meta;
  // why: opening from the viewer leaves the recording's size as a hint (navigation.ts); the skeleton fits the frame to it.
  await page.addInitScript((hint) => sessionStorage.setItem('replays-open-hint', JSON.stringify(hint)), {
    id,
    title: meta.title,
    viewport: meta.viewport,
  });
  await page.goto(`${base()}/r/${id}/edit`);
  const skeleton = page.getByTestId('editor-skeleton');
  await expect(skeleton).toBeVisible();
  await expect(skeleton.getByRole('heading', { level: 1 })).toContainText(meta.title);
  await expect(skeleton.getByTestId('inspector-skeleton')).toHaveCount(0);
  await expect(skeleton.locator('.tl-gutter svg')).toHaveCount(1);
  await expect(skeleton.locator('.loading-notice')).toHaveCount(0);
  await expect(skeleton.locator('.sk-steps, .sk-table-head, .sk-tabs')).toHaveCount(0);
  const loading = await editorRects(page, '.sk-frame');
  release();
  await expect(page.getByTestId('timeline')).toHaveAttribute('data-ready', 'true');
  await expect(skeleton).toHaveCount(0);
  const loaded = await editorRects(page, '.player-host .replayer-wrapper');
  for (const part of Object.keys(loaded) as Array<keyof typeof loaded>) {
    for (const edge of ['x', 'y', 'width', 'height'] as const)
      expect(Math.abs(loading[part][edge] - loaded[part][edge]), `${part} ${edge}`).toBeLessThanOrEqual(2);
  }
});

/** Where the editor's regions and the recording's frame sit, so loading can be compared with loaded. */
async function editorRects(page: Page, frame: string) {
  const rect = async (selector: string) => {
    const box = (await page.locator(selector).first().boundingBox())!;
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  };
  return {
    stage: await rect('.editor-stage'),
    dock: await rect('.editor-dock'),
    frame: await rect(frame),
  };
}

test('the waits tool shows its key, and ? opens the editor shortcuts', async ({ page }) => {
  const id = await uploadCopy(page, 'editor-shortcuts');
  await page.goto(`${base()}/r/${id}/edit`);
  await expect(page.getByTestId('timeline')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByTestId('remove-waits').locator('.editor-key')).toHaveText('W');
  await page.locator('body').press('?');
  const sheet = page.getByTestId('shortcut-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText('Zoom in on every click')).toBeVisible();
  await expect(sheet.getByText('Trim start / end to the playhead')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
});

test('a ruler with half-second ticks labels every tick with one decimal', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  const id = await uploadCopy(page, 'editor-ruler');
  await page.goto(`${base()}/r/${id}/edit`);
  await expect(page.getByTestId('timeline')).toHaveAttribute('data-ready', 'true');
  const labels = page.getByTestId('timeline-ruler').locator('.tl-tick-label');
  await expect(labels.nth(1)).toHaveText('0:00.5');
  expect((await labels.allTextContents()).filter((text) => !/^\d+:\d{2}\.\d$/.test(text))).toEqual([]);
});

test('export uses the saved edit revision; viewing original preserves edits', async ({ page }) => {
  const id = await uploadCopy(page, 'editor-export');
  let exported: Record<string, unknown> | undefined;
  await page.route(`**/api/replays/${id}/render**`, async (route) => {
    const request = route.request();
    if (request.method() === 'POST') exported = request.postDataJSON();
    await route.fulfill({ json: { status: exported && request.method() !== 'DELETE' ? 'queued' : 'none' } });
  });
  await page.goto(`${base()}/r/${id}/edit`);
  await expect(page.getByTestId('timeline')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByRole('link', { name: 'Back to the replay' })).toBeVisible();
  await page.locator('body').press('c');
  await expect(page.getByTestId('save-state')).toHaveText('Saved');
  const saved = await (await page.request.get(`${base()}/api/replays/${id}/edits`)).json();
  await page.getByTestId('editor-export').click();
  await expect.poll(() => exported).toEqual({ speed: 1, skipInactive: false, captions: false, edits: editsVersion(editListOf(saved)) });
  await page.getByTestId('editor-export-status').getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByTestId('editor-view-original').click();
  await expect(page).toHaveURL(new RegExp(`/r/${id}\\?original=1$`));
  await expect(page.getByTestId('edited-chip')).toContainText('Original recording');
  const after = await (await page.request.get(`${base()}/api/replays/${id}/edits`)).json();
  expect(after).toEqual(saved);
});
