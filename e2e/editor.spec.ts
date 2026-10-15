import { expect, type Page, test } from '@playwright/test';

import { serveApp } from './support.ts';

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
  await expect(page.getByTestId('editor-hint')).toContainText('Drag the clip’s edges to trim');
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
  await page.getByTestId('editor-done').click();
  await expect(page).toHaveURL(new RegExp(`/r/${id}$`));
  await expect(page.getByTestId('editor')).toHaveCount(0);
  await expect(page.locator('.editor-dock')).toHaveCount(0);
  await expect(page.getByTestId('replay-player')).toBeVisible();
  const chip = page.getByTestId('edited-chip');
  await expect(chip).toHaveText('Edited');
  const seek = page.getByRole('slider', { name: 'Seek' });
  await expect(seek).toHaveAttribute('aria-valuetext', new RegExp(`of ${editedLength.replace('.', '\\.')}`));
  await chip.click();
  await expect(page.getByRole('menu')).toContainText('Edited by anonymous');
  await page.getByTestId('switch-original').click();
  await expect(chip).toHaveText('Original');
  await expect(page).toHaveURL(/[?&]original=1/);
  await expect(seek).not.toHaveAttribute('aria-valuetext', new RegExp(`of ${editedLength.replace('.', '\\.')}`));
  await chip.click();
  await page.getByTestId('switch-original').click();
  await expect(chip).toHaveText('Edited');
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
  await expect(page.getByTestId('edited-chip')).toHaveText('Edited');
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

test('on a phone the preview shows, nothing scrolls sideways, and a no-op says so in the hint line, not a toast', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const id = await uploadCopy(page, 'editor-phone');
  await page.goto(`${base()}/r/${id}/edit`);
  await expect(page.getByTestId('timeline')).toHaveAttribute('data-ready', 'true');
  const frame = (await page.getByTestId('replay-player').locator('iframe').boundingBox())!;
  expect(frame.width).toBeGreaterThan(300);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  // Every wait cut, W again has nothing to do: a note under the timeline, which then goes.
  await page.locator('body').press('w');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('region-cut').first()).toBeVisible();
  await page.keyboard.press('w');
  await expect(page.getByTestId('editor-hint')).toHaveText('No waits left to cut');
  await expect(page.getByTestId('editor-hint')).toBeVisible();
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
  await expect(page.getByTestId('editor-hint')).toBeHidden({ timeout: 5000 });
  await expect(page.getByTestId('editor-done')).toBeInViewport();
});

test('with the flag on, the server says so and the viewer offers the editor', async ({ page }) => {
  const config = await (await page.request.get(`${base()}/api/config`)).json();
  expect(config.beta).toEqual({ editor: true });
  await page.goto(`${base()}/r/demo-shop`);
  await expect(page.locator('meta[name="app-beta"]')).toHaveAttribute('content', 'editor');
  await expect(page.getByTestId('edit-replay')).toBeVisible();
  expect((await page.request.get(`${base()}/api/replays/demo-shop/edits`)).status()).toBe(200);
});
