import { pluginPolicyHash } from '../shared/malleable-policy.ts';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { loadConfig, loadPluginSpec } from '../config/index.ts';
import { assertReplayBundle } from '../shared/replay.ts';
import { parsePluginFile } from '../shared/malleable.ts';
import type { ReplayBundle } from '../shared/replay.ts';
import { SANDBOX_CSP, SANDBOX_HTML, SANDBOX_PATH } from '../shared/sandbox-runtime.ts';
import { describeAuthAdapter, describeObjectStorage, fakeRequest } from '../server/testing/index.ts';
import type { TestRunner } from '../server/testing/runner.ts';
import { assertKey, type ObjectStorage } from '../server/storage/types.ts';
import { capSummaryFields } from '../server/summary-fields.ts';
import { resolvePlugins } from './registry.ts';
import { checkBrowserEntry, checkUserPlugin } from './check-browser.ts';

export const PLUGIN_CHECK_USAGE = `replays plugin check <file> [--replay fixture.json] [--config replays.config.ts]
  [--request request.json] [--kind server|browser|user] [--cdp http://127.0.0.1:9222] [--out screenshots-dir] [--headless] [--port 19081]

Server plugins run setup, fixture hooks and auth/storage contracts. Browser entries and
*.replays-plugin.json run against the fixture in an existing CDP browser, or a fresh local browser with --headless.
Without --replay, a small in-memory replay is used. Fixture writes are reported only.
Exit codes: 0 passed, 1 check failed, 2 invalid arguments.`;

export interface PluginCheckOptions {
  file: string;
  replay?: string;
  config?: string;
  request?: string;
  kind?: 'server' | 'browser' | 'user';
  cdp?: string;
  out?: string;
  port?: number;
  headless?: boolean;
}
export interface PluginCheckResult {
  kind: string;
  output: string[];
  errors: string[];
}
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function parseCheckArgs(argv: string[]): PluginCheckOptions {
  if (!argv[0] || argv[0].startsWith('-')) throw new Error('provide a plugin file');
  const options: PluginCheckOptions = { file: resolve(argv[0]) };
  for (let i = 1; i < argv.length; i += 2) {
    const flag = argv[i];
    if (flag === '--headless') {
      options.headless = true;
      i--;
      continue;
    }
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`${flag} needs a value`);
    if (flag === '--kind') {
      if (!['server', 'browser', 'user'].includes(value)) throw new Error('--kind must be server, browser or user');
      options.kind = value as PluginCheckOptions['kind'] & string;
    } else if (flag === '--replay') options.replay = resolve(value);
    else if (flag === '--config') options.config = resolve(value);
    else if (flag === '--request') options.request = resolve(value);
    else if (flag === '--cdp') options.cdp = value;
    else if (flag === '--out') options.out = resolve(value);
    else if (flag === '--port' && /^\d+$/.test(value) && Number(value) > 0 && Number(value) < 65536) options.port = Number(value);
    else throw new Error(`unknown option ${flag}`);
  }
  if (options.headless && options.cdp) throw new Error('--headless and --cdp are mutually exclusive');
  return options;
}

const fixtureReplay = (): ReplayBundle => ({
  meta: {
    id: 'plugin-check',
    title: 'Plugin check fixture',
    url: 'https://example.com/',
    capturedAt: '2026-01-01T00:00:00.000Z',
    duration: 1000,
    viewport: { width: 800, height: 600 },
    eventCount: 2,
    version: 1,
    source: 'agent',
  },
  events: [
    { type: 4, data: { href: 'https://example.com/', width: 800, height: 600 }, timestamp: 0 },
    { type: 2, data: { node: { type: 0, id: 1, childNodes: [] }, initialOffset: { top: 0, left: 0 } }, timestamp: 1 },
  ],
  steps: [],
  console: [],
  network: [],
});

/** Contract writes stay in a disposable namespace, including for an object-store backend. */
function isolatedStorage(storage: ObjectStorage, prefix: string): ObjectStorage {
  const key = (input: string) => {
    assertKey(input);
    return `${prefix}${input}`;
  };
  const info = (value: Awaited<ReturnType<ObjectStorage['write']>>) => ({ ...value, key: value.key.slice(prefix.length) });
  return {
    kind: storage.kind,
    description: storage.description,
    stat: async (input) => {
      const value = await storage.stat(key(input));
      return value ? info(value) : undefined;
    },
    read: (input) => storage.read(key(input)),
    stream: (input, range) => storage.stream(key(input), range),
    write: async (input, body, options) => info(await storage.write(key(input), body, options)),
    upload: async (input, file, options) => info(await storage.upload(key(input), file, options)),
    delete: (input) => storage.delete(key(input)),
    deletePrefix: (input) => storage.deletePrefix(input ? `${key(input.replace(/\/$/, ''))}${input.endsWith('/') ? '/' : ''}` : prefix),
    list: async (options) =>
      (
        await storage.list({ prefix: `${prefix}${options?.prefix ?? ''}`, ...(options?.glob ? { glob: `${prefix}${options.glob}` } : {}) })
      ).map(info),
  };
}

async function checkServer(options: PluginCheckOptions, replay: ReplayBundle, result: PluginCheckResult) {
  const loaded = options.config
    ? await loadConfig({ cwd: dirname(options.config), env: { ...process.env, REPLAYS_CONFIG: options.config } })
    : undefined;
  const plugin = await loadPluginSpec(options.file, dirname(options.file));
  const registry = await resolvePlugins([...(loaded?.plugins ?? []).filter((entry) => entry.name !== plugin.name), plugin]);
  result.output.push(`plugins: ${registry.order.join(', ')}`);
  const tests: Array<{ name: string; run: () => Promise<void> }> = [];
  const runner: TestRunner = {
    describe: (_name, body) => body(),
    it: (name, run) => {
      tests.push({ name, run: () => run() });
    },
  };
  const temp = await mkdtemp(join(tmpdir(), 'replays-plugin-check-'));
  const cleanup: Array<() => Promise<unknown>> = [];
  try {
    for (const [name, registration] of registry.storage) {
      result.output.push(`storage: ${name}`);
      describeObjectStorage(
        name,
        async () => {
          const store = await registration.value.create({ env: process.env, dataDir: temp });
          const prefix = `_plugin-check/${crypto.randomUUID()}/`;
          cleanup.push(() => store.deletePrefix(prefix));
          return isolatedStorage(store, prefix);
        },
        runner,
      );
    }
    const authRequest = options.request
      ? (JSON.parse(await readFile(options.request, 'utf8')) as import('../server/testing/auth.ts').FakeRequestInit)
      : {};
    for (const [name, registration] of registry.auth) {
      const adapter = await registration.value(process.env);
      const identity = await adapter.authenticate(fakeRequest(authRequest));
      describeAuthAdapter(
        name,
        {
          create: () => adapter,
          accepts: identity ? [{ title: 'fixture request', request: authRequest, id: identity.id }] : [],
          refuses: identity ? [] : [{ title: 'anonymous fixture', request: {} }],
        },
        runner,
      );
      if (!identity)
        result.output.push(
          `auth ${name}: provide --request request.json for an accepted identity; the generic contract will report the missing acceptance case`,
        );
    }
    const request = fakeRequest();
    const identity = { id: 'plugin-check', name: 'Plugin check' };
    for (const { plugin: owner, value } of registry.hooks.beforeUpload)
      tests.push({
        name: `${owner} beforeUpload fixture`,
        run: async () => {
          const transformed = await value({ bundle: structuredClone(replay), identity, request });
          if (transformed) assertReplayBundle(transformed);
        },
      });
    for (const { plugin: owner, value } of registry.summaryFields)
      tests.push({
        name: `${owner} summaryFields ${value.name}`,
        run: async () => {
          result.output.push(`${owner}/${value.name}: ${JSON.stringify(capSummaryFields(await value.fields(structuredClone(replay))))}`);
        },
      });
    for (const test of tests) {
      try {
        await test.run();
        result.output.push(`PASS ${test.name}`);
      } catch (error) {
        result.errors.push(`${test.name}: ${errorText(error)}`);
      }
    }
    for (const entry of registry.clientEntries) result.output.push(`client: ${entry.plugin}/${entry.id} ${entry.script}`);
    if (!tests.length) result.output.push('PASS setup (no fixture hooks or adapter contracts registered)');
  } finally {
    for (const clean of cleanup) await clean().catch((error: unknown) => result.errors.push(`cleanup: ${errorText(error)}`));
    await rm(temp, { recursive: true, force: true });
  }
}

async function checkBrowser(
  options: PluginCheckOptions,
  replay: ReplayBundle,
  result: PluginCheckResult,
  file?: ReturnType<typeof parsePluginFile>,
) {
  const viewerEntry = [resolve(import.meta.dirname, '../client/plugins/api.ts'), resolve(import.meta.dirname, '../lib/viewer.mjs')].find(
    existsSync,
  );
  if (!viewerEntry) throw new Error('cannot locate the viewer API; build the package before checking browser entries');
  const contents = file
    ? `(${checkUserPlugin.toString()})(${JSON.stringify(file)});`
    : `import entry from ${JSON.stringify(options.file)}; import {ViewerRegistry} from ${JSON.stringify(viewerEntry)}; (${checkBrowserEntry.toString()})(entry,ViewerRegistry);`;
  const compiled = await build({
    stdin: { contents, resolveDir: dirname(options.file), loader: 'js' },
    alias: { '@hazem3500/replays/viewer': viewerEntry },
    bundle: true,
    platform: 'browser',
    format: 'esm',
    write: false,
    logLevel: 'silent',
  });
  const server = createServer((request, response) => {
    if (request.url === SANDBOX_PATH) {
      response.writeHead(200, { 'content-type': 'text/html', 'content-security-policy': SANDBOX_CSP });
      response.end(SANDBOX_HTML);
    } else if (request.url === '/fixture.json') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(replay));
    } else if (request.url === '/entry.js') {
      response.writeHead(200, { 'content-type': 'text/javascript' });
      response.end(compiled.outputFiles[0]!.text);
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
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', resolveListen);
  });
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
  try {
    browser = options.headless
      ? await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage', '--disable-gpu', '--disable-webgl'] })
      : await chromium.connectOverCDP(options.cdp ?? process.env.REPLAYS_PLUGIN_CDP ?? 'http://127.0.0.1:9222', { timeout: 5000 });
    const context = await browser.newContext({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 1 });
    try {
      const page = await context.newPage();
      page.on('pageerror', (error) => result.errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') result.errors.push(message.text());
        else result.output.push(message.text());
      });
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('check server did not bind');
      const origin = `http://127.0.0.1:${address.port}`;
      await context.route('**/*', (route) => (route.request().url().startsWith(`${origin}/`) ? route.continue() : route.abort()));
      await page.goto(`${origin}/`);
      await page.waitForFunction(() => (window as unknown as { __pluginCheck?: { done: boolean } }).__pluginCheck?.done, undefined, {
        timeout: 30_000,
      });
      const report = await page.evaluate(
        () => (window as unknown as { __pluginCheck: { output: string[]; errors: string[] } }).__pluginCheck,
      );
      result.output.push(...report.output);
      result.errors.push(...report.errors);
      if (options.out) {
        const { mkdir } = await import('node:fs/promises');
        await mkdir(options.out, { recursive: true });
        const items = page.locator('[data-slot-item], iframe');
        const count = Math.min(await items.count(), 8);
        if (!count) {
          const path = join(options.out, 'plugin-check.png');
          await page.screenshot({ path });
          result.output.push(`screenshot: ${path}`);
        }
        for (let i = 0; i < count; i++) {
          const path = join(options.out, `slot-${i + 1}.png`);
          await items.nth(i).screenshot({ path });
          result.output.push(`screenshot: ${path}`);
        }
      }
    } finally {
      await context.close();
    }
  } finally {
    await browser?.close();
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  }
}

export async function checkPlugin(options: PluginCheckOptions): Promise<PluginCheckResult> {
  const result: PluginCheckResult = {
    kind: options.kind ?? (options.file.endsWith('.replays-plugin.json') ? 'user' : 'server'),
    output: [],
    errors: [],
  };
  try {
    const replay: unknown = options.replay ? JSON.parse(await readFile(options.replay, 'utf8')) : fixtureReplay();
    assertReplayBundle(replay);
    if (result.kind === 'user') {
      const file = parsePluginFile(JSON.parse(await readFile(options.file, 'utf8')));
      result.output.push(`policy-sha256: ${await pluginPolicyHash(file.manifest, file.source)}`);
      await checkBrowser(options, replay, result, file);
    } else if (result.kind === 'browser') await checkBrowser(options, replay, result);
    else {
      const loaded = (await import(pathToFileURL(options.file).href)) as { default?: unknown };
      if (!options.kind && typeof loaded.default === 'function' && 'apiVersion' in loaded.default) {
        result.kind = 'browser';
        await checkBrowser(options, replay, result);
      } else await checkServer(options, replay, result);
    }
  } catch (error) {
    result.errors.push(errorText(error));
  }
  return result;
}

export async function runPluginCheckCli(argv: string[]) {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(`${PLUGIN_CHECK_USAGE}\n`);
    return;
  }
  let options: PluginCheckOptions;
  try {
    options = parseCheckArgs(argv);
  } catch (error) {
    process.stderr.write(`${errorText(error)}\n${PLUGIN_CHECK_USAGE}\n`);
    process.exitCode = 2;
    return;
  }
  const result = await checkPlugin(options);
  for (const line of result.output) process.stdout.write(`${line}\n`);
  for (const line of result.errors) process.stderr.write(`ERROR ${line}\n`);
  process.stdout.write(`${result.errors.length ? 'FAIL' : 'PASS'} ${result.kind} plugin check\n`);
  if (result.errors.length) process.exitCode = 1;
}
