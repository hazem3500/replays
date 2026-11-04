import { readdirSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { capture, createDriver, parseArgs } from '../src/capture/capture.ts';
import { createApp } from '../src/server/app.ts';
import { MemoryStorage } from '../src/server/storage/index.ts';
import { ReplayStore } from '../src/server/store.ts';
import { assertReplayBundle, type ReplayBundle } from '../src/shared/replay.ts';
import { startDemoServer } from '../scripts/demo-server.mjs';
import { appDefaults } from './fixtures.ts';

/** `CHROME_PATH`, else the first Chrome or Chromium binary found in the usual system directory. */
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const found = readdirSync('/usr/bin').find((name) => /^(\w+-)?chrom(e|ium)(-stable|-browser)?$/.test(name));
  return found ? `/usr/bin/${found}` : undefined;
}

const CHROME = findChrome();
const root = resolve(import.meta.dirname, '..');

const COOKIE_VALUE = 'cookie-secret-9f3a1c';
const EMAIL = 'demo.shopper@example.com';
const STEP_KINDS = new Set(['open', 'click', 'hover', 'type', 'fill', 'press', 'wait', 'scroll', 'goto']);

describe.skipIf(!CHROME)(
  'capture of the demo shop with the Playwright driver',
  () => {
    let demo: { server: Server; origin: string };
    let app: Server;
    let appOrigin = '';
    let store: ReplayStore;
    let output = '';
    let bundle: ReplayBundle;
    let raw = '';
    let scriptedSteps = 0;
    const cookiesSeenByServer: string[] = [];
    const saved = { chrome: process.env.CHROME_PATH, sandbox: process.env.CHROMIUM_NO_SANDBOX };

    beforeAll(async () => {
      process.env.CHROME_PATH = CHROME!;
      process.env.CHROMIUM_NO_SANDBOX ??= '1';

      // The demo shop, plus a session cookie on every response: the capture must never keep it.
      demo = (await startDemoServer(0)) as typeof demo;
      demo.server.prependListener('request', (request, response) => {
        if (request.headers.cookie) cookiesSeenByServer.push(request.headers.cookie);
        const writeHead = response.writeHead.bind(response) as (...args: unknown[]) => unknown;
        response.writeHead = ((status: number, headers: Record<string, string> = {}) =>
          writeHead(status, { ...headers, 'set-cookie': `sid=${COOKIE_VALUE}; Path=/; HttpOnly` })) as typeof response.writeHead;
      });

      // A replay server the capture uploads to at the end, opted in to visible staff inputs: a CLI capture never claims them.
      const dir = await mkdtemp(join(tmpdir(), 'replays-capture-app-'));
      store = new ReplayStore(new MemoryStorage(), join(dir, 'sample'));
      const handle = createApp({ ...appDefaults(), store, clientDir: dir, privacy: { keepVisibleInputs: true } });
      app = createServer((request, response) => void handle(request, response));
      await new Promise<void>((resolveListen) => app.listen(0, '127.0.0.1', resolveListen));
      appOrigin = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;

      scriptedSteps = (
        JSON.parse(await readFile(join(root, 'sample/demo-shop.steps.json'), 'utf8')) as Array<{ kind: string; label?: string }>
      ).filter((step) => step.kind !== 'wait' || step.label?.trim()).length;
      output = join(await mkdtemp(join(tmpdir(), 'replays-capture-')), 'out');
      const args = await parseArgs([
        '--url',
        `${demo.origin}/`,
        '--output',
        output,
        '--id',
        'demo-capture',
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
        '--upload-url',
        `${appOrigin}/api/replays`,
      ]);
      const result = await capture(args, createDriver(args.driver));
      raw = await readFile(result.replayPath, 'utf8');
      bundle = JSON.parse(raw) as ReplayBundle;
    }, 60_000);

    afterAll(async () => {
      demo?.server.close();
      app?.close();
      if (output) await rm(join(output, '..'), { recursive: true, force: true });
      for (const [name, value] of [
        ['CHROME_PATH', saved.chrome],
        ['CHROMIUM_NO_SANDBOX', saved.sandbox],
      ] as const) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    });

    it('writes a valid agent bundle with the recording, the title, the tags and the context', () => {
      expect(() => assertReplayBundle(bundle)).not.toThrow();
      expect(bundle.meta).toMatchObject({
        id: 'demo-capture',
        title: 'Demo shop: checkout with a bad coupon',
        source: 'agent',
        tags: ['demo', 'checkout'],
        viewport: { width: 1440, height: 900 },
      });
      expect(bundle.events.length).toBeGreaterThan(20);
      expect(bundle.meta.eventCount).toBe(bundle.events.length);
      expect(bundle.meta.duration).toBeGreaterThan(5000);
      expect(bundle.events.some((event) => event.type === 2)).toBe(true);
      expect(bundle.context).toMatchObject({
        app: { name: 'Demo shop' },
        test: { suite: 'checkout', case: 'rejects an unknown coupon' },
        sources: [
          { provider: 'github', ref: 'example-org/shop-demo#42', url: 'https://github.com/example-org/shop-demo/issues/42' },
          { provider: 'url', url: 'https://example.com/tickets/DEMO-1' },
        ],
      });
    });

    it('records the failed coupon request and the console error it caused', () => {
      const coupon = bundle.network.filter((entry) => entry.url.includes('/api/coupons/'));
      expect(coupon).toHaveLength(1);
      expect(coupon[0]).toMatchObject({ method: 'GET', status: 404 });
      expect(bundle.network.some((entry) => entry.url.endsWith('/api/products') && entry.status === 200)).toBe(true);
      expect(bundle.console.some((entry) => entry.level === 'error' && entry.message.includes('Coupon service answered 404'))).toBe(true);
      expect(bundle.console.some((entry) => entry.level === 'warn')).toBe(true);
    });

    it('labels the steps from the closed list, in order, on the replay clock', () => {
      expect(bundle.steps[0]).toMatchObject({ kind: 'open', at: 0 });
      // The scripted steps, plus the opening of the page.
      expect(bundle.steps).toHaveLength(scriptedSteps + 1);
      for (const step of bundle.steps) {
        expect(STEP_KINDS.has(step.kind)).toBe(true);
        expect(step.label.length).toBeGreaterThan(0);
        expect(step.at).toBeGreaterThanOrEqual(0);
        expect(step.at).toBeLessThanOrEqual(bundle.meta.duration + 1000);
      }
      expect(bundle.steps.map((step) => step.at)).toEqual(bundle.steps.map((step) => step.at).toSorted((a, b) => a - b));
      expect(bundle.steps.map((step) => step.label)).toContain('Apply the coupon');
      expect(bundle.steps.find((step) => step.kind === 'fill')).toMatchObject({ selector: '#email' });
    });

    it('masks typed input: the email appears nowhere in the bundle', () => {
      expect(raw).not.toContain(EMAIL);
      expect(raw).not.toContain('demo.shopper');
      // The typing was recorded, as masked text.
      const inputs = bundle.events.filter((event) => (event.data as { source?: number } | undefined)?.source === 5);
      expect(inputs.length).toBeGreaterThan(0);
      for (const event of inputs) {
        const text = (event.data as { text?: string }).text;
        expect(text).toMatch(/^\*+$/);
      }
      // The step that typed it names the field, never the value.
      expect(JSON.stringify(bundle.steps)).not.toContain('shopper');
      expect(bundle.meta.captured).not.toHaveProperty('inputs');
    });

    it('never stores the session cookie the server set, nor any cookie header', () => {
      // The browser really did send it back, so the test is not vacuous.
      expect(cookiesSeenByServer.some((cookie) => cookie.includes(COOKIE_VALUE))).toBe(true);
      expect(raw).not.toContain(COOKIE_VALUE);
      expect(bundle.network.length).toBeGreaterThan(3);
      for (const entry of bundle.network) {
        for (const header of [...entry.requestHeaders, ...entry.responseHeaders]) {
          expect(header.name.toLowerCase()).not.toMatch(/^(cookie|set-cookie)$/);
        }
        expect(Object.keys(entry).toSorted()).toEqual(
          ['at', 'duration', 'id', 'method', 'mimeType', 'requestHeaders', 'responseHeaders', 'status', 'statusText', 'url'].filter(
            (key) => key in entry,
          ),
        );
      }
    });

    it('uploaded the same bundle to the replay server', async () => {
      const stored = await store.load('demo-capture');
      expect(stored).toBeDefined();
      expect(stored!.meta.id).toBe('demo-capture');
      expect(stored!.events).toHaveLength(bundle.events.length);
      expect(stored!.network.map((entry) => entry.url)).toEqual(bundle.network.map((entry) => entry.url));
      expect(JSON.stringify(stored)).not.toContain(COOKIE_VALUE);
      expect(JSON.stringify(stored)).not.toContain(EMAIL);
    });
  },
  60_000,
);
