import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { expect, test } from '@playwright/test';

import { capture, parseArgs } from '../src/capture/capture.ts';
import { startDemoServer } from '../scripts/demo-server.mjs';
import { openReplay, uniqueId, serveApp } from './support.ts';

// The CI smoke for the whole path: capture the demo shop with the real CLI code, upload the result to the app
// server, and open it in the viewer.

const server = serveApp();
const email = 'capture.check@example.org';

/** Every file under `dir`, so the stored replay can be searched for the typed address. */
async function files(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => (entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)])));
  return nested.flat();
}

test('capture a sample, upload it, and the viewer loads it', async ({ page }) => {
  test.setTimeout(120_000);
  // The capture driver reads CHROME_PATH; fall back to the usual system Chrome, else Playwright's own browser.
  if (!process.env.CHROME_PATH && !process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE && existsSync('/usr/bin/google-chrome')) {
    process.env.CHROME_PATH = '/usr/bin/google-chrome';
  }
  const id = uniqueId('captured');
  const steps = [
    { kind: 'click', selector: "button[data-id='tea']", label: 'Add the tea to the cart' },
    { kind: 'wait', ms: 300 },
    { kind: 'click', selector: "nav a[href='/checkout.html']", label: 'Open the cart' },
    { kind: 'wait', ms: 300 },
    { kind: 'fill', selector: '#email', text: email, label: 'Enter an email address' },
    { kind: 'type', selector: '#coupon', text: 'SPRING10', label: 'Type a coupon code' },
    { kind: 'click', selector: '#apply', label: 'Apply the coupon' },
    { kind: 'wait', ms: 600, label: 'Read the coupon error' },
  ];
  const demo = await startDemoServer();
  const output = join(await mkdtemp(join(tmpdir(), 'replays-e2e-capture-')), 'out');
  try {
    const args = await parseArgs([
      '--url',
      `${demo.origin}/`,
      '--output',
      output,
      '--id',
      id,
      '--title',
      'Captured demo shop',
      '--steps',
      JSON.stringify(steps),
      '--tag',
      'e2e',
      '--upload-url',
      `${server().origin}/api/replays`,
    ]);
    const result = await capture(args);
    expect(result.consoleCount).toBeGreaterThan(0);
  } finally {
    demo.server.close();
    await rm(resolve(output, '..'), { recursive: true, force: true });
  }

  await openReplay(page, `${server().origin}/r/${id}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Captured demo shop' })).toBeVisible();

  // Unlabelled waits are pacing only; labelled waits keep their rail row, plus the opening step.
  const rail = page.getByTestId('step-timeline').locator('[data-step-index]');
  await expect(rail).toHaveCount(steps.filter((step) => step.kind !== 'wait' || step.label).length + 1);
  for (const label of ['Add the tea to the cart', 'Open the cart', 'Enter an email address', 'Apply the coupon', 'Read the coupon error']) {
    await expect(page.getByTestId('step-timeline').getByText(label, { exact: true })).toBeVisible();
  }

  // The coupon lookup answered 404: a console error and a failed request.
  await page.getByRole('slider', { name: 'Seek' }).press('End');
  await expect(page.getByTestId('console-list')).toContainText('Coupon service answered 404');
  await page.getByTestId('network-tab').click();
  await expect(page.getByRole('row', { name: /GET \/api\/coupons\/SPRING10 404/ })).toBeVisible();

  // What was typed into the field is masked: not in the viewer, not in what the server stored.
  const frame = page.frameLocator('.player-host iframe');
  await expect(frame.getByText('Pinecone Goods').first()).toBeVisible();
  expect(await page.locator('body').innerText()).not.toContain(email);
  expect(await frame.locator('html').innerHTML()).not.toContain(email);
  const stored = await (await page.request.get(`${server().origin}/api/replays/${id}`)).text();
  expect(stored).not.toContain(email);
  for (const file of await files(server().dataDir)) {
    if (!file.includes(id)) continue;
    expect(await readFile(file, 'utf8'), file).not.toContain(email);
  }
  expect((await files(server().dataDir)).some((file) => file.includes(id))).toBe(true);

  // Playing for a moment renders the shop in the rrweb iframe.
  await page.getByRole('slider', { name: 'Seek' }).press('Home');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByTestId('playhead')).not.toHaveText('0:00.0');
  await expect(frame.getByText('Pinecone Goods').first()).toBeVisible();
  await expect(frame.getByRole('heading', { name: 'Smoked pine tea' }).or(frame.getByText('Smoked pine tea').first())).toBeVisible();
});
