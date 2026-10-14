#!/usr/bin/env node
// Re-records sample/demo-shop.json: a capture of the fictional demo shop (fixtures/demo-shop) driven by
// sample/demo-shop.steps.json, with the Playwright driver. Public-data-only by construction.
//   CHROME_PATH=/usr/bin/google-chrome node --experimental-strip-types --no-warnings scripts/record-sample.mjs
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { capture, parseArgs } from '../src/capture/capture.ts';
import { startDemoServer } from './demo-server.mjs';

const root = resolve(import.meta.dirname, '..');
const { server, origin } = await startDemoServer(4173);
const output = join(await mkdtemp(join(tmpdir(), 'replay-kit-sample-')), 'out');
try {
  const args = await parseArgs([
    '--url',
    `${origin}/`,
    '--output',
    output,
    '--id',
    'demo-shop',
    '--title',
    'Demo shop: checkout with a bad coupon',
    '--steps',
    `@${join(root, 'sample/demo-shop.steps.json')}`,
    '--tag',
    'demo',
    '--tag',
    'checkout',
    '--context-file',
    join(root, 'sample/demo-shop.context.json'),
  ]);
  const result = await capture(args);
  await copyFile(result.replayPath, join(root, 'sample/demo-shop.json'));
  console.log(JSON.stringify({ ...result, replayPath: 'sample/demo-shop.json' }));
} finally {
  server.close();
  await rm(join(output, '..'), { recursive: true, force: true });
}
