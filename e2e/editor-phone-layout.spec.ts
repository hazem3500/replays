import { expect, test, type Page } from '@playwright/test';

import { boxOf, cloneBundle, postBundle, serveApp } from './support.ts';

const server = serveApp({ REPLAYS_BETA_EDITOR: 'true' });
const base = () => server().origin;
test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });

/** A replay trimmed to 1 s … 5 s with a zoom, open in the phone editor. */
async function openTrimmed(page: Page) {
  const id = `phone-layout-${Date.now().toString(36)}`;
  await postBundle(page.request, base(), await cloneBundle(page.request, base(), 'demo-shop', id, 'Phone layout check'));
  const saved = await page.request.put(`${base()}/api/replays/${id}/edits`, {
    headers: { origin: base(), 'if-match': '"e.none"' },
    data: { version: 1, cuts: [], trim: { start: 1000, end: 5000 }, zooms: [{ id: 'zoom-1', from: 1500, to: 3000, scale: 1.8 }] },
  });
  expect(saved.ok()).toBe(true);
  await page.goto(`${base()}/r/${id}/edit`);
  await expect(page.getByTestId('timeline')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('.player-host .replayer-wrapper')).toBeVisible();
}

test('the stage is the recording at the screen width, with no letterbox above or below it', async ({ page }) => {
  await openTrimmed(page);
  const stage = await boxOf(page.locator('.editor-stage'));
  // invariant: the recorded frame is sized to the recording's own aspect, so filling the stage both ways means none.
  const frame = await boxOf(page.locator('.player-host .replayer-wrapper'));
  expect(Math.abs(frame.width - 390)).toBeLessThanOrEqual(1);
  expect(Math.abs(stage.height - frame.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(stage.y - frame.y)).toBeLessThanOrEqual(1);
});

test('the timeline shows one time readout: the edited position over the edited length', async ({ page }) => {
  await openTrimmed(page);
  const bar = page.locator('.phone-timeline-bar');
  await expect(bar.getByTestId('phone-readout')).toHaveText('0:00.0/ 0:04.0');
  await expect(bar.getByTestId('phone-readout')).toHaveAttribute('title', /recorded$/);
  await expect(bar.getByTestId('durations')).toHaveCount(0);
  expect((await bar.innerText()).match(/\d:\d\d\.\d/g)).toHaveLength(2);
});

test('every lane and the time scale share one full-width time axis', async ({ page }) => {
  await openTrimmed(page);
  const track = await boxOf(page.locator('.phone-track'));
  const lanes = await page.locator('.phone-lane').evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return { left: rect.left, right: rect.right };
    }),
  );
  expect(lanes.length).toBeGreaterThanOrEqual(2);
  for (const lane of lanes) {
    expect(Math.abs(lane.left - track.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(lane.right - (track.x + track.width))).toBeLessThanOrEqual(1);
  }
  const frame = await boxOf(page.locator('.phone-lanes-frame'));
  expect(frame.x).toBe(0);
  expect(frame.width).toBe(390);
});

test('the toolbar sits on the bottom edge: the safe area is padded once, by the shell', async ({ page }) => {
  await openTrimmed(page);
  const toolbar = await boxOf(page.locator('.editor-add-toolbar'));
  expect(Math.abs(toolbar.y + toolbar.height - 844)).toBeLessThanOrEqual(1);
  await expect(page.locator('.editor-dock')).toHaveCSS('padding-bottom', '0px');
  const playhead = await boxOf(page.getByTestId('phone-playhead'));
  expect(playhead.y + playhead.height).toBeLessThanOrEqual(toolbar.y);
});

test('the top bar is one line: the title with its save state, and a compact Export', async ({ page }) => {
  await openTrimmed(page);
  const header = await boxOf(page.locator('.editor-mobile-header'));
  expect(header.height).toBeLessThanOrEqual(50);
  const title = await boxOf(page.locator('.editor-mobile-heading h1'));
  const state = await boxOf(page.getByTestId('save-state'));
  expect(Math.abs(title.y + title.height / 2 - (state.y + state.height / 2))).toBeLessThanOrEqual(2);
  await expect(page.getByTestId('save-state')).toHaveText('Saved');
  expect((await boxOf(page.getByTestId('editor-export'))).height).toBe(32);
});
