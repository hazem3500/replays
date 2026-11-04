import { expect, type Locator, type Page, test } from '@playwright/test';

import { createSuite, gotoHydrated, origin, uniqueId } from './support.ts';
import { routePosters } from './transition-frames.ts';

type Layout = 'List' | 'Grid';
interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
interface StackSample {
  /** The front poster's width on screen, which the layout morph grows or shrinks. */
  width: number;
  /** Each shown rear sheet's edges minus the front poster's, nearest sheet first. */
  offsets: Box[];
}

declare global {
  interface Window {
    stackFreeze?: { ready: boolean; seek: (ms: number) => void; release: () => void };
  }
}

const SHEETS = ':is(.card-back, .stack-layer):not([data-stack-reserve]):not(.suite-sheet-outgoing *)';

async function suiteRow(page: Page, runs: number) {
  const suiteId = uniqueId(`stack-${runs}`);
  await createSuite(
    page.request,
    origin(),
    suiteId,
    Array.from({ length: runs }, (_, index) => ({
      id: `run-${index}`,
      label: `Browser ${index + 1}`,
      status: 'passed' as const,
      replayId: `${suiteId}-${index}`,
    })),
  );
  await routePosters(page, suiteId);
  return suiteId;
}

async function library(page: Page, layout: Layout) {
  await gotoHydrated(page, origin());
  const control = page.getByRole('group', { name: 'Layout', exact: true });
  await switchTo(page, control, layout);
  return control;
}

async function switchTo(page: Page, control: Locator, layout: Layout) {
  await control.getByRole('button', { name: layout, exact: true }).click();
  await expect(page.locator('.feed-list').first()).toHaveAttribute('data-view', layout.toLowerCase());
  await expect(page.locator('html')).not.toHaveAttribute('data-feed-transition', /.+/);
}

/** Holds the next view transition still once Motion has started it, so frames can be sampled at exact times. */
function holdNextTransition() {
  const start = document.startViewTransition.bind(document);
  document.startViewTransition = (update) => {
    document.startViewTransition = start;
    const transition = start(update);
    const wait = () => {
      const all = document
        .getAnimations()
        .filter(
          (animation) => animation.effect instanceof KeyframeEffect && animation.effect.pseudoElement?.startsWith('::view-transition'),
        );
      if (!all.some((animation) => animation.playState === 'running')) {
        requestAnimationFrame(wait);
        return;
      }
      for (const animation of all) animation.pause();
      window.stackFreeze = {
        ready: true,
        seek: (ms) => {
          for (const animation of all) animation.currentTime = ms;
        },
        release: () => {
          for (const animation of all) animation.play();
        },
      };
    };
    void transition.ready.then(() => requestAnimationFrame(wait));
    return transition;
  };
}

/** The front poster and rear sheets of one suite as laid out right now (the page's live, final geometry). */
function restStack(entryId: string): StackSample {
  const item = document.querySelector<HTMLElement>(`[data-entry-id="${entryId}"]`);
  if (!item) throw new Error(`no feed entry ${entryId}`);
  const poster = item.querySelector<HTMLElement>(':is(.stack-front, .shuffle-window) > .poster:not(.poster-outgoing)');
  if (!poster) throw new Error(`no front poster in ${entryId}`);
  const front = poster.getBoundingClientRect();
  const sheets = [...item.querySelectorAll<HTMLElement>(':is(.card-back, .stack-layer):not([data-stack-reserve])')]
    .filter((sheet) => !sheet.closest('.suite-sheet-outgoing'))
    .sort((a, b) => Number(a.dataset.stackDepth) - Number(b.dataset.stackDepth));
  // why: subpixel layout differs in the last float digits between otherwise identical stacks.
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- why: page.evaluate runs this alone, without the module scope.
  const round = (value: number) => Math.round(value * 10) / 10;
  return {
    width: front.width,
    offsets: sheets.map((sheet) => {
      const box = sheet.getBoundingClientRect();
      return {
        left: round(box.left - front.left),
        top: round(box.top - front.top),
        right: round(box.right - front.right),
        bottom: round(box.bottom - front.bottom),
      };
    }),
  };
}

/**
 * The same, as drawn on the current frame of a held transition: a named part is its own layer; an unnamed sheet
 * is painted into the card's picture, which the card's layer draws scaled to its own width.
 */
function drawnStack(entryId: string): StackSample {
  const root = document.documentElement;
  const item = document.querySelector<HTMLElement>(`[data-entry-id="${entryId}"]`);
  if (!item) throw new Error(`no feed entry ${entryId}`);
  const layerBox = (name: string) => {
    const style = getComputedStyle(root, `::view-transition-group(${name})`);
    const matrix = new DOMMatrixReadOnly(style.transform === 'none' ? undefined : style.transform);
    const [originX = 0, originY = 0] = style.transformOrigin.split(' ').map(Number.parseFloat);
    const at = (x: number, y: number) =>
      new DOMMatrixReadOnly().translate(originX, originY).multiply(matrix).translate(-originX, -originY).transformPoint({ x, y });
    const [start, end] = [at(0, 0), at(Number.parseFloat(style.width), Number.parseFloat(style.height))];
    return { left: start.x, top: start.y, right: end.x, bottom: end.y };
  };
  const card = layerBox(item.style.getPropertyValue('view-transition-name'));
  const laid = item.getBoundingClientRect();
  const scale = (card.right - card.left) / laid.width;
  const drawn = (element: HTMLElement) => {
    const name = element.style.getPropertyValue('view-transition-name');
    if (name) return layerBox(name);
    // invariant: Chrome nests an item's layers in its card's, so both boxes are measured from the card's corner.
    const box = element.getBoundingClientRect();
    return {
      left: (box.left - laid.left) * scale,
      top: (box.top - laid.top) * scale,
      right: (box.right - laid.left) * scale,
      bottom: (box.bottom - laid.top) * scale,
    };
  };
  const poster = item.querySelector<HTMLElement>(':is(.stack-front, .shuffle-window) > .poster:not(.poster-outgoing)');
  if (!poster) throw new Error(`no front poster in ${entryId}`);
  const front = drawn(poster);
  const sheets = [...item.querySelectorAll<HTMLElement>(':is(.card-back, .stack-layer):not([data-stack-reserve])')]
    .filter((sheet) => !sheet.closest('.suite-sheet-outgoing'))
    .sort((a, b) => Number(a.dataset.stackDepth) - Number(b.dataset.stackDepth));
  return {
    width: front.right - front.left,
    offsets: sheets.map((sheet) => {
      const box = drawn(sheet);
      return { left: box.left - front.left, top: box.top - front.top, right: box.right - front.right, bottom: box.bottom - front.bottom };
    }),
  };
}

/** Every shown rear sheet's box and its row's, for each suite on the page. */
const sheetsInRows = (page: Page) =>
  page.locator('.feed-list .feed-suite').evaluateAll(
    (items, sheets) =>
      items.flatMap((item) => {
        const row = item.getBoundingClientRect();
        return [...item.querySelectorAll<HTMLElement>(sheets)].map((sheet) => {
          const box = sheet.getBoundingClientRect();
          return {
            suite: item.dataset.entryId,
            depth: sheet.dataset.stackDepth,
            above: row.top - box.top,
            below: box.bottom - row.bottom,
            left: row.left - box.left,
            right: box.right - row.right,
          };
        });
      }),
    SHEETS,
  );

async function expectSheetsInsideRows(page: Page) {
  const sheets = await sheetsInRows(page);
  expect(sheets.length).toBeGreaterThan(0);
  for (const sheet of sheets) {
    expect.soft(Math.max(sheet.above, sheet.below, sheet.left, sheet.right), JSON.stringify(sheet)).toBeLessThanOrEqual(0.5);
  }
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
});

for (const [from, to] of [
  ['List', 'Grid'],
  ['Grid', 'List'],
] as const) {
  test(`every rear sheet keeps its place behind the front poster while the library morphs from ${from} to ${to}`, async ({ page }) => {
    const entryId = `suite:${await suiteRow(page, 4)}`;
    const control = await library(page, from);
    await page.mouse.move(1270, 790);
    const before = await page.evaluate(restStack, entryId);
    expect(before.offsets).toHaveLength(3);
    await page.evaluate(holdNextTransition);
    await control.getByRole('button', { name: to, exact: true }).click();
    await page.waitForFunction(() => window.stackFreeze?.ready === true);
    const after = await page.evaluate(restStack, entryId);
    // why: past the snapshots' crossfade only the incoming pictures show; these frames span the morph's middle.
    for (const ms of [200, 280, 360, 440]) {
      await page.evaluate((at) => window.stackFreeze?.seek(at), ms);
      const frame = await page.evaluate(drawnStack, entryId);
      const progress = (frame.width - before.width) / (after.width - before.width);
      expect(progress, `${ms} ms`).toBeGreaterThan(0.2);
      expect(progress, `${ms} ms`).toBeLessThan(1);
      for (const [depth, offset] of frame.offsets.entries()) {
        const from = before.offsets[depth];
        const to = after.offsets[depth];
        if (!from || !to) throw new Error(`sheet ${depth + 1} is missing before or after the switch`);
        for (const edge of ['left', 'top', 'right', 'bottom'] as const) {
          const start = from[edge];
          const expected = start + (to[edge] - start) * progress;
          expect.soft(Math.abs(offset[edge] - expected), `sheet ${depth + 1} ${edge} at ${ms} ms`).toBeLessThanOrEqual(2);
        }
      }
    }
    await page.evaluate(() => window.stackFreeze?.release());
    await expect(page.locator('html')).not.toHaveAttribute('data-feed-transition', /.+/);
  });
}

test('a suite stack stays inside its row in the list and the grid, at rest and after each switch', async ({ page }) => {
  await suiteRow(page, 4);
  await suiteRow(page, 6);
  const control = await library(page, 'List');
  await page.mouse.move(1270, 790);
  await expectSheetsInsideRows(page);
  for (const layout of ['Grid', 'List', 'Grid'] as const) {
    await switchTo(page, control, layout);
    await expectSheetsInsideRows(page);
  }
  await page.reload();
  await expect(page.locator('.feed-list').first()).toHaveAttribute('data-view', 'grid');
  await expectSheetsInsideRows(page);
});

test('a suite stack stays inside its row on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await suiteRow(page, 4);
  await suiteRow(page, 6);
  await gotoHydrated(page, origin());
  await expect(page.locator('.feed-list').first()).toHaveAttribute('data-view', 'list');
  await expectSheetsInsideRows(page);
});

test('a six-run suite stacks exactly like a four-run suite', async ({ page }) => {
  const four = `suite:${await suiteRow(page, 4)}`;
  const six = `suite:${await suiteRow(page, 6)}`;
  const control = await library(page, 'List');
  await page.mouse.move(1270, 790);
  for (const layout of ['List', 'Grid'] as const) {
    await switchTo(page, control, layout);
    const [small, large] = [await page.evaluate(restStack, four), await page.evaluate(restStack, six)];
    expect(large.offsets, layout).toEqual(small.offsets);
  }
});

test('rapid keyboard switching settles every rear sheet back into its pile', async ({ page }) => {
  const entryId = `suite:${await suiteRow(page, 4)}`;
  const control = await library(page, 'Grid');
  await page.mouse.move(1270, 790);
  const grid = await page.evaluate(restStack, entryId);
  await control.getByRole('button', { name: 'Grid', exact: true }).focus();
  for (const key of ['Shift+Tab', 'Enter', 'Tab', 'Enter', 'Shift+Tab', 'Enter', 'Tab', 'Enter']) await page.keyboard.press(key);
  await expect(page.locator('html')).not.toHaveAttribute('data-feed-transition', /.+/);
  await expect(page.locator('.feed-list').first()).toHaveAttribute('data-view', 'grid');
  expect(await page.evaluate(restStack, entryId)).toEqual(grid);
  await expectSheetsInsideRows(page);
});
