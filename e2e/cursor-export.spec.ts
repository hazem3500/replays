import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { editsVersion, type ReplayEdits } from '../src/shared/edits.ts';
import { serveApp } from './support.ts';

function spawnError(result: ReturnType<typeof spawnSync>) {
  return result.stderr?.toString().trim() || result.error?.message || `process exited with status ${result.status}`;
}

const server = serveApp({ REPLAYS_BETA_EDITOR: 'true' });
test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });

test('export render page applies saved cursor settings and blur to encoded MP4 frames', async ({ page }) => {
  const base = server().origin;
  const bundle = await (await page.request.get(`${base}/api/replays/human-demo`)).json();
  const directory = resolve('.review-artifacts/ui-integration/export');
  await mkdir(directory, { recursive: true });
  let edits: ReplayEdits = {
    version: 1,
    cuts: [],
    cursor: { size: 2, hideWhenIdle: false, clickFeedback: false },
    blurs: [{ id: 'private', from: 0, to: 4000, x: 0.2, y: 0.2, width: 0.2, height: 0.2 }],
  };
  // Exercise the production export entry and its saved-edit fetch contract in the existing browser context.
  await page.route('**/cursor-export?*', (route) => route.fulfill({ path: resolve('dist/client/render.html'), contentType: 'text/html' }));
  await page.route('**/internal/render/human-demo/bundle.json', (route) => route.fulfill({ json: bundle }));
  await page.route('**/internal/render/human-demo/edits.json', (route) => route.fulfill({ json: edits }));
  for (const visible of [true, false]) {
    edits = { ...edits, cursor: { ...edits.cursor, visible } };
    await page.goto(`${base}/cursor-export?id=human-demo&edits=${editsVersion(edits)}`);
    await expect.poll(() => page.evaluate(() => window.__render?.ready)).toBe(true);
    expect(await page.evaluate(() => window.__render?.error)).toBeUndefined();
    await page.evaluate(() => window.__render!.showAt(2000));
    const cursor = page.locator('.replay-cursor');
    await expect(page.locator('.replay-blur')).toBeVisible();
    if (visible) {
      await expect(cursor).toBeVisible();
      // Browsers normalize inline transform numbers, so inspect the actual scale.
      const scale = await cursor.evaluate((element) => {
        const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
        return Math.hypot(matrix.a, matrix.b);
      });
      expect(scale).toBeCloseTo(2, 4);
    } else await expect(cursor).toBeHidden();
    const name = visible ? 'large-cursor-with-blur' : 'hidden-cursor-with-blur';
    const png = await page.screenshot();
    await writeFile(`${directory}/${name}.png`, png);
    const video = `${directory}/${name}.mp4`;
    const encoded = spawnSync(
      'ffmpeg',
      ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-i', 'pipe:0', '-frames:v', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video],
      { input: png },
    );
    expect(encoded.status, spawnError(encoded)).toBe(0);
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height,pix_fmt', '-of', 'json', video], {
      encoding: 'utf8',
    });
    expect(probe.status, spawnError(probe)).toBe(0);
    expect(JSON.parse(probe.stdout).streams[0]).toMatchObject({ codec_name: 'h264', width: 1280, height: 800, pix_fmt: 'yuv420p' });
  }
});
