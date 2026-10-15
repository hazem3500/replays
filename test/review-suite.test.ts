import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ReviewSuiteAdapter } from '../src/capture/review-suite.ts';
import { createApp } from '../src/server/app.ts';
import { ReplayStore } from '../src/server/store.ts';
import { type ReviewSuiteIndexEntry, suiteOverallStatus } from '../src/shared/review-suite.ts';
import { appDefaults, replay } from './fixtures.ts';

const servers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function start() {
  const root = await mkdtemp(join(tmpdir(), 'replays-suites-'));
  const store = new ReplayStore(join(root, 'data'), join(root, 'sample'));
  const handle = createApp({
    ...appDefaults(),
    store,
    clientDir: join(root, 'client'),
  });
  const server = createServer((request, response) => void handle(request, response));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server has no port');
  return { origin: `http://127.0.0.1:${address.port}`, store };
}

const subject = { provider: 'github', ref: 'example-org/shop-demo#42' };
const resolvedSubject = {
  provider: 'github',
  ref: 'example-org/shop-demo#42',
  url: 'https://github.com/example-org/shop-demo/issues/42',
  label: 'example-org/shop-demo#42',
};

describe('review suites', () => {
  it('does not call an empty suite complete', () => {
    expect(suiteOverallStatus([])).toBe('Waiting');
    expect(suiteOverallStatus([{ status: 'running' }])).toBe('Running');
    expect(suiteOverallStatus([{ status: 'failed', replayId: 'run' }])).toBe('Failed');
    expect(suiteOverallStatus([{ status: 'passed' }])).toBe('Partial');
    expect(suiteOverallStatus([{ status: 'passed', replayId: 'run' }])).toBe('Complete');
  });

  it('registers one invocation idempotently, groups multiple run uploads, and separates another review of the same subject', async () => {
    const { origin } = await start();
    const adapter = new ReviewSuiteAdapter(`${origin}/api`);
    const suite = {
      version: 1 as const,
      id: 'review-invocation-a',
      title: 'Checkout review · #42',
      createdAt: '2026-10-10T12:00:00.000Z',
      subject,
      context: {
        version: 1 as const,
        capturedAt: '2026-10-10T12:00:00.000Z',
        app: { name: 'Shop Demo', environment: 'staging', version: '2026.10.10' },
      },
    };
    await expect(adapter.registerSuite(suite)).resolves.toMatchObject({ id: suite.id, runs: [] });
    await expect(adapter.registerSuite(suite)).resolves.toMatchObject({ id: suite.id, runs: [] });

    const firstRun = {
      id: 'attempt-1',
      sequence: 1,
      label: 'Desktop checkout',
      status: 'running' as const,
      startedAt: '2026-10-10T12:01:00.000Z',
    };
    await adapter.registerRun(suite.id, firstRun);
    await adapter.registerRun(suite.id, firstRun);
    await adapter.registerRun(suite.id, {
      id: 'attempt-2',
      sequence: 2,
      label: 'Mobile regression',
      status: 'failed',
      startedAt: '2026-10-10T12:02:00.000Z',
      finishedAt: '2026-10-10T12:03:00.000Z',
      context: {
        version: 1,
        capturedAt: '2026-10-10T12:02:00.000Z',
        app: { name: 'Shop Demo', environment: 'staging', version: '2026.10.11' },
      },
    });

    const bundle = replay('review-run-1');
    bundle.suiteRun = { suiteId: suite.id, runId: 'attempt-1' };
    const uploadUrl = `${origin}/api/replays`;
    const firstUpload = await fetch(uploadUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(bundle),
    });
    expect(firstUpload.status).toBe(201);
    const firstReceipt = await firstUpload.json();
    const duringCapture = (await (await fetch(`${origin}/api/suites/${suite.id}`)).json()) as {
      runs: Array<{ id: string; status: string; replayId?: string }>;
    };
    expect(duringCapture.runs.find((run) => run.id === firstRun.id)).toMatchObject({ status: 'running', replayId: 'review-run-1' });
    const retryUpload = await fetch(uploadUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(bundle),
    });
    expect(retryUpload.status).toBe(200);
    await expect(retryUpload.json()).resolves.toEqual(firstReceipt);
    expect(firstReceipt).toEqual({
      id: 'review-run-1',
      url: '/r/review-run-1',
      suiteId: suite.id,
      runId: 'attempt-1',
    });
    await adapter.registerRun(suite.id, {
      ...firstRun,
      status: 'passed',
      finishedAt: '2026-10-10T12:01:30.000Z',
    });

    const secondReview = { ...suite, id: 'review-invocation-b', createdAt: '2026-10-10T13:00:00.000Z' };
    await adapter.registerSuite(secondReview);
    const details = (await (await fetch(`${origin}/api/suites/${suite.id}`)).json()) as {
      runs: Array<{
        id: string;
        replayId?: string;
        status: string;
        recording?: { viewport: { width: number; height: number } };
        context?: { capturedAt: string };
      }>;
      context?: { capturedAt: string };
    };
    expect(details.runs).toHaveLength(2);
    expect(details.runs[0]).toMatchObject({
      id: 'attempt-1',
      replayId: 'review-run-1',
      status: 'passed',
      finishedAt: '2026-10-10T12:01:30.000Z',
      recording: { viewport: { width: 1440, height: 900 } },
    });
    expect(details.runs[1]).toMatchObject({ id: 'attempt-2', status: 'failed', context: { capturedAt: '2026-10-10T12:02:00.000Z' } });
    expect(details.context?.capturedAt).toBe('2026-10-10T12:00:00.000Z');
    // The server stored the link the provider resolved from the reference.
    expect(details).toMatchObject({ subject: resolvedSubject });

    const summaries = (await (await fetch(`${origin}/api/suites?limit=20`)).json()) as Array<{
      id: string;
      runs: number;
    }>;
    expect(summaries.map(({ id, runs }) => ({ id, runs }))).toEqual(
      expect.arrayContaining([
        { id: suite.id, runs: 2 },
        { id: secondReview.id, runs: 0 },
      ]),
    );
    expect(await (await fetch(`${origin}/api/suites?limit=20`)).text()).not.toContain('events');

    // The grouped index asks for runs with their replay summaries; plain summaries stay as they were.
    const index = (await (await fetch(`${origin}/api/suites?expand=runs`)).json()) as ReviewSuiteIndexEntry[];
    const grouped = index.find((entry) => entry.id === suite.id)!;
    expect(grouped).toMatchObject({
      runs: 2,
      subject: { provider: 'github', url: resolvedSubject.url, label: resolvedSubject.label },
    });
    expect(grouped.runDetails.map((run) => [run.sequence, run.id, run.status, run.replayId])).toEqual([
      [1, 'attempt-1', 'passed', 'review-run-1'],
      [2, 'attempt-2', 'failed', undefined],
    ]);
    expect(grouped.runDetails[0]!.replay).toMatchObject({ id: 'review-run-1', source: 'agent' });
    expect(grouped.runDetails[1]!.replay).toBeUndefined();
    expect(JSON.stringify(index)).not.toContain('events');
    expect(summaries.every((summary) => !('runDetails' in summary))).toBe(true);

    // The suite workspace asks one suite for the same run details; without `expand` the shape is unchanged.
    const expanded = (await (await fetch(`${origin}/api/suites/${suite.id}?expand=runs`)).json()) as {
      runs: unknown[];
      runDetails: ReviewSuiteIndexEntry['runDetails'];
    };
    expect(expanded.runs).toHaveLength(2);
    expect(expanded.runDetails.map((run) => run.replay?.id)).toEqual(['review-run-1', undefined]);
    expect('runDetails' in (await (await fetch(`${origin}/api/suites/${suite.id}`)).json())).toBe(false);

    const conflict = await fetch(`${origin}/api/suites/${suite.id}/runs/attempt-1`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...firstRun, sequence: 3 }),
    });
    expect(conflict.status).toBe(409);
    const downgrade = await fetch(`${origin}/api/suites/${suite.id}/runs/attempt-1`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...firstRun, status: 'running' }),
    });
    expect(downgrade.status).toBe(409);
  });

  it('requires a registered suite run before linking a bundle and validates the suite subject', async () => {
    const { origin } = await start();
    const suite = {
      version: 1,
      id: 'review-invocation-safe',
      title: 'Review fixture',
      createdAt: '2026-10-10T12:00:00.000Z',
      subject: { provider: 'github', url: 'http://github.com/example-org/shop-demo/issues/42' },
    };
    const invalid = await fetch(`${origin}/api/suites/${suite.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(suite),
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.text()).toMatch(/suite\.subject\.url is unsafe/);
    for (const bad of [{ provider: 'github', ref: 'not a reference' }, { provider: 'mystery', ref: 'x' }, { provider: 'github' }]) {
      const response = await fetch(`${origin}/api/suites/${suite.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...suite, subject: bad }),
      });
      expect(response.status).toBe(400);
    }

    const bundle = replay('unregistered-suite-run');
    bundle.suiteRun = { suiteId: suite.id, runId: 'missing-run' };
    const response = await fetch(`${origin}/api/replays`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(bundle),
    });
    expect(response.status).toBe(404);
  });
});
