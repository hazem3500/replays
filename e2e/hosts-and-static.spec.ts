import { createReadStream } from 'node:fs';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';

import { expect, type Page, test } from '@playwright/test';

import { buildStatic } from '../src/server/static.ts';
import { freePort } from '../scripts/test-server.mjs';
import { serveApp, useTheme, gotoHydrated } from './support.ts';

/*
 * One process, two addresses (`hosts` in the config, src/server/base-path.ts): 127.0.0.1 gets the global base
 * (`/replays`), replays.localhost (Chromium resolves *.localhost to loopback) is served at the root. Then the same
 * viewer as static files (`replays build-static`) behind a tiny CDN stand-in that sends `/replays/api/*` to the server.
 */

const ROOT_HOST = 'replays.localhost';
const PAGE = { dark: '#101820', light: '#fafaf5' };

let configDir: string;
test.beforeAll(async () => {
  configDir = await mkdtemp(join(tmpdir(), 'replays-e2e-hosts-'));
  await writeFile(
    join(configDir, 'config.json'),
    JSON.stringify({
      name: 'Acme Replays',
      basePath: '/replays',
      hosts: { [ROOT_HOST]: { basePath: '/' } },
      theme: { dark: { page: PAGE.dark }, light: { page: PAGE.light } },
    }),
  );
});
test.afterAll(async () => {
  await rm(configDir, { recursive: true, force: true });
});

const server = serveApp(() => ({ REPLAYS_CONFIG: join(configDir, 'config.json') }));
const port = () => new URL(server().origin).port;

/** Every API path the page asks for. */
function apiPaths(page: Page) {
  const paths: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.includes('/api/')) paths.push(url.pathname);
  });
  return paths;
}

test.describe('a base per host', () => {
  test('the default host keeps the global base', async ({ page }) => {
    const paths = apiPaths(page);
    await gotoHydrated(page, `${server().origin}/replays/`);
    await expect(page.locator('meta[name="app-base"]')).toHaveAttribute('content', '/replays');
    await expect(page.getByRole('link', { name: /^Demo shop/ })).toHaveAttribute('href', '/replays/r/demo-shop');
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every((path) => path.startsWith('/replays/api/'))).toBe(true);
  });

  test('the listed host is served at the root, from the same process', async ({ page }) => {
    const paths = apiPaths(page);
    const origin = `http://${ROOT_HOST}:${port()}`;
    await gotoHydrated(page, `${origin}/`);
    await expect(page).toHaveTitle('Acme Replays');
    await expect(page.locator('meta[name="app-base"]')).toHaveAttribute('content', '/');
    const link = page.getByRole('link', { name: /^Demo shop/ });
    await expect(link).toHaveAttribute('href', '/r/demo-shop');
    await link.click();
    await expect(page).toHaveURL(`${origin}/r/demo-shop`);
    await expect(page.getByRole('heading', { level: 1, name: 'Demo shop: checkout with a bad coupon' })).toBeVisible();
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every((path) => path.startsWith('/api/'))).toBe(true);
  });

  test('responses that depend on the host say Vary: Host', async ({ request }) => {
    const html = { accept: 'text/html' };
    const atRoot = await request.get(`${server().origin}/`, { headers: { ...html, host: `${ROOT_HOST}:${port()}` } });
    expect(await atRoot.text()).toContain('<meta name="app-base" content="/" />');
    expect(atRoot.headers().vary).toMatch(/\bHost\b/);
    const prefixed = await request.get(`${server().origin}/replays/`, { headers: html });
    expect(await prefixed.text()).toContain('<meta name="app-base" content="/replays" />');
    expect(prefixed.headers().vary).toMatch(/\bHost\b/);
    const config = await request.get(`${server().origin}/api/config`, { headers: { host: ROOT_HOST } });
    expect(config.headers().vary).toMatch(/\bHost\b/);
  });

  test('theme-color follows the branding page colour per scheme', async ({ page }) => {
    await useTheme(page, 'dark');
    await gotoHydrated(page, `${server().origin}/replays/`);
    const color = page.locator('meta[name="theme-color"]');
    await expect(color).toHaveAttribute('content', PAGE.dark);
    await page.getByRole('button', { name: 'Switch to light theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(color).toHaveAttribute('content', PAGE.light);
  });
});

test.describe('the static viewer on a CDN, the API on the server', () => {
  let out: string;
  let cdn: Server;
  let cdnOrigin: string;

  const TYPES: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.woff2': 'font/woff2' };

  test.beforeAll(async () => {
    out = await mkdtemp(join(tmpdir(), 'replays-e2e-static-'));
    await buildStatic({ out, env: { REPLAYS_CONFIG: join(configDir, 'config.json') }, cwd: configDir });
    const cdnPort = await freePort();
    cdnOrigin = `http://127.0.0.1:${cdnPort}`;
    // A CDN in miniature: `/replays/api/*` goes to the server, files from the bucket, any other page is index.html.
    cdn = createServer((request, response) => {
      const url = new URL(request.url ?? '/', cdnOrigin);
      if (url.pathname.startsWith('/replays/api/')) {
        const upstream = httpRequest(
          { host: '127.0.0.1', port: Number(port()), method: request.method, path: request.url, headers: request.headers },
          (answer) => {
            response.writeHead(answer.statusCode ?? 502, answer.headers);
            answer.pipe(response);
          },
        );
        upstream.on('error', () => response.destroy());
        request.pipe(upstream);
        return;
      }
      const rest = url.pathname.startsWith('/replays/') ? url.pathname.slice('/replays'.length) : url.pathname;
      const file = resolve(out, `.${rest}`);
      const isFile = stat(file).then(
        (info) => info.isFile() && file.startsWith(`${out}/`),
        () => false,
      );
      void isFile.then((found) => {
        if (found) {
          response.writeHead(200, {
            'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
            'cache-control': 'public, max-age=31536000, immutable',
          });
          createReadStream(file).pipe(response);
        } else {
          response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-cache' });
          createReadStream(join(out, 'index.html')).pipe(response);
        }
      });
    });
    await new Promise<void>((done) => cdn.listen(cdnPort, '127.0.0.1', done));
  });
  test.afterAll(async () => {
    await new Promise<void>((done) => (cdn ? cdn.close(() => done()) : done()));
    await rm(out, { recursive: true, force: true });
  });

  test('opens the index and a replay with the stamped branding, talking to the API at the base', async ({ page }) => {
    const paths = apiPaths(page);
    await useTheme(page, 'light');
    await gotoHydrated(page, `${cdnOrigin}/replays/`);
    await expect(page).toHaveTitle('Acme Replays');
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', PAGE.light);
    await page.getByRole('link', { name: /^Demo shop/ }).click();
    await expect(page).toHaveURL(`${cdnOrigin}/replays/r/demo-shop`);
    await expect(page.getByRole('heading', { level: 1, name: 'Demo shop: checkout with a bad coupon' })).toBeVisible();
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every((path) => path.startsWith('/replays/api/'))).toBe(true);
  });
});
