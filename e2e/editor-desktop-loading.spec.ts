import { expect, test, type Page } from '@playwright/test';
import { cloneBundle, openReplay, postBundle, serveApp } from './support.ts';

const server = serveApp({ REPLAYS_BETA_EDITOR: 'true' });
const base = () => server().origin;
test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });

/** Each part of the desktop dock: its rects are read inside the loading frame, then inside the loaded editor. */
const PARTS: Array<[string, string]> = [
  ['dock', '.editor-dock'],
  ['bar', '.editor-bar'],
  ['timecode', '.editor-time'],
  ['tool group', '.editor-bar-tools'],
  ['tools', '.editor-bar-tools > button'],
  ['after edits', '.editor-bar-end .editor-durations-note'],
  ['ruler', '.tl-ruler'],
  ['tick labels', '.tl-tick-label'],
  ['dots', '.tl-step'],
  ['lanes', '.tl-lane'],
  ['clip', '.tl-clip'],
  ['clip steps', '.tl-clip-step'],
  ['blocks', '.tl-region'],
  ['playhead', '.tl-playhead'],
];

async function seedEditedReplay(page: Page, id: string) {
  await postBundle(page.request, base(), await cloneBundle(page.request, base(), 'demo-shop', id, 'Desktop editor check'));
  const saved = await page.request.put(`${base()}/api/replays/${id}/edits`, {
    headers: { origin: base(), 'if-match': '"e.none"' },
    data: {
      version: 1,
      cuts: [{ id: 'cut-1', from: 3200, to: 3800 }],
      zooms: [{ id: 'zoom-1', from: 500, to: 3000, scale: 1.8 }],
      blurs: [{ id: 'blur-1', from: 2500, to: 5000, x: 0.2, y: 0.2, width: 0.3, height: 0.2 }],
      captions: [{ id: 'caption-1', from: 1000, to: 4000, text: 'Apply the coupon' }],
    },
  });
  expect(saved.ok()).toBe(true);
}

type Rects = Record<string, number[][]>;

/** Rects of every match of each part inside `root`, so loading and loaded can be compared part by part. */
async function rectsOf(page: Page, root: string): Promise<Rects> {
  return page.evaluate(
    ({ parts, scope }) =>
      Object.fromEntries(
        parts.map(([part, selector]) => [
          part,
          [...document.querySelectorAll(`${scope} ${selector}`)].map((element) => {
            const box = element.getBoundingClientRect();
            return [box.left, box.top, box.width, box.height];
          }),
        ]),
      ),
    { parts: PARTS, scope: root },
  );
}

/** Every part whose loading rects differ from the loaded ones by more than a pixel, or whose count differs. */
function mismatches(loading: Rects, loaded: Rects) {
  return PARTS.flatMap(([part]) => {
    const before = loading[part] ?? [];
    const after = loaded[part] ?? [];
    if (before.length !== after.length) return [`${part}: ${before.length} loading, ${after.length} loaded`];
    return after.flatMap((rect, index) => {
      const was = before[index] ?? [];
      return rect.some((edge, side) => Math.abs((was[side] ?? Number.POSITIVE_INFINITY) - edge) > 1)
        ? [`${part} ${index}: ${was.join(',')} then ${rect.join(',')}`]
        : [];
    });
  });
}

test('the desktop dock loads at the rects it arrives in: tools, ruler, clip and lanes', async ({ page }) => {
  const id = `desktop-loading-${Date.now().toString(36)}`;
  await seedEditedReplay(page, id);
  await openReplay(page, `${base()}/r/${id}`);
  const gate: { open?: () => void } = {};
  const held = new Promise<void>((resolve) => {
    gate.open = resolve;
  });
  await page.route(/\/api\/replays\/[^/]+\/edits$/, async (route) => {
    if (route.request().method() === 'GET') await held;
    await route.continue();
  });
  await page.getByTestId('edit-replay').click();
  const skeleton = page.getByTestId('editor-skeleton');
  await expect(skeleton).toBeVisible();
  await expect(skeleton.locator('.tl-lane')).toHaveCount(4);
  await expect(skeleton.locator('.editor-bar-tools > button')).toHaveText([/Cut/, /Waits/, /Highlight/, /Add/]);
  await expect(skeleton.locator('.editor-time')).toHaveText(/^0:00\.0 \/ \d+:\d\d\.\d$/);
  await expect(skeleton.locator('.editor-durations-note')).toHaveText('after edits');
  const loading = await rectsOf(page, '[data-testid="editor-skeleton"]');
  gate.open?.();
  await expect(page.getByTestId('timeline')).toHaveAttribute('data-ready', 'true');
  await expect(skeleton).toHaveCount(0);
  const loaded = await rectsOf(page, '[data-testid="editor"]');
  expect(mismatches(loading, loaded)).toEqual([]);
});
