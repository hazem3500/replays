import { pluginPolicyHash } from '../shared/malleable-policy.ts';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig, loadPluginSpec } from '../config/index.ts';
import { assertReplayBundle } from '../shared/replay.ts';
import { parsePluginFile } from '../shared/malleable.ts';
import { isRecord } from '../shared/plugin-validation.ts';
import { checkBrowser } from './check-browser-host.ts';
import { toNodeAuthAdapter } from '../server/auth/web.ts';
import type { FakeRequestInit } from '../server/testing/auth.ts';
import type { PluginRegistry } from './registry.ts';
import type { ReplayBundle } from '../shared/replay.ts';
import { describeAuthAdapter, describeObjectStorage, fakeRequest } from '../server/testing/index.ts';
import type { TestRunner } from '../server/testing/runner.ts';
import { assertKey, type ObjectStorage } from '../server/storage/types.ts';
import { capSummaryFields } from '../server/summary-fields.ts';
import { resolvePlugins } from './registry.ts';

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
    applyFlag(options, flag, value);
  }
  if (options.headless && options.cdp) throw new Error('--headless and --cdp are mutually exclusive');
  return options;
}

function applyFlag(options: PluginCheckOptions, flag: string | undefined, value: string): void {
  const next = options;
  if (flag === '--kind') {
    if (value !== 'server' && value !== 'browser' && value !== 'user') throw new Error('--kind must be server, browser or user');
    next.kind = value;
  } else if (flag === '--replay') next.replay = resolve(value);
  else if (flag === '--config') next.config = resolve(value);
  else if (flag === '--request') next.request = resolve(value);
  else if (flag === '--cdp') next.cdp = value;
  else if (flag === '--out') next.out = resolve(value);
  else if (flag === '--port' && /^\d+$/.test(value) && Number(value) > 0 && Number(value) < 65536) next.port = Number(value);
  else throw new Error(`unknown option ${flag}`);
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

interface FixtureTest {
  name: string;
  run: () => Promise<void>;
}
function registerFixtureChecks(
  registry: PluginRegistry,
  replay: ReplayBundle,
  state: { tests: FixtureTest[]; result: PluginCheckResult },
): void {
  const { tests, result } = state;
  const request = fakeRequest();
  const webRequest = new Request('http://localhost/');
  const identity = { id: 'plugin-check', name: 'Plugin check' };
  for (const { plugin: owner, value } of registry.hooks.beforeUpload)
    tests.push({
      name: `${owner} beforeUpload fixture`,
      run: async () => {
        const transformed = await value({ bundle: structuredClone(replay), identity, request, webRequest });
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
}
function parseAuthFixture(value: unknown): FakeRequestInit {
  if (!isRecord(value)) throw new TypeError('request fixture must be an object');
  const result: FakeRequestInit = {};
  for (const key of ['method', 'url', 'remoteAddress'] as const) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== 'string') throw new TypeError(`request fixture ${key} must be a string`);
    result[key] = value[key];
  }
  if (value.headers !== undefined) {
    if (!isRecord(value.headers)) throw new TypeError('request fixture headers must be an object');
    const headers: NonNullable<FakeRequestInit['headers']> = {};
    for (const [key, header] of Object.entries(value.headers)) {
      if (typeof header === 'string' || header === undefined) headers[key] = header;
      else if (Array.isArray(header) && header.every((part: unknown): part is string => typeof part === 'string')) headers[key] = header;
      else throw new TypeError('request fixture headers must contain strings');
    }
    result.headers = headers;
  }
  return result;
}

async function checkServer(options: PluginCheckOptions, replay: ReplayBundle, result: PluginCheckResult, env: NodeJS.ProcessEnv) {
  const loaded = options.config
    ? await loadConfig({ cwd: dirname(options.config), env: { ...env, REPLAYS_CONFIG: options.config } })
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
          const store = await registration.value.create({ env, dataDir: temp });
          const prefix = `_plugin-check/${crypto.randomUUID()}/`;
          cleanup.push(() => store.deletePrefix(prefix));
          return isolatedStorage(store, prefix);
        },
        runner,
      );
    }
    const authRequest = options.request ? parseAuthFixture(JSON.parse(await readFile(options.request, 'utf8'))) : {};
    for (const [name, registration] of registry.auth) {
      const adapter = await registration.value(env);
      const identity = await toNodeAuthAdapter(adapter).authenticate(fakeRequest(authRequest));
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
    registerFixtureChecks(registry, replay, { tests, result });
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

export async function checkPlugin(options: PluginCheckOptions, env: NodeJS.ProcessEnv = {}): Promise<PluginCheckResult> {
  const browserOptions = {
    ...options,
    ...(env.REPLAYS_PLUGIN_CDP && !options.cdp ? { cdp: env.REPLAYS_PLUGIN_CDP } : {}),
    ...(env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
    noSandbox: env.CHROMIUM_NO_SANDBOX === '1',
  };
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
      await checkBrowser(browserOptions, replay, result, file);
    } else if (result.kind === 'browser') await checkBrowser(browserOptions, replay, result);
    else {
      const loaded: unknown = await import(pathToFileURL(options.file).href);
      if (!options.kind && isRecord(loaded) && typeof loaded.default === 'function' && 'apiVersion' in loaded.default) {
        result.kind = 'browser';
        await checkBrowser(browserOptions, replay, result);
      } else await checkServer(options, replay, result, env);
    }
  } catch (error) {
    result.errors.push(errorText(error));
  }
  return result;
}

export async function runPluginCheckCli(argv: string[], env: NodeJS.ProcessEnv = {}): Promise<void> {
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
  const result = await checkPlugin(options, env);
  for (const line of result.output) process.stdout.write(`${line}\n`);
  for (const line of result.errors) process.stderr.write(`ERROR ${line}\n`);
  process.stdout.write(`${result.errors.length ? 'FAIL' : 'PASS'} ${result.kind} plugin check\n`);
  if (result.errors.length) process.exitCode = 1;
}
