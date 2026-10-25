import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ViewerPluginError, ViewerRegistry } from '../src/client/plugins/registry.ts';
import { buildIndexEntries, filtersFromSearch, searchFromFilters } from '../src/client/ReplayIndex.tsx';
import { definePlugin, PluginError, resolvePlugins, SUMMARY_FIELD_LIMITS, type PluginApi } from '../src/plugin/index.ts';
import { createApp } from '../src/server/app.ts';
import { ReplayStore } from '../src/server/store.ts';
import { applyIndexFilters, capSummaryFields, summaryFieldsRunner } from '../src/server/summary-fields.ts';
import type { ReplaySummary } from '../src/shared/replay.ts';
import type { ReviewSuiteIndexEntry } from '../src/shared/review-suite.ts';
import { appDefaults, replay } from './fixtures.ts';

const plugin = (name: string, setup: (api: PluginApi) => void) => definePlugin({ name, setup });
const match = () => true;
const render = () => {};

async function start(plugins: ReturnType<typeof plugin>[], root?: string) {
  root ??= await mkdtemp(join(tmpdir(), 'replays-index-slots-'));
  await mkdir(join(root, 'client'), { recursive: true });
  await writeFile(join(root, 'client', 'index.html'), '<!doctype html><title>x</title>');
  const registry = await resolvePlugins(plugins);
  const summaryFields = summaryFieldsRunner(registry.summaryFields);
  const store = new ReplayStore(join(root, 'data'), join(root, 'sample'), undefined, summaryFields ? { summaryFields } : {});
  const handle = createApp({ ...appDefaults(), store, clientDir: join(root, 'client'), plugins: registry });
  const server = createServer((request, response) => void handle(request, response));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  return { origin: `http://127.0.0.1:${address.port}`, store, root };
}

const acme = (version = 1) =>
  plugin('acme', (api) => {
    api.summaryFields({ name: 'build', version, fields: (bundle) => ({ env: bundle.meta.title.split(' ')[0]!, version }) });
    api.indexFilter({ id: 'env', param: 'x-env', match: (summary, value) => summary.ext?.acme?.env === value });
  });

const summaryOf = (id: string) =>
  ({
    ...replay(id).meta,
    id,
    host: 'example.com',
    steps: 1,
    consoleErrors: 0,
    failedRequests: 0,
    source: 'agent',
  }) as unknown as ReplaySummary;

const runOf = (id: string, sequence: number) => ({
  id,
  sequence,
  label: id,
  status: 'passed',
  startedAt: '2026-10-06T00:00:00.000Z',
  replayId: id,
  replay: summaryOf(id),
});

const servers: Array<ReturnType<typeof createServer>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe('summary field caps', () => {
  it('keeps strings, finite numbers, booleans and null; nothing is nothing', () => {
    expect(capSummaryFields({ env: 'prod', count: 3, ok: true, none: null })).toEqual({ env: 'prod', count: 3, ok: true, none: null });
    expect(capSummaryFields(undefined)).toBeUndefined();
    expect(capSummaryFields(null)).toBeUndefined();
  });

  it('cuts strings to 200 characters, without splitting a surrogate pair', () => {
    expect(capSummaryFields({ long: 'x'.repeat(500) })!.long).toHaveLength(SUMMARY_FIELD_LIMITS.stringLength);
    const emoji = `${'x'.repeat(199)}😀`;
    expect(capSummaryFields({ emoji })!.emoji).toBe('x'.repeat(199));
  });

  it('refuses more than 20 keys, more than 2 KB, bad keys and other values', () => {
    const many = Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`k${index}`, index]));
    expect(() => capSummaryFields(many)).toThrow(/21 keys; at most 20/);
    expect(capSummaryFields(Object.fromEntries(Object.entries(many).slice(0, 20)))).toBeDefined();
    const big = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`k${index}`, 'y'.repeat(200)]));
    expect(() => capSummaryFields(big)).toThrow(/bytes of JSON; at most 2048/);
    expect(() => capSummaryFields({ __proto__x: 1 })).toThrow(/must match/);
    expect(() => capSummaryFields({ 'has space': 1 })).toThrow(/must match/);
    expect(() => capSummaryFields({ nested: { a: 1 } })).toThrow(/string, finite number, boolean or null/);
    expect(() => capSummaryFields({ nan: Number.NaN })).toThrow(/finite number/);
    expect(() => capSummaryFields(['a'])).toThrow(/an object/);
    expect(() => capSummaryFields('text')).toThrow(/an object/);
  });

  it('merges a plugin’s sets, leaves out a throwing or oversized one, and logs it', async () => {
    const registry = await resolvePlugins([
      plugin('acme', (api) => {
        api.summaryFields({ name: 'one', fields: (bundle) => ({ title: bundle.meta.title }) });
        api.summaryFields({
          name: 'broken',
          fields: () => {
            throw new Error('boom');
          },
        });
        api.summaryFields({ name: 'again', version: 2, fields: () => ({ title: 'repeated' }) });
        api.summaryFields({ name: 'two', fields: async () => ({ steps: 1 }) });
      }),
      plugin('other', (api) => api.summaryFields({ name: 'x', fields: () => undefined })),
    ]);
    const log = vi.fn<(message: string, error?: unknown) => void>();
    const runner = summaryFieldsRunner(registry.summaryFields, log)!;
    expect(runner.version).toBe('acme/one@1,acme/broken@1,acme/again@2,acme/two@1,other/x@1');
    expect(await runner.derive(replay('r1'))).toEqual({ acme: { title: 'Test replay', steps: 1 } });
    expect(log.mock.calls.map(([message]) => message)).toEqual([
      expect.stringContaining('plugin acme: summaryFields broken (replay r1) failed'),
      expect.stringContaining('key "title" is already set'),
    ]);
    expect(summaryFieldsRunner([])).toBeUndefined();
  });
});

describe('registering index slots on the server', () => {
  it('collects summary fields and index filters, tagged with their plugin', async () => {
    const registry = await resolvePlugins([
      plugin('acme', (api) => {
        api.summaryFields({ name: 'build', fields: () => ({}) });
        api.indexFilter({ id: 'env', param: 'x-env', match: () => true });
      }),
    ]);
    expect(registry.summaryFields.map((entry) => [entry.plugin, entry.value.name])).toEqual([['acme', 'build']]);
    expect(registry.indexFilters.map((entry) => [entry.plugin, entry.value.param])).toEqual([['acme', 'x-env']]);
  });

  it('refuses params that are not `x-*` (so never a core param), and a param or name taken twice', async () => {
    const refuse = async (setup: (api: PluginApi) => void, code: string, message: RegExp) => {
      const error = await resolvePlugins([plugin('acme', setup)]).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(PluginError);
      expect(error).toMatchObject({ code, plugin: 'acme' });
      expect((error as Error).message).toMatch(message);
    };
    for (const param of ['q', 'host', 'tag', 'errors', 'source', 'kind', 'sort', 'x-', 'X-env', 'x-Env', 'x_env', `x-${'a'.repeat(40)}`])
      await refuse((api) => api.indexFilter({ id: 'env', param, match }), 'invalid-registration', /param must look like "x-env"/);
    await refuse((api) => api.indexFilter({ id: 'Env', param: 'x-env', match }), 'invalid-registration', /needs an id/);
    await refuse((api) => api.indexFilter({ id: 'env', param: 'x-env' } as never), 'invalid-registration', /match must be a function/);
    await refuse(
      (api) => {
        api.indexFilter({ id: 'env', param: 'x-env', match });
        api.indexFilter({ id: 'env', param: 'x-other', match });
      },
      'conflict',
      /registered twice/,
    );
    await refuse((api) => api.summaryFields({ name: 'b', version: 0, fields: () => ({}) }), 'invalid-registration', /positive integer/);
    await refuse(
      (api) => {
        api.summaryFields({ name: 'b', fields: () => ({}) });
        api.summaryFields({ name: 'b', fields: () => ({}) });
      },
      'conflict',
      /registered twice/,
    );
    const clash = await resolvePlugins([
      plugin('one', (api) => api.indexFilter({ id: 'env', param: 'x-env', match })),
      plugin('two', (api) => api.indexFilter({ id: 'env', param: 'x-env', match })),
    ]).catch((caught: unknown) => caught);
    expect(clash).toMatchObject({ code: 'conflict', plugin: 'two', message: expect.stringContaining('already registered by one') });
  });

  it('filters summaries by the params present; a throwing match is no match', async () => {
    const registry = await resolvePlugins([
      plugin('acme', (api) => {
        api.indexFilter({ id: 'env', param: 'x-env', match: (summary, value) => summary.ext?.acme?.env === value });
        api.indexFilter({
          id: 'broken',
          param: 'x-broken',
          match: () => {
            throw new Error('nope');
          },
        });
      }),
    ]);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const summaries = [
      { id: 'a', ext: { acme: { env: 'prod' } } },
      { id: 'b', ext: { acme: { env: 'staging' } } },
      { id: 'c' },
    ] as unknown as ReplaySummary[];
    const ids = (search: string) => applyIndexFilters(registry.indexFilters, new URLSearchParams(search), summaries).map((s) => s.id);
    expect(ids('')).toEqual(['a', 'b', 'c']);
    expect(ids('x-env=%20prod%20')).toEqual(['a']);
    expect(ids('x-env=')).toEqual(['a', 'b', 'c']);
    expect(ids('x-unknown=1')).toEqual(['a', 'b', 'c']);
    expect(ids('x-broken=1')).toEqual([]);
    expect(error).toHaveBeenCalledTimes(1);
  });
});

describe('summary fields in the store and the API', () => {
  it('derives the fields at upload into summary.ext, filters on them, and lists the filter in /api/config', async () => {
    const { origin, store } = await start([acme()]);
    for (const [id, title] of [
      ['prod-1', 'prod checkout'],
      ['stage-1', 'staging checkout'],
    ] as const)
      await store.save({ ...replay(id), meta: { ...replay(id).meta, title } });
    const list = (await (await fetch(`${origin}/api/replays`)).json()) as ReplaySummary[];
    expect(list.find((summary) => summary.id === 'prod-1')).toMatchObject({
      ext: { acme: { env: 'prod', version: 1 } },
      extVersion: 'acme/build@1',
    });
    const filtered = (await (await fetch(`${origin}/api/replays?x-env=prod`)).json()) as ReplaySummary[];
    expect(filtered.map((summary) => summary.id)).toEqual(['prod-1']);
    // Core filters still apply first.
    expect(await (await fetch(`${origin}/api/replays?x-env=prod&q=nothing`)).json()).toEqual([]);
    const config = await (await fetch(`${origin}/api/config`)).json();
    expect(config.indexFilters).toEqual([{ plugin: 'acme', id: 'env', param: 'x-env' }]);
  });

  it('rebuilds stored summaries when the summary fields change, and drops ext when none are registered', async () => {
    const first = await start([acme(1)]);
    await first.store.save(replay('r1'));
    const meta = async () => JSON.parse(await readFile(join(first.root, 'data', 'r1', 'meta.json'), 'utf8')) as ReplaySummary;
    expect((await meta()).ext).toEqual({ acme: { env: 'Test', version: 1 } });

    const second = await start([acme(2)], first.root);
    expect((await second.store.summary('r1'))?.ext).toEqual({ acme: { env: 'Test', version: 2 } });
    expect((await meta()).extVersion).toBe('acme/build@2');

    const third = await start([], first.root);
    const [summary] = await third.store.list();
    expect(summary).toMatchObject({ id: 'r1' });
    expect(summary).not.toHaveProperty('ext');
    expect(summary).not.toHaveProperty('extVersion');
  });
});

describe('index slots in the browser', () => {
  it('carries `x-*` params through the URL, sorted, ignoring anything else', () => {
    const filters = filtersFromSearch('?x-env=%20prod%20&tag=smoke&x-area=checkout&x-env=other&X-bad=1&x-=1&x-empty=');
    expect(filters).toEqual({ tag: 'smoke', params: { 'x-env': 'prod', 'x-area': 'checkout' } });
    expect(searchFromFilters(filters)).toBe('?tag=smoke&x-area=checkout&x-env=prod');
    expect(filtersFromSearch('?q=a')).toEqual({ q: 'a' });
  });

  it('with a plugin filter on, a suite keeps only the runs the server listed', () => {
    const suite = {
      id: 's1',
      title: 'Suite',
      createdAt: '2026-10-06T00:00:00.000Z',
      runDetails: [runOf('a', 1), runOf('b', 2)],
    } as unknown as ReviewSuiteIndexEntry;
    const entries = buildIndexEntries([summaryOf('a')], [suite], { params: { 'x-env': 'prod' } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: 'suite', matchedBySuite: false, hiddenRuns: 1 });
    expect(entries[0]!.kind === 'suite' && entries[0]!.runs.map((entry) => entry.id)).toEqual(['a']);
    expect(buildIndexEntries([], [suite], { params: { 'x-env': 'prod' } })).toEqual([]);
    expect(buildIndexEntries([], [suite], {})[0]).toMatchObject({ kind: 'suite', matchedBySuite: true });
  });

  it('registers columns, filters and sections, and checks a filter’s type, param and options', () => {
    const registry = new ViewerRegistry();
    const api = registry.apiFor('acme');
    api.registerIndexColumn({ id: 'env', label: 'Environment', render });
    api.registerIndexFilter({
      id: 'env',
      label: 'Environment',
      type: 'choice',
      param: 'x-env',
      options: [{ value: 'prod', label: 'Production' }],
    });
    api.registerIndexFilter({ id: 'mine', label: 'Mine', type: 'switch', param: 'x-mine' });
    api.registerIndexSection({ id: 'mine', title: 'For you', render, update: () => {} });
    const snapshot = registry.getSnapshot();
    expect(snapshot.columns.map((entry) => entry.key)).toEqual(['plugin:acme:env']);
    expect(snapshot.filters.map((entry) => entry.key)).toEqual(['plugin:acme:env', 'plugin:acme:mine']);
    expect(snapshot.sections.map((entry) => entry.key)).toEqual(['plugin:acme:mine']);

    const filter = (definition: object) => () =>
      registry.apiFor('other').registerIndexFilter({ id: 'f', label: 'F', type: 'switch', param: 'x-f', ...definition } as never);
    expect(filter({ param: 'tag' })).toThrow(ViewerPluginError);
    expect(filter({ param: 'x-env' })).toThrow(/already taken/);
    expect(filter({ type: 'range' })).toThrow(/type must be/);
    expect(filter({ type: 'choice' })).toThrow(/needs options/);
    expect(filter({ type: 'choice', options: [{ value: '', label: 'Empty' }] })).toThrow(/a value and a label/);
    expect(() => registry.apiFor('other').registerIndexColumn({ id: 'c', label: 'C' } as never)).toThrow(/needs a render function/);
    expect(() => registry.apiFor('other').registerIndexSection({ id: 's', title: 'S', render, update: 1 } as never)).toThrow(
      /update must be a function/,
    );

    registry.removePlugin('acme');
    expect(registry.getSnapshot()).toMatchObject({ columns: [], filters: [], sections: [] });
  });
});
