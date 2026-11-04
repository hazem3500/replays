import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { build } from 'esbuild';
import { expect, test } from '@playwright/test';

import { isRecord } from '../src/shared/validate.ts';
import { openReplay, serveApp, type Bundle } from './support.ts';

let configDir: string;
test.beforeAll(async () => {
  configDir = await mkdtemp(join(tmpdir(), 'replays-e2e-customer-'));
  const config = { privacy: { keepCustomerChoices: true }, plugins: [resolve(import.meta.dirname, 'customer-ingest-plugin.mjs')] };
  await writeFile(join(configDir, 'config.json'), JSON.stringify(config));
});
test.afterAll(async () => {
  await rm(configDir, { recursive: true, force: true });
});

const server = serveApp(() => ({ REPLAYS_CONFIG: join(configDir, 'config.json') }));

test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });

declare global {
  interface Window {
    __customerRecorder: { request(): Promise<unknown> };
    __customerReport?: { bundle: Bundle };
  }
}

/** The guided recorder of a customer-facing host, with rrweb inside, as one script a page can load. */
async function recorderScript() {
  const result = await build({
    stdin: {
      contents: `
        import { createGuidedRecorder } from './src/recorder/ui/index.ts';
        import * as rrweb from 'rrweb';
        window.__customerRecorder = createGuidedRecorder({
          app: { name: 'Acme' },
          upload: async (report) => { window.__customerReport = report; return { replayId: report.bundle.meta.id }; },
          privacy: { sanitize: false, maskAllText: false, blockMedia: false },
          choices: { by: 'customer', privacy: ['visible'] },
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
  const [output] = result.outputFiles;
  if (!output) throw new Error('esbuild produced no recorder script');
  return output.text;
}

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Acme time</title></head><body>
<nav data-replay-public><a href="#reports">Reports</a> <a href="#projects">Projects</a> <input id="search" aria-label="Search"></nav>
<main><p>Call with Ada about invoices</p><p>2 h 15 min</p></main></body></html>`;

test('a customer recording keeps the marked product menus and hides their data, from consent to the viewer', async ({ page, request }) => {
  await page.route('https://acme.example/**', (route) => route.fulfill({ contentType: 'text/html', body: PAGE }));
  await page.goto('https://acme.example/timer');
  await page.addScriptTag({ content: await recorderScript() });
  await page.evaluate(() => void window.__customerRecorder.request());

  await page.getByRole('button', { name: 'Record', exact: true }).click();
  const consent = page.getByRole('dialog', { name: 'Record this tab?' });
  await expect(consent).toContainText("Your entries, names and typed text are hidden; Acme's menus and labels stay visible.");
  await consent.getByRole('button', { name: 'Start recording' }).click();
  await page.getByRole('textbox', { name: 'Search' }).fill('typed-secret-query');
  await page.getByRole('link', { name: 'Reports' }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Stop' }).click();
  const review = page.getByRole('dialog', { name: 'Send recording?' });
  await expect(review).toContainText("Acme's menus and labels stay visible.");
  await review.getByRole('button', { name: 'Send recording' }).click();
  const bundle = await page.evaluate(async () => {
    while (!window.__customerReport) await new Promise((done) => setTimeout(done, 50));
    return window.__customerReport.bundle;
  });

  const response = await request.post(`${server().origin}/api/ingest/v1/recordings`, { data: bundle, headers: { 'x-app-key': 'e2e-key' } });
  expect(response.status(), await response.text()).toBe(201);
  const receipt: unknown = await response.json();
  const id = isRecord(receipt) && typeof receipt.id === 'string' ? receipt.id : '';
  const stored = await (await request.get(`${server().origin}/api/replays/${id}`)).text();
  expect(stored).toContain('"choice":{"by":"customer","mode":"interface-visible","inputs":"masked","text":"masked","bodies":false}');
  for (const data of ['Call with Ada', 'invoices', '2 h 15 min', 'typed-secret-query']) expect(stored).not.toContain(data);

  await openReplay(page, `${server().origin}/r/${id}`);
  const replayed = page.frameLocator('[data-testid="replay-player"] iframe');
  await expect(replayed.getByText('Reports')).toBeVisible();
  await expect(replayed.getByText('Projects')).toBeVisible();
  await expect(replayed.getByText('Call with Ada')).toHaveCount(0);
});
