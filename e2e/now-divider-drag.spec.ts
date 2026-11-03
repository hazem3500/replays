import { expect, test, type Locator, type Page } from '@playwright/test';

import { cloneBundle, openReplay, postBundle, serveApp, uniqueId } from './support.ts';

const server = serveApp();
test.use({ viewport: { width: 1280, height: 720 } });

/** Resolves after `count` animation frames. */
const frames = (page: Page, count: number) =>
  page.evaluate(
    (total) =>
      new Promise<void>((done) => {
        let seen = 0;
        const tick = () => (++seen >= total ? done() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    count,
  );

const top = (locator: Locator) => locator.evaluate((element) => element.getBoundingClientRect().top);

/** The line's screen y on each of the next `count` frames. */
const sampleFrames = (line: Locator, count: number) =>
  line.evaluate(
    (element, total) =>
      new Promise<number[]>((done) => {
        const ys: number[] = [];
        const tick = () => {
          ys.push(element.getBoundingClientRect().top);
          if (ys.length >= total) done(ys);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    count,
  );

test('dragging the now grip moves the line 1:1 with the pointer and holds it at the first and last row', async ({ page }) => {
  const id = uniqueId('now-drag');
  const bundle = await cloneBundle(page.request, server().origin, 'demo-shop', id, 'Now divider drag');
  bundle.console = Array.from({ length: 40 }, (_, index) => ({
    at: 100 + index * 200,
    level: 'log',
    message: `Tick ${index}`,
    url: 'https://shop.test/',
  }));
  await postBundle(page.request, server().origin, bundle);
  await openReplay(page, `${server().origin}/r/${id}?t=4`);
  await page.getByRole('tab', { name: /^Console/ }).click();

  const list = page.getByTestId('console-list');
  const line = list.locator('.now-divider');
  const grip = line.locator('.now-grip');
  await expect(list.locator('xpath=..')).not.toHaveAttribute('data-fits', '');
  const box = (await list.boundingBox())!;
  const header = (await list.locator('.cp-head').boundingBox())!;
  const x = box.x + 200;

  // Hover intent: the grip comes up once the pointer rests on the line after moving along it.
  await expect(async () => {
    const at = await top(line);
    await page.mouse.move(x - 40, at);
    await page.mouse.move(x, at, { steps: 4 });
    await expect(grip).toHaveCSS('opacity', '1', { timeout: 1000 });
  }).toPass();
  const handle = (await grip.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  const grab = handle.y + handle.height / 2 - (await top(line));

  // Away from the auto-scroll edges the line is the pointer on the next frames: no spring lag, no snap.
  const calm = { from: header.y + header.height + 52, to: box.y + box.height - 52 };
  for (let step = 0; step <= 4; step++) {
    const y = calm.from + ((calm.to - calm.from) * step) / 4;
    await page.mouse.move(x, y);
    await frames(page, 2);
    expect(Math.abs((await top(line)) - (y - grab))).toBeLessThanOrEqual(1);
  }

  // Far past the bottom: the list scrolls to its end and the line rests on the last row's boundary, still.
  const travel = sampleFrames(line, 40);
  await page.mouse.move(x, box.y + box.height + 200, { steps: 4 });
  // Every frame on the way, while the list auto-scrolls, keeps the line inside the list.
  for (const y of await travel) {
    expect(y).toBeGreaterThanOrEqual(header.y + header.height - 1);
    expect(y).toBeLessThanOrEqual(box.y + box.height);
  }
  await expect
    .poll(() => list.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop))
    .toBeLessThanOrEqual(1);
  const bottom = await sampleFrames(line, 20);
  expect(Math.max(...bottom) - Math.min(...bottom)).toBeLessThanOrEqual(0.5);
  expect(Math.max(...bottom)).toBeLessThanOrEqual(box.y + box.height);
  expect(Math.min(...bottom)).toBeGreaterThanOrEqual(box.y + box.height - 30);

  // Far past the top: back to the first row's boundary, under the header, still.
  await page.mouse.move(x, box.y - 200, { steps: 4 });
  await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBe(0);
  const first = await sampleFrames(line, 20);
  expect(Math.max(...first) - Math.min(...first)).toBeLessThanOrEqual(0.5);
  expect(Math.min(...first)).toBeGreaterThanOrEqual(header.y + header.height - 1);
  expect(Math.max(...first)).toBeLessThanOrEqual(header.y + header.height + 8);

  await page.mouse.up();
});
