import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { observe } from './observe.mjs';
import { waitForFrame } from './page.mjs';

const root = resolve(import.meta.dirname, '../..');

async function sampleFiles(seedRoot) {
  return (await readdir(join(seedRoot, 'sample'))).filter((name) => name.endsWith('.json'));
}

/** Writes the demo seed, then clones its replays until the sample directory holds `rows` summaries. */
export async function seedReplays(seedRoot, rows) {
  execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', 'scripts/demo-seed.mjs', '--output', seedRoot], {
    cwd: root,
  });
  const files = await sampleFiles(seedRoot);
  for (let index = files.length; index < rows; index++) {
    const bundle = JSON.parse(await readFile(join(seedRoot, 'sample', files[index % files.length]), 'utf8'));
    bundle.meta.id = `perf-seed-${String(index).padStart(4, '0')}`;
    bundle.meta.title = `${bundle.meta.title} ${index}`;
    await writeFile(join(seedRoot, 'sample', `${bundle.meta.id}.json`), JSON.stringify(bundle));
  }
  return (await sampleFiles(seedRoot)).length;
}

async function capturePoster(browser, server, prefix) {
  const warm = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await warm.addInitScript(observe);
  await warm.goto(`${server.origin}${prefix}/r/demo-seed-checkout-error`);
  await waitForFrame(warm);
  const poster = await warm.locator('.replayer-wrapper').first().screenshot({ type: 'jpeg', quality: 70 });
  await warm.close();
  return poster;
}

async function resizeToPosterWidth(browser, poster) {
  const page = await browser.newPage();
  const jpeg = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/jpeg;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = Math.round((image.height * 480) / image.width);
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.7).split(',')[1];
  }, poster.toString('base64'));
  await page.close();
  return Buffer.from(jpeg, 'base64');
}

/**
 * Pre-generates real 480px JPEG stills from the demo replay outside timed regions,
 * so the measurements cover serving rather than rendering.
 */
export async function writePosters(browser, server, prefix, seedRoot) {
  const jpeg = await resizeToPosterWidth(browser, await capturePoster(browser, server, prefix));
  const { POSTER_VERSION, OPEN_STILL_VERSION } = await import('../../src/server/store.ts');
  for (const file of await sampleFiles(seedRoot)) {
    const id = file.replace(/\.json$/, '');
    await mkdir(join(server.dataDir, id), { recursive: true });
    await writeFile(join(server.dataDir, id, `poster.v${POSTER_VERSION}.jpg`), jpeg);
    await writeFile(join(server.dataDir, id, `open.v${OPEN_STILL_VERSION}.jpg`), jpeg);
  }
}
