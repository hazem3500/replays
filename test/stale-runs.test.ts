import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/server/app.ts';
import { loadSettings } from '../src/server/config.ts';
import { DEFAULT_STALE_RUN_MS, endAbandonedRuns } from '../src/server/store/stale-runs.ts';
import { ReplayStore } from '../src/server/store.ts';
import type { ReviewSuite, ReviewSuiteRun } from '../src/shared/review-suite.ts';
import { appDefaults } from './fixtures.ts';

const START = Date.parse('2026-10-10T12:00:00.000Z');
const MINUTE = 60_000;

const run = (overrides: Partial<ReviewSuiteRun> = {}): ReviewSuiteRun => ({
  id: 'step-01',
  sequence: 1,
  label: 'Dates persist',
  status: 'running',
  startedAt: new Date(START).toISOString(),
  ...overrides,
});

const suiteOf = (...runs: ReviewSuiteRun[]): ReviewSuite => ({
  version: 1,
  id: 'stale-a',
  title: 'Stale',
  createdAt: new Date(START).toISOString(),
  subject: {
    provider: 'github',
    ref: 'example-org/shop-demo#42',
    url: 'https://github.com/example-org/shop-demo/issues/42',
    label: 'example-org/shop-demo#42',
  },
  runs,
});

const put = (url: string, body: unknown) =>
  fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('endAbandonedRuns', () => {
  const limit = DEFAULT_STALE_RUN_MS;

  it('leaves a run alone until the timeout has passed, then reads it as partial and finished', () => {
    const suite = suiteOf(run());
    expect(endAbandonedRuns(suite, START + limit, START, limit)).toBe(suite);
    const ended = endAbandonedRuns(suite, START + limit + 1, START, limit).runs[0];
    expect(ended?.status).toBe('partial');
    expect(ended?.finishedAt).toBe(new Date(START + limit).toISOString());
    expect(suite.runs[0]?.status).toBe('running');
  });

  it('counts from the later of the run start and the last write', () => {
    const suite = suiteOf(run());
    expect(endAbandonedRuns(suite, START + limit + MINUTE, START + 5 * MINUTE, limit)).toBe(suite);
    expect(endAbandonedRuns(suite, START + limit + 6 * MINUTE, START + 5 * MINUTE, limit).runs[0]?.status).toBe('partial');
  });

  it('never touches a run with a replay, or any other status', () => {
    const suite = suiteOf(
      run({ id: 'a', replayId: 'abc', recording: { title: 't', duration: 1, steps: 1, viewport: { width: 1, height: 1 } } }),
      run({ id: 'b', status: 'passed' }),
      run({ id: 'c', status: 'failed' }),
      run({ id: 'd', status: 'partial' }),
    );
    expect(endAbandonedRuns(suite, START + 100 * limit, START, limit)).toBe(suite);
  });

  it('is off when the timeout is 0, and ignores unreadable times', () => {
    const suite = suiteOf(run());
    expect(endAbandonedRuns(suite, START + 100 * limit, START, 0)).toBe(suite);
    const odd = suiteOf(run({ startedAt: 'not a date' }));
    expect(endAbandonedRuns(odd, START + 100 * limit, START, limit)).toBe(odd);
  });
});

describe('stale runs in the store and the API', () => {
  const servers: Array<ReturnType<typeof createServer>> = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  });

  async function start(clock: { now: number }) {
    const root = await mkdtemp(join(tmpdir(), 'replays-stale-'));
    const store = new ReplayStore(join(root, 'data'), join(root, 'sample'), undefined, { staleRunMs: limit, now: () => clock.now });
    const handle = createApp({ ...appDefaults(), store, clientDir: join(root, 'client') });
    const server = createServer((request, response) => void handle(request, response));
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server has no port');
    return { origin: `http://127.0.0.1:${address.port}`, store };
  }
  const limit = 30 * MINUTE;

  it('shows an abandoned run as ended, keeps it stored as running, and still accepts the recorder afterwards', async () => {
    const clock = { now: Date.now() };
    const { origin, store } = await start(clock);
    const base = `${origin}/api/suites/stale-a`;
    const { runs: _runs, ...registration } = suiteOf();
    expect((await put(base, registration)).status).toBe(200);
    const body = { id: 'step-01', sequence: 1, label: 'Dates persist', status: 'running', startedAt: new Date(clock.now).toISOString() };
    expect((await put(`${base}/runs/step-01`, body)).status).toBe(200);

    const read = async () => {
      const suite: ReviewSuite = await (await fetch(base)).json();
      return suite.runs[0];
    };
    expect((await read())?.status).toBe('running');

    clock.now += limit + MINUTE;
    expect((await read())?.status).toBe('partial');
    expect((await store.listSuiteSummaries())[0]?.running).toBe(0);

    const late = await put(`${base}/runs/step-01`, { ...body, status: 'passed', finishedAt: new Date(clock.now).toISOString() });
    expect(late.status).toBe(200);
    expect((await read())?.status).toBe('passed');
  });
});

describe('STALE_RUN_MINUTES', () => {
  it('defaults to 30, reads the env and the file, and rejects nonsense', async () => {
    expect((await loadSettings({})).staleRunMinutes).toBe(30);
    expect((await loadSettings({}, { staleRunMinutes: 5 })).staleRunMinutes).toBe(5);
    expect((await loadSettings({ STALE_RUN_MINUTES: '0' }, { staleRunMinutes: 5 })).staleRunMinutes).toBe(0);
    await expect(loadSettings({ STALE_RUN_MINUTES: 'soon' })).rejects.toThrow('STALE_RUN_MINUTES');
  });
});
