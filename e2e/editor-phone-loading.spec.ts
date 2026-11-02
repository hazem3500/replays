import { expect, test, type Page } from '@playwright/test';
import { cloneBundle, openReplay, postBundle, serveApp } from './support.ts';

const server = serveApp({ REPLAYS_BETA_EDITOR: 'true' });
const base = () => server().origin;
test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });

/** Each part of the phone editor: its loading frame's selector, then the loaded editor's. */
const PARTS: Array<[string, string, string]> = [
  ['header', '.sk-phone-header', '.editor-mobile-header'],
  ['title', '.sk-phone-heading h1', '.editor-mobile-heading h1'],
  ['frame', '.sk-frame', '.player-host .replayer-wrapper'],
  ['dock', '.sk-phone-dock', '.editor-dock'],
  ['timeline bar', '.sk-phone-bar', '.phone-timeline-bar'],
  ['play', '.sk-phone-play', '[data-testid="editor-play"]'],
  ['clock', '.sk-phone-clock', '.phone-timeline-bar .editor-clock'],
  ['lanes area', '.sk-phone-lanes', '.phone-lanes-frame'],
  ['scale labels', '.sk-phone-scale > span', '.phone-scale > span'],
  ['lanes', '.sk-phone-lane', '.phone-lane'],
  ['clip', '.sk-phone-clip', '.phone-clip'],
  ['step segments', '.sk-phone-clip > span', '.phone-step'],
  ['regions', '.sk-phone-region', '.phone-region-slot'],
  ['tools', '.sk-phone-tools > span', '.editor-add-toolbar > button'],
];

async function seedEditedReplay(page: Page, id: string) {
  await postBundle(page.request, base(), await cloneBundle(page.request, base(), 'demo-shop', id, 'Phone editor check'));
  const saved = await page.request.put(`${base()}/api/replays/${id}/edits`, {
    headers: { origin: base(), 'if-match': '"e.none"' },
    data: {
      version: 1,
      cuts: [],
      zooms: [{ id: 'zoom-1', from: 500, to: 3000, scale: 1.8 }],
      blurs: [{ id: 'blur-1', from: 2500, to: 5000, x: 0.2, y: 0.2, width: 0.3, height: 0.2 }],
      captions: [{ id: 'caption-1', from: 1000, to: 4000, text: 'Apply the coupon' }],
    },
  });
  expect(saved.ok()).toBe(true);
}

type Rects = Record<string, number[][]>;

/** Rects of every match, so loading and loaded can be compared part by part. */
async function rectsOf(page: Page, which: 1 | 2): Promise<Rects> {
  return page.evaluate(
    ({ parts, column }) =>
      Object.fromEntries(
        parts.map((part) => [
          part[0],
          [...document.querySelectorAll(part[column])].map((element) => {
            const box = element.getBoundingClientRect();
            return [box.left, box.top, box.width, box.height];
          }),
        ]),
      ),
    { parts: PARTS, column: which },
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

/** Flags the desktop editor (its shell or loading frame) if it is ever drawn, however briefly. */
async function watchForDesktopEditor(page: Page) {
  await page.addInitScript(() => {
    new MutationObserver(() => {
      if (document.querySelector('main.editor-shell:not([data-mobile]), [data-testid="editor-skeleton"]:not([data-mobile])'))
        document.documentElement.dataset.desktopEditorSeen = '';
    }).observe(document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-mobile', 'class'],
    });
  });
}

/** Holds the editor's fresh edits request so its loading frame stays up; returns the release. */
async function holdEdits(page: Page) {
  const gate: { open?: () => void } = {};
  const held = new Promise<void>((resolve) => {
    gate.open = resolve;
  });
  await page.route(/\/api\/replays\/[^/]+\/edits$/, async (route) => {
    if (route.request().method() === 'GET') await held;
    await route.continue();
  });
  return () => gate.open?.();
}

test('on a phone the editor loads at the geometry it arrives in, lanes included', async ({ page }) => {
  const id = `phone-loading-${Date.now().toString(36)}`;
  await seedEditedReplay(page, id);
  await watchForDesktopEditor(page);
  await openReplay(page, `${base()}/r/${id}`);
  const release = await holdEdits(page);
  await page.getByTestId('edit-replay').click();
  const skeleton = page.getByTestId('editor-skeleton');
  await expect(skeleton).toBeVisible();
  await expect(skeleton).not.toContainText('Opening editor');
  await expect(skeleton.locator('.sk-phone-lane')).toHaveCount(4);
  const loading = await rectsOf(page, 1);
  release();
  await expect(page.getByTestId('timeline')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('.player-host .replayer-wrapper')).toBeVisible();
  await expect(skeleton).toHaveCount(0);
  const loaded = await rectsOf(page, 2);
  expect(mismatches(loading, loaded)).toEqual([]);
  await expect(page.locator('html[data-desktop-editor-seen]')).toHaveCount(0);
});

test('a phone opening an edit link never draws the desktop editor', async ({ page }) => {
  await watchForDesktopEditor(page);
  await page.goto(`${base()}/r/demo-shop/edit`);
  await expect(page.getByTestId('timeline')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByTestId('editor')).toHaveAttribute('data-mobile');
  await expect(page.locator('html[data-desktop-editor-seen]')).toHaveCount(0);
});
