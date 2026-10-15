#!/usr/bin/env node
// Regenerates docs/screenshots/*: the viewer and index from a real server running the committed samples, and (when
// `pnpm build:site` has run) the landing page. Needs Chrome: CHROME_PATH, else Playwright's own browser.
//   pnpm build && pnpm build:site && node --experimental-strip-types --no-warnings scripts/shots.mjs
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';

import { chromium } from 'playwright-core';

const root = resolve(import.meta.dirname, '..');
const out = join(root, 'docs/screenshots');
await mkdir(out, { recursive: true });
const executablePath = process.env.CHROME_PATH || undefined;
const launch = () => chromium.launch({ ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox'] });

const free = () =>
  new Promise((done) => {
    const probe = createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => done(port));
    });
  });

/** The real server, with list posters on when a Chrome is available, over a throwaway data directory. */
async function startServer() {
  const port = await free();
  const dataDir = await mkdtemp(join(tmpdir(), 'replays-shots-'));
  const child = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', 'src/server/main.ts'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dataDir,
      RENDER_DISABLED: '1',
      ...(executablePath ? { CHROMIUM_PATH: executablePath, CHROMIUM_NO_SANDBOX: '1' } : { POSTERS_DISABLED: '1' }),
    },
    stdio: 'ignore',
  });
  const origin = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (
      await fetch(`${origin}/healthz`).then(
        (response) => response.ok,
        () => false,
      )
    )
      break;
    await new Promise((wait) => setTimeout(wait, 100));
  }
  return { origin, stop: async () => (child.kill(), rm(dataDir, { recursive: true, force: true })) };
}

async function shoot(browser, { url, file, width, height, theme = 'dark', wait = 1500, fullPage = false, ready }) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: theme });
  await context.addInitScript((value) => localStorage.setItem('replays-theme', value), theme);
  const page = await context.newPage();
  await page.goto(url);
  if (ready) await ready(page);
  await page.waitForTimeout(wait);
  await page.screenshot({ path: join(out, file), fullPage });
  await context.close();
  console.log(`docs/screenshots/${file}`);
}

const server = await startServer();
const browser = await launch();
try {
  // Posters render in the background on first request: ask for them, then give the server a moment.
  for (const id of ['demo-shop', 'human-demo']) await fetch(`${server.origin}/api/replays/${id}/poster`).catch(() => undefined);
  await new Promise((wait) => setTimeout(wait, 4000));
  await shoot(browser, { url: `${server.origin}/r/demo-shop?t=6.9`, file: 'viewer.png', width: 1440, height: 900, wait: 3000 });
  await shoot(browser, {
    url: `${server.origin}/r/demo-shop?t=6.9`,
    file: 'viewer-light.png',
    width: 1440,
    height: 900,
    theme: 'light',
    wait: 3000,
  });
  await shoot(browser, { url: `${server.origin}/r/demo-shop?t=6.9`, file: 'viewer-mobile.png', width: 390, height: 844, wait: 3000 });
  await shoot(browser, { url: `${server.origin}/`, file: 'index.png', width: 1440, height: 900, wait: 2500 });

  const site = resolve(root, 'dist/site');
  if (existsSync(site)) {
    const types = {
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'text/javascript',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.woff2': 'font/woff2',
      '.json': 'application/json',
    };
    const files = createServer(async (request, response) => {
      const url = new URL(request.url ?? '/', 'http://site');
      let path = normalize(join(site, decodeURIComponent(url.pathname)));
      if (!path.startsWith(site)) return response.writeHead(403).end();
      let body = await readFile(path).catch(() => undefined);
      // Like a static host: a directory answers with its index.html (the demo's API files are stored that way).
      if (!body) {
        path = join(path, 'index.html');
        body = await readFile(path).catch(() => undefined);
      }
      if (!body) return response.writeHead(404).end('not found');
      response.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' }).end(body);
    });
    await new Promise((done) => files.listen(0, '127.0.0.1', done));
    const base = `http://127.0.0.1:${files.address().port}/`;
    await shoot(browser, { url: base, file: 'landing-1280x800.png', width: 1280, height: 800, wait: 2500 });
    await shoot(browser, { url: base, file: 'landing-390x844.png', width: 390, height: 844, wait: 2500 });
    await shoot(browser, { url: base, file: 'landing-full-1280.png', width: 1280, height: 800, wait: 3500, fullPage: true });
    files.close();
  } else {
    console.log('dist/site not found: run `pnpm build:site` for the landing page screenshots');
  }
} finally {
  await browser.close();
  await server.stop();
}
