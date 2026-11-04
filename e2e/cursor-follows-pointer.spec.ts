import { build } from 'esbuild';
import { expect, test, type Page } from '@playwright/test';

import { openReplay, postBundle, serveApp, type Bundle } from './support.ts';

const server = serveApp();

test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });

declare global {
  interface Window {
    __recorder: {
      start(options: { consent: true }): Promise<void>;
      stop(): unknown;
      upload(options: { confirmed: true }): Promise<unknown>;
    };
    __report?: { bundle: Bundle };
  }
}

/** The browser recorder with rrweb inside, as one script a page can load. */
async function recorderScript() {
  const result = await build({
    stdin: {
      contents: `
        import { createRecorder } from './src/recorder/recorder.ts';
        import * as rrweb from 'rrweb';
        window.__recorder = createRecorder({
          app: { name: 'Pointer fidelity', environment: 'staging' },
          upload: async (report) => { window.__report = report; return { replayId: report.bundle.meta.id }; },
          prompts: { consent: false, review: false },
          activation: () => true,
          loadRrweb: async () => rrweb,
        });
      `,
      resolveDir: process.cwd(),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
  });
  return result.outputFiles[0]!.text;
}

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Pointer fidelity</title>
<style>body{margin:0;font:16px system-ui;background:#f4f6f5}main{height:1200px;padding:40px}</style></head>
<body><main><h1>Staging page</h1><p>Move the pointer around.</p></main></body></html>`;

/** Flicks the real pointer with ~60 Hz events, fast at first and settling gently onto the spot, like a hand. */
async function glide(page: Page, from: Point, to: Point, ms: number) {
  const frames = Math.max(1, Math.round(ms / 16));
  for (let i = 1; i <= frames; i++) {
    const u = i / frames;
    const eased = 1 - (1 - u) ** 4;
    await page.mouse.move(from.x + (to.x - from.x) * eased, from.y + (to.y - from.y) * eased);
    await page.waitForTimeout(16);
  }
}

interface Point {
  x: number;
  y: number;
}

/** A place the pointer stops, and the wall-clock times it arrived and set off again (the end of the recording for the last). */
interface Rest extends Point {
  arrived: number;
  leaves: number;
}

const REST_MS = 900;
/** A quick flick, shorter than the cursor's own travel time over the same distance. */
const FLICK_MS = 200;

/** Records the pointer stopping at each spot in turn; returns the bundle and when each stop began and ended. */
async function recordPointer(page: Page, spots: Point[], start: Point) {
  await page.route('https://staging.example/**', (route) => route.fulfill({ contentType: 'text/html', body: PAGE }));
  await page.goto('https://staging.example/app');
  await page.addScriptTag({ content: await recorderScript() });
  await page.mouse.move(start.x, start.y);
  await page.evaluate(() => window.__recorder.start({ consent: true }));
  await page.waitForTimeout(300);
  const rests: Rest[] = [];
  let at = start;
  for (const spot of spots) {
    const leaves = await page.evaluate(() => Date.now());
    const previous = rests.at(-1);
    if (previous) previous.leaves = leaves;
    await glide(page, at, spot, FLICK_MS);
    at = spot;
    rests.push({ ...spot, arrived: await page.evaluate(() => Date.now()), leaves: 0 });
    await page.waitForTimeout(REST_MS);
  }
  const end = await page.evaluate(() => Date.now());
  const last = rests.at(-1);
  if (last) last.leaves = end;
  await page.evaluate(() => window.__recorder.stop());
  await page.evaluate(() => window.__recorder.upload({ confirmed: true }));
  const bundle = await page.evaluate(() => window.__report!.bundle);
  return { bundle, rests };
}

/** Where the drawn cursor's tip is, in the recorded page's own pixels. */
async function drawnTip(page: Page) {
  return page.evaluate(() => {
    const cursor = document.querySelector<HTMLElement>('.replay-cursor');
    const frame = document.querySelector<HTMLIFrameElement>('.player-host iframe');
    if (!cursor || !frame || cursor.hidden) return undefined;
    const marker = document.createElement('i');
    marker.style.cssText = `position:absolute;left:${-Number.parseFloat(cursor.style.marginLeft)}px;top:${-Number.parseFloat(cursor.style.marginTop)}px;width:0;height:0`;
    cursor.append(marker);
    const tip = marker.getBoundingClientRect();
    marker.remove();
    const box = frame.getBoundingClientRect();
    const scale = box.width / frame.offsetWidth;
    return { x: (tip.left - box.left) / scale, y: (tip.top - box.top) / scale };
  });
}

async function tipAt(page: Page, id: string, milliseconds: number) {
  await openReplay(page, `${server().origin}/r/${id}?t=${milliseconds / 1000}`);
  await expect.poll(() => drawnTip(page)).toBeDefined();
  await page.waitForTimeout(150);
  return (await drawnTip(page))!;
}

/** why: rrweb drops the last sample of a move (its throttle has no trailing call), so a rest can read a few pixels short. */
const TOLERANCE_PX = 12;
/** Far enough before the pointer sets off that the cursor leaving now would be leaving early. */
const BEFORE_SETTING_OFF_MS = 150;

test('the drawn cursor stays where the pointer rests until the pointer sets off', async ({ page }) => {
  test.setTimeout(120_000);
  const spots = [
    { x: 200, y: 150 },
    { x: 1100, y: 650 },
    { x: 250, y: 600 },
    { x: 1000, y: 200 },
  ];
  const { bundle, rests } = await recordPointer(page, spots, { x: 100, y: 120 });
  await postBundle(page.request, server().origin, bundle);
  const first = (bundle.events[0] as { timestamp: number }).timestamp;
  for (const rest of rests) {
    for (const at of [(rest.arrived + rest.leaves) / 2, rest.leaves - BEFORE_SETTING_OFF_MS]) {
      const tip = await tipAt(page, bundle.meta.id, Math.round(at - first));
      expect(
        Math.hypot(tip.x - rest.x, tip.y - rest.y),
        `pointer rested at (${rest.x}, ${rest.y}) until ${Math.round(rest.leaves - first)} ms; at ${Math.round(at - first)} ms the cursor was at (${tip.x.toFixed(0)}, ${tip.y.toFixed(0)})`,
      ).toBeLessThan(TOLERANCE_PX);
    }
  }
});
