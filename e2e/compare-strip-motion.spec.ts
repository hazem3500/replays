import { expect, test, type Page } from '@playwright/test';

import { createSuite, openReplay, serveApp, uniqueId } from './support.ts';

const server = serveApp();
test.use({ viewport: { width: 1280, height: 800 } });

type Point = { x: number; y: number };
type Frame = { strip: string; pill: Point; opacity: number; cells: Record<string, Point> };

/**
 * The selection surface and every segment, relative to the strip, on each of the next `count` frames from before `act`
 * runs. Segments are read per frame, so a reflow of the whole viewer does not read as motion of the surface.
 */
async function trace(page: Page, count: number, act: () => Promise<void>) {
  const frames = page.evaluate(
    (total) =>
      new Promise<Frame[]>((done) => {
        const out: Frame[] = [];
        const tick = () => {
          const strip = document.querySelector<HTMLElement>('.compare-summary');
          const pill = document.querySelector<HTMLElement>('.compare-pill');
          const origin = pill?.parentElement?.getBoundingClientRect() ?? { x: 0, y: 0 };
          const at = (element: Element) => {
            const box = element.getBoundingClientRect();
            return { x: Math.round(box.x - origin.x), y: Math.round(box.y - origin.y) };
          };
          if (strip && !strip.dataset.traceId) strip.dataset.traceId = String(Math.random());
          const cells: Record<string, Point> = {};
          for (const chip of document.querySelectorAll('.compare-chip'))
            cells[chip.querySelector('.compare-chip-name')?.textContent ?? ''] = at(chip);
          out.push({
            strip: strip?.dataset.traceId ?? '',
            pill: pill ? at(pill) : { x: 0, y: 0 },
            opacity: Number(pill ? getComputedStyle(pill).opacity : 0),
            cells,
          });
          if (out.length >= total) done(out);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    count,
  );
  await page.waitForTimeout(32);
  await act();
  return frames;
}

async function openStrip(page: Page) {
  const suite = uniqueId('strip');
  const runs = ['Chrome', 'Firefox', 'Safari', 'Edge'].map((label, index) => ({
    id: `run-${index}`,
    label,
    status: 'passed' as const,
    replayId: `${suite}-${label.toLowerCase()}`,
  }));
  await createSuite(page.request, server().origin, suite, runs);
  await openReplay(page, `${server().origin}/s/${suite}/r/${runs[3]?.replayId ?? ''}`);
  await page.getByRole('button', { name: 'Collapse runs sidebar' }).click();
  await expect(page.locator('.suite-workspace')).toHaveAttribute('data-rail', 'true');
  await expect(page.locator('.compare-pill')).toHaveCSS('opacity', '1');
  // why: a first visit to a run reflows the viewer while it loads; visit each once so the trace measures the strip alone.
  for (const run of [...runs.slice(0, 3), runs[3]]) {
    await page.locator('.compare-chip', { hasText: run?.label ?? '' }).click();
    await expect(page).toHaveURL(new RegExp(`/r/${run?.replayId ?? ''}$`));
    await expect(page.locator('[data-testid="compare-stage"] iframe').first()).toBeAttached();
  }
  // why: the collapse widens the viewer over several frames; trace a switch only once the strip has stopped reflowing.
  const width = () => page.locator('.compare-summary-track').evaluate((track) => track.getBoundingClientRect().width);
  await expect
    .poll(async () => {
      const before = await width();
      await page.waitForTimeout(300);
      return (await width()) === before;
    })
    .toBe(true);
}

const switchTo = (page: Page, name: string) => page.locator('.compare-chip', { hasText: name }).click();

test('switching runs in the comparison strip glides the selection along its row without remounting or overshooting', async ({ page }) => {
  await openStrip(page);
  const frames = await trace(page, 30, () => switchTo(page, 'Safari'));
  expect(new Set(frames.map((frame) => frame.strip)).size).toBe(1);
  // invariant: in each frame the surface sits on the segments' shared row, between Edge and Safari, and only advances.
  let progress = 0;
  for (const { pill, cells } of frames) {
    const from = cells.Edge;
    const to = cells.Safari;
    if (!from || !to) throw new Error('Expected the Edge and Safari segments');
    expect(to.y).toBe(from.y);
    expect(pill.y).toBe(from.y);
    const step = (pill.x - from.x) / (to.x - from.x);
    expect(step).toBeGreaterThanOrEqual(progress - 0.01);
    expect(step).toBeLessThanOrEqual(1.01);
    progress = step;
  }
  expect(progress).toBeCloseTo(1, 2);
});

test('a switch to the other row of the folded strip fades the selection in place instead of crossing the grid', async ({ page }) => {
  await openStrip(page);
  const frames = await trace(page, 30, () => switchTo(page, 'Chrome'));
  expect(new Set(frames.map((frame) => frame.strip)).size).toBe(1);
  for (const { pill, cells } of frames) {
    const resting = [cells.Edge, cells.Chrome].map((cell) => `${cell?.x},${cell?.y}`);
    expect(resting).toContain(`${pill.x},${pill.y}`);
  }
  const arrived = frames.findIndex(({ pill, cells }) => pill.y === cells.Chrome?.y);
  const opacities = frames.slice(arrived).map((frame) => frame.opacity);
  for (let index = 1; index < opacities.length; index++) expect(opacities[index] ?? 0).toBeGreaterThanOrEqual(opacities[index - 1] ?? 0);
  expect(opacities.at(-1)).toBe(1);
});

test('under reduced motion the selection lands on the new segment at once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openStrip(page);
  const frames = await trace(page, 12, () => switchTo(page, 'Safari'));
  for (const { pill, opacity, cells } of frames) {
    expect([cells.Edge?.x, cells.Safari?.x]).toContain(pill.x);
    expect(opacity).toBe(1);
  }
  expect(frames.at(-1)?.pill.x).toBe(frames.at(-1)?.cells.Safari?.x);
});
