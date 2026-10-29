import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium, type Page, type Browser } from 'playwright-core';
import { summarizeReplay, type ReplayBundle } from '../shared/replay.ts';
import type { UserPluginFile } from '../shared/malleable.ts';
import { SANDBOX_CSP, SANDBOX_HTML, SANDBOX_PATH } from '../shared/sandbox-runtime.ts';
import { browserHarnessSource } from './check-browser.ts';
import type { PluginCheckOptions, PluginCheckResult } from './check.ts';

interface BrowserCheckOptions extends PluginCheckOptions {
  executablePath?: string;
  noSandbox?: boolean;
}

interface BrowserReport {
  done: boolean;
  output: string[];
  errors: string[];
}
declare global {
  interface Window {
    __pluginCheck?: BrowserReport;
  }
}

export async function checkBrowser(
  options: BrowserCheckOptions,
  replay: ReplayBundle,
  result: PluginCheckResult,
  file?: UserPluginFile,
): Promise<void> {
  const viewerEntry = [resolve(import.meta.dirname, '../client/plugins/api.ts'), resolve(import.meta.dirname, '../lib/viewer.mjs')].find(
    existsSync,
  );
  if (!viewerEntry) throw new Error('cannot locate the viewer API; build the package before checking browser entries');
  const contents = file
    ? `${browserHarnessSource('user')}(${JSON.stringify(file)},${JSON.stringify(replay)});`
    : `import entry from ${JSON.stringify(options.file)}; import {ViewerRegistry} from ${JSON.stringify(viewerEntry)}; ${browserHarnessSource('browser')}(entry,ViewerRegistry,${JSON.stringify({ replay, summary: summarizeReplay(replay) })});`;
  const compiled = await build({
    stdin: { contents, resolveDir: dirname(options.file), loader: 'js' },
    alias: { '@hazem3500/replays/viewer': viewerEntry },
    bundle: true,
    platform: 'browser',
    format: 'esm',
    write: false,
    logLevel: 'silent',
  });
  const script = compiled.outputFiles[0]?.text;
  if (script === undefined) throw new Error('browser harness produced no script');
  const server = checkServer(replay, script);
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', resolveListen);
  });
  let browser: Browser | undefined;
  try {
    browser = await connectBrowser(options);
    const context = await browser.newContext({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 1 });
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('check server did not bind');
      await runPage(await context.newPage(), `http://127.0.0.1:${address.port}`, options, result);
    } finally {
      await context.close();
    }
  } finally {
    await browser?.close();
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  }
}

function connectBrowser(options: BrowserCheckOptions) {
  return options.headless
    ? chromium.launch({
        headless: true,
        ...(options.executablePath ? { executablePath: options.executablePath } : {}),
        args: ['--disable-dev-shm-usage', '--disable-gpu', '--disable-webgl', ...(options.noSandbox ? ['--no-sandbox'] : [])],
      })
    : chromium.connectOverCDP(options.cdp ?? 'http://127.0.0.1:9222', { timeout: 5000 });
}

function checkServer(replay: ReplayBundle, script: string): ReturnType<typeof createServer> {
  return createServer((request, response) => {
    if (request.url === SANDBOX_PATH) {
      response.writeHead(200, { 'content-type': 'text/html', 'content-security-policy': SANDBOX_CSP });
      response.end(SANDBOX_HTML);
    } else if (request.url === '/fixture.json') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(replay));
    } else if (request.url === '/entry.js') {
      response.writeHead(200, { 'content-type': 'text/javascript' });
      response.end(script);
    } else if (request.url === '/favicon.ico') {
      response.writeHead(204);
      response.end();
    } else if (request.url === '/') {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<!doctype html><html><body><script type="module" src="/entry.js"></script></body></html>');
    } else {
      response.writeHead(404);
      response.end();
    }
  });
}

async function runPage(page: Page, origin: string, options: PluginCheckOptions, result: PluginCheckResult): Promise<void> {
  page.on('pageerror', (error) => result.errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') result.errors.push(message.text());
    else result.output.push(message.text());
  });
  await page.route('**/*', (route) => (route.request().url().startsWith(`${origin}/`) ? route.continue() : route.abort()));
  await page.goto(`${origin}/`);
  await page.waitForFunction(() => window.__pluginCheck?.done, undefined, { timeout: 30_000 });
  const report = await page.evaluate(() => window.__pluginCheck);
  if (!report) throw new Error('browser check returned no report');
  result.output.push(...report.output);
  result.errors.push(...report.errors);
  if (options.out) await screenshots(page, options.out, result);
}

async function screenshots(page: Page, out: string, result: PluginCheckResult): Promise<void> {
  await mkdir(out, { recursive: true });
  const items = page.locator('[data-slot-item], iframe');
  const count = Math.min(await items.count(), 8);
  if (!count) {
    const path = join(out, 'plugin-check.png');
    await page.screenshot({ path });
    result.output.push(`screenshot: ${path}`);
  }
  for (let i = 0; i < count; i++) {
    const path = join(out, `slot-${i + 1}.png`);
    await items.nth(i).screenshot({ path });
    result.output.push(`screenshot: ${path}`);
  }
}
