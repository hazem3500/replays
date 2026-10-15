import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { InMemorySpanExporter, type ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/server/app.ts';
import { RenderQueue } from '../src/server/render-queue.ts';
import { FsStorage, MemoryStorage } from '../src/server/storage/index.ts';
import { tracedStorage } from '../src/server/storage/traced.ts';
import { ReplayStore } from '../src/server/store.ts';
import { createTracing } from '../src/server/tracing-sdk.ts';
import {
  httpRoute,
  initTracing,
  NOOP_SPAN,
  setTracingImpl,
  shutdownTracing,
  traceHeaders,
  tracingEnabled,
  tracingRequested,
  withSpan,
} from '../src/server/tracing.ts';
import { appDefaults, replay } from './fixtures.ts';

const root = resolve(import.meta.dirname, '..');

/** No identity, query string, URL, header or token anywhere in the exported attributes. */
function expectNoPii(list: ReadableSpan[]) {
  for (const span of list) {
    expect(span.name).not.toMatch(/[?@]/);
    for (const [key, value] of Object.entries(span.attributes)) {
      expect(key).not.toMatch(/header|cookie|token|authorization|url\.(full|query)|user|email|title/i);
      expect(String(value)).not.toMatch(/@|\?|secret|https?:|Bearer/);
    }
  }
}

describe('route templates', () => {
  it('names spans by template, with ids as attributes and never free text', () => {
    expect(httpRoute('/api/replays/abc-123')).toEqual({ route: '/api/replays/:id', replayId: 'abc-123' });
    expect(httpRoute('/api/replays/import')).toEqual({ route: '/api/replays/import' });
    expect(httpRoute('/api/replays')).toEqual({ route: '/api/replays' });
    expect(httpRoute('/api/replays/abc/render/file')).toEqual({ route: '/api/replays/:id/render/file', replayId: 'abc' });
    expect(httpRoute('/api/replays/abc/poster').route).toBe('/api/replays/:id/poster');
    expect(httpRoute('/api/suites/s1/runs/Run-2')).toEqual({
      route: '/api/suites/:id/runs/:runId',
      suiteId: 's1',
      runId: 'Run-2',
    });
    expect(httpRoute('/api/suites/s1/keep')).toEqual({ route: '/api/suites/:id/keep', suiteId: 's1' });
    expect(httpRoute('/api/whatever/someone@example.com').route).toBe('/api/*');
    expect(httpRoute('/assets/index-abc.js').route).toBe('/assets/:file');
    expect(httpRoute('/r/some-replay').route).toBe('/r/:id');
    expect(httpRoute('/s/suite/r/some-replay').route).toBe('/s/:suite/r/:id');
    expect(httpRoute('/').route).toBe('/');
    expect(httpRoute('/some/page').route).toBe('/*');
    expect(httpRoute('/internal/render/abc/bundle.json')).toEqual({ route: '/internal/render/:id/bundle.json', replayId: 'abc' });
    expect(httpRoute('/internal/render/assets/main.js').route).toBe('/internal/render/assets/:file');
    // Invalid ids (uppercase, emails) are never echoed into the template or attributes.
    expect(httpRoute('/api/replays/Not_An_Id')).toEqual({ route: '/api/*' });
  });
});

describe('tracing off (unconfigured)', () => {
  it('is requested only by an OTLP endpoint or an explicit exporter', () => {
    expect(tracingRequested({})).toBe(false);
    expect(tracingRequested({ OTEL_EXPORTER_OTLP_ENDPOINT: ' ' })).toBe(false);
    expect(tracingRequested({ OTEL_SERVICE_NAME: 'x', OTEL_TRACES_SAMPLER: 'always_on' })).toBe(false);
    expect(tracingRequested({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://tempo:4317' })).toBe(true);
    expect(tracingRequested({ OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://tempo:4318/v1/traces' })).toBe(true);
    expect(tracingRequested({ OTEL_TRACES_EXPORTER: 'console' })).toBe(true);
    expect(tracingRequested({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://tempo:4317', OTEL_SDK_DISABLED: 'true' })).toBe(false);
    expect(tracingRequested({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://tempo:4317', OTEL_TRACES_EXPORTER: 'none' })).toBe(false);
  });

  it('runs callbacks directly, leaves storage unwrapped and loads nothing', async () => {
    await expect(initTracing({})).resolves.toBeUndefined();
    expect(tracingEnabled()).toBe(false);
    const result = withSpan('x', { a: 1 }, (span) => {
      expect(span).toBe(NOOP_SPAN);
      return 42;
    });
    // Sync stays sync: no promise, no wrapper.
    expect(result).toBe(42);
    const storage = new MemoryStorage();
    expect(tracedStorage(storage)).toBe(storage);
    expect(traceHeaders()).toEqual({});
  });

  it('never imports the SDK when tracing is off', async () => {
    // The facade has no OpenTelemetry imports of its own; only tracing-sdk.ts does, loaded on demand.
    const facade = await readFile(join(root, 'src/server/tracing.ts'), 'utf8');
    expect(facade).not.toMatch(/from '@opentelemetry/);
    // A fresh process that starts tracing unconfigured and serves a request: the OpenTelemetry API never
    // registers its process-wide state, which the SDK always does on start.
    const script = `
      import { createServer } from 'node:http';
      import { initTracing, traceRequest, withSpan } from './src/server/tracing.ts';
      import { tracedStorage } from './src/server/storage/traced.ts';
      import { MemoryStorage } from './src/server/storage/index.ts';
      await initTracing({});
      const storage = tracedStorage(new MemoryStorage());
      await storage.write('a/replay.json', '{}');
      const server = createServer((request, response) => void traceRequest(request, response, '/api/replays/a', async () => {
        await withSpan('x', {}, () => storage.read('a/replay.json'));
        response.end('ok');
      }));
      await new Promise((done) => server.listen(0, '127.0.0.1', done));
      await (await fetch('http://127.0.0.1:' + server.address().port)).text();
      server.close();
      const loaded = Object.getOwnPropertySymbols(globalThis).some((symbol) => String(symbol).includes('opentelemetry'));
      console.log(JSON.stringify({ loaded }));
    `;
    const child = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', '--input-type=module', '-e', script], {
      cwd: root,
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '' },
    });
    expect(child.stderr).toBe('');
    expect(JSON.parse(child.stdout.trim().split('\n').at(-1)!)).toEqual({ loaded: false });
  });
});

describe('tracing on (in-memory exporter)', () => {
  let exporter: InMemorySpanExporter;
  const servers: Array<ReturnType<typeof createServer>> = [];

  beforeEach(() => {
    exporter = new InMemorySpanExporter();
    setTracingImpl(createTracing({}, { exporter }));
  });

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((done) => server.close(() => done()))));
    await shutdownTracing();
  });

  async function start() {
    const dir = await mkdtemp(join(tmpdir(), 'replays-tracing-'));
    const store = new ReplayStore(tracedStorage(new FsStorage(join(dir, 'data'))), join(dir, 'sample'));
    const handle = createApp({
      ...appDefaults(),
      store,
      clientDir: join(dir, 'client'),
    });
    const server = createServer((request, response) => void handle(request, response));
    servers.push(server);
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server has no port');
    return { origin: `http://127.0.0.1:${address.port}`, store };
  }

  const spans = () => exporter.getFinishedSpans();
  const named = (name: string) => spans().filter((span) => span.name === name);

  it('makes a server span per request named by route template, continuing the caller trace', async () => {
    const { origin } = await start();
    const traceId = '4bf92f3577b34da6a3ce929b0e0e4736';
    const upload = await fetch(`${origin}/api/replays?token=secret`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        traceparent: `00-${traceId}-00f067aa0ba902b7-01`,
        authorization: 'Bearer secret',
        cookie: 'session=secret',
      },
      body: JSON.stringify(replay('traced-replay')),
    });
    expect(upload.status).toBe(201);
    const read = await fetch(`${origin}/api/replays/traced-replay?q=someone@example.com`);
    expect(read.status).toBe(200);
    await read.text();
    await vi.waitFor(() => expect(named('GET /api/replays/:id')).toHaveLength(1));

    const [post] = named('POST /api/replays');
    expect(post).toBeDefined();
    expect(post!.spanContext().traceId).toBe(traceId);
    expect(post!.parentSpanContext?.spanId).toBe('00f067aa0ba902b7');
    expect(post!.attributes).toMatchObject({
      'http.request.method': 'POST',
      'http.route': '/api/replays',
      'http.response.status_code': 201,
      'replay.id': 'traced-replay',
      'replay.event_count': replay().events.length,
    });
    expect(post!.attributes['http.request.body.size']).toBeGreaterThan(0);
    // Children of the upload: the privacy pass and the storage writes, in the caller's trace.
    const children = spans().filter((span) => span.parentSpanContext?.spanId === post!.spanContext().spanId);
    expect(children.map((span) => span.name)).toEqual(expect.arrayContaining(['replay.parse', 'replay.sanitize', 'storage.write']));
    const write = children.find((span) => span.name === 'storage.write')!;
    expect(write.attributes).toMatchObject({ 'storage.system': 'fs', 'storage.key': expect.stringMatching(/^traced-replay\//) });

    const [get] = named('GET /api/replays/:id');
    expect(get!.attributes).toMatchObject({
      'http.route': '/api/replays/:id',
      'replay.id': 'traced-replay',
      'http.response.status_code': 200,
    });
    expect(get!.spanContext().traceId).not.toBe(traceId);
    expectNoPii(spans());
  });

  it('hands the active trace to loopback requests (the render page)', () => {
    expect(traceHeaders()).toEqual({});
    const headers = withSpan('render.job', {}, () => traceHeaders());
    const [job] = named('render.job');
    expect(headers.traceparent).toBe(`00-${job!.spanContext().traceId}-${job!.spanContext().spanId}-01`);
  });

  it('does not trace health checks', async () => {
    const { origin } = await start();
    expect((await fetch(`${origin}/healthz`)).status).toBe(200);
    expect((await fetch(origin)).status).toBe(200);
    expect(spans().filter((span) => span.kind === 1)).toEqual([]);
  });

  it('marks 5xx responses as errors with an error type, not the message', async () => {
    const { origin, store } = await start();
    vi.spyOn(store, 'list').mockRejectedValueOnce(Object.assign(new Error('boom at someone@example.com'), { code: 'EACCES' }));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await fetch(`${origin}/api/replays`)).status).toBe(500);
    await vi.waitFor(() => expect(named('GET /api/replays')).toHaveLength(1));
    const [span] = named('GET /api/replays');
    expect(span!.status.code).toBe(2);
    expect(span!.attributes['error.type']).toBe('EACCES');
    expectNoPii(spans());
  });

  it('traces the retention sweep as its own trace', async () => {
    const store = new ReplayStore(tracedStorage(new MemoryStorage()), join(tmpdir(), 'no-sample'));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await withSpan('caller', {}, () => store.prune());
    const [sweep] = named('retention.sweep');
    expect(sweep).toBeDefined();
    expect(sweep!.parentSpanContext).toBeUndefined();
    expect(sweep!.links).toHaveLength(1);
    expect(sweep!.attributes).toMatchObject({ 'retention.replays': 0, 'retention.replays_removed': 0 });
    expect(spans().some((span) => span.name === 'storage.list' && span.parentSpanContext?.spanId === sweep!.spanContext().spanId)).toBe(
      true,
    );
  });

  it('traces video renders: queue wait, the runner and the stored MP4', async () => {
    const storage = tracedStorage(new MemoryStorage());
    const queue = new RenderQueue({
      storage,
      tempDir: tmpdir(),
      runner: async (task) => {
        await withSpan('render.fake_frames', {}, async () => {
          await import('node:fs/promises').then(({ writeFile }) => writeFile(task.output, 'mp4'));
        });
      },
    });
    await withSpan('POST /api/replays/:id/render', {}, () => queue.enqueue('render-me', 1));
    await queue.settled('render-me', 1);
    await vi.waitFor(() => expect(named('render.job')).toHaveLength(1));
    const [job] = named('render.job');
    expect(job!.attributes).toMatchObject({ 'replay.id': 'render-me', 'render.speed': 1, 'render.status': 'done' });
    expect(job!.links).toHaveLength(1);
    const childNames = spans()
      .filter((span) => span.parentSpanContext?.spanId === job!.spanContext().spanId)
      .map((span) => span.name);
    expect(childNames).toEqual(expect.arrayContaining(['render.queue_wait', 'render.fake_frames', 'storage.upload']));
  });
});
