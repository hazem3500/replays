import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { EventType, IncrementalSource, MouseInteractions } from 'rrweb';

import { createDemoSeed, refreshDemoSeed, writeDemoSeed } from '../scripts/demo-seed.mjs';
import { createApp } from '../src/server/app.ts';
import { ReplayStore } from '../src/server/store.ts';
import { assertReplayBundle } from '../src/shared/replay.ts';
import { assertReviewSuite } from '../src/shared/review-suite.ts';
import { appDefaults } from './fixtures.ts';

const roots: string[] = [];
const servers: Array<ReturnType<typeof createServer>> = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('local demo seed', () => {
  it('uses valid replay and suite formats with varied, explicitly fictional tracks', () => {
    const { replays, suites } = createDemoSeed();
    expect(replays).toHaveLength(6);
    expect(suites).toHaveLength(3);
    for (const replay of replays) {
      assertReplayBundle(replay);
      expect(replay.meta.tags).toContain('synthetic');
      expect(replay.context?.fields).toEqual({ demo: true, fictional: true });
      expect(replay.events[0]?.type).toBe(EventType.Meta);
      expect(replay.events[1]?.type).toBe(EventType.FullSnapshot);
      expect(replay.events.every((event) => Number.isFinite(event.timestamp))).toBe(true);
      expect(replay.events.at(-1)!.timestamp - replay.events[0]!.timestamp).toBe(replay.meta.duration);
      expect(replay.events.length).toBeGreaterThan(replay.steps.length + 2);
      const snapshot = (replay.events[1]?.data as { node?: unknown } | undefined)?.node as {
        type: number;
        id: number;
        childNodes?: unknown[];
      };
      expect(snapshot.type).toBe(0);
      const ids = new Set<number>();
      const initialText = new Map<number, string>();
      const visit = (value: unknown) => {
        if (!value || typeof value !== 'object') return;
        const item = value as {
          id?: number;
          textContent?: string;
          attributes?: Record<string, unknown>;
          childNodes?: unknown[];
        };
        expect(item.id === undefined || !ids.has(item.id)).toBe(true);
        if (item.id !== undefined) {
          ids.add(item.id);
          if (typeof item.textContent === 'string') initialText.set(item.id, item.textContent);
        }
        for (const attribute of Object.values(item.attributes ?? {})) expect(typeof attribute).toBe('string');
        for (const child of item.childNodes ?? []) visit(child);
      };
      visit(snapshot);
      expect(ids.size).toBeGreaterThan(20);

      const incremental = replay.events.filter((event) => event.type === EventType.IncrementalSnapshot);
      const mutationEvents = incremental.filter((event) => (event.data as { source?: number }).source === IncrementalSource.Mutation);
      expect(incremental.every((event) => (event.data as { source?: number }).source !== undefined)).toBe(true);
      expect(mutationEvents.length).toBeGreaterThan(0);
      expect(
        mutationEvents.some((event) =>
          ((event.data as { texts?: Array<{ id: number; value: string }> }).texts ?? []).some(
            (change) => initialText.get(change.id) !== change.value,
          ),
        ),
      ).toBe(true);
      expect(mutationEvents.some((event) => event.timestamp - replay.events[0]!.timestamp > replay.meta.duration / 2)).toBe(true);
      for (const event of incremental) {
        const data = event.data as {
          source: number;
          id?: number;
          type?: number;
          positions?: Array<{ id: number; x: number; y: number; timeOffset: number }>;
          texts?: Array<{ id: number; value: string }>;
        };
        expect(data.id === undefined || ids.has(data.id)).toBe(true);
        for (const position of data.positions ?? []) expect(ids.has(position.id)).toBe(true);
        for (const change of data.texts ?? []) expect(ids.has(change.id)).toBe(true);
        expect(
          data.source !== IncrementalSource.MouseInteraction ||
            [MouseInteractions.MouseDown, MouseInteractions.Click, MouseInteractions.MouseUp].includes(data.type!),
        ).toBe(true);
      }
      expect(incremental.some((event) => (event.data as { source?: number }).source === IncrementalSource.Input)).toBe(
        replay.meta.id !== 'demo-seed-network-retry' && replay.meta.id !== 'demo-seed-console-diagnostics',
      );
      expect(new URL(replay.meta.url).hostname).toMatch(/\.test$/);
    }
    expect(new Set(replays.flatMap((replay) => replay.meta.tags)).size).toBeGreaterThan(10);
    expect(new Set(replays.map((replay) => new URL(replay.meta.url).hostname)).size).toBeGreaterThan(4);
    expect(replays.some((replay) => replay.steps.length >= 8 && replay.meta.duration >= 60_000)).toBe(true);
    expect(replays.every((replay) => replay.performance?.entries.length === 0)).toBe(true);
    expect(replays.some((replay) => replay.network.some((request) => request.status === 0))).toBe(true);
    expect(replays.some((replay) => replay.console.some((entry) => entry.level === 'error' || entry.level === 'warn'))).toBe(true);

    const replayIds = new Set(replays.map((replay) => replay.meta.id));
    const runStatuses = new Set<string>();
    for (const suite of suites) {
      assertReviewSuite(suite);
      expect(suite.runs.length).toBeGreaterThan(1);
      for (const run of suite.runs) {
        runStatuses.add(run.status);
        expect(!run.replayId || replayIds.has(run.replayId)).toBe(true);
      }
    }
    expect([...runStatuses].sort()).toEqual(['failed', 'partial', 'passed', 'running']);
  });

  it('writes an isolated seed idempotently and refuses to replace unrelated files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'replays-demo-seed-'));
    roots.push(root);
    const first = await writeDemoSeed(root);
    const second = await writeDemoSeed(root);
    expect(first.replays).toBe(6);
    expect(first.suites).toBe(3);
    expect(first.results.every(([status]) => status === 'created')).toBe(true);
    expect(second.results.every(([status]) => status === 'unchanged')).toBe(true);
    const suitePath = join(root, 'data', '_suites', 'demo-suite-release-smoke.json');
    const before = await readFile(suitePath, 'utf8');
    const conflictRoot = join(root, 'conflict');
    await mkdir(join(conflictRoot, 'sample'), { recursive: true });
    await writeFile(join(conflictRoot, 'sample', 'demo-seed-signup.json'), 'user data\n');
    await expect(writeDemoSeed(conflictRoot)).rejects.toThrow(/refusing to replace existing non-seed file/);
    expect(await readFile(suitePath, 'utf8')).toBe(before);
    expect(await readFile(join(conflictRoot, 'sample', 'demo-seed-signup.json'), 'utf8')).toBe('user data\n');
  });

  it('refreshes only existing marker-verified demo targets after a complete preflight', async () => {
    const root = await mkdtemp(join(tmpdir(), 'replays-demo-refresh-'));
    roots.push(root);
    const output = join(root, 'seed');
    await writeDemoSeed(output);
    const sampleDir = join(output, 'sample');
    const dataDir = join(output, 'data');
    const unrelated = join(sampleDir, 'customer-example.json');
    await writeFile(unrelated, '{"customer":"keep"}\n');

    const signupPath = join(sampleDir, 'demo-seed-signup.json');
    const signupBefore = await readFile(signupPath, 'utf8');
    const suitePath = join(dataDir, '_suites', 'demo-suite-workspace-activity.json');
    const suite = JSON.parse(await readFile(suitePath, 'utf8')) as { context: { fields: Record<string, unknown> } };
    suite.context.fields.demo = false;
    await writeFile(suitePath, `${JSON.stringify(suite)}\n`);
    const invalidSuite = await readFile(suitePath, 'utf8');
    await expect(refreshDemoSeed(sampleDir, dataDir)).rejects.toThrow(/demo markers/);
    expect(await readFile(signupPath, 'utf8')).toBe(signupBefore);
    expect(await readFile(suitePath, 'utf8')).toBe(invalidSuite);
    expect(await readFile(unrelated, 'utf8')).toBe('{"customer":"keep"}\n');

    suite.context.fields.demo = true;
    await writeFile(suitePath, `${JSON.stringify(suite)}\n`);
    const uploadedDir = join(dataDir, 'demo-seed-signup');
    await mkdir(uploadedDir, { recursive: true });
    const uploadedPath = join(uploadedDir, 'replay.json');
    const changedReplay = JSON.parse(signupBefore) as { meta: { title: string } };
    changedReplay.meta.title = 'Old demo title';
    await writeFile(uploadedPath, `${JSON.stringify(changedReplay)}\n`);

    const result = await refreshDemoSeed(sampleDir, dataDir);
    expect(result.updated).toHaveLength(10);
    expect(JSON.parse(await readFile(uploadedPath, 'utf8')).meta.title).toBe('Signup · masked form');
    expect(await readFile(unrelated, 'utf8')).toBe('{"customer":"keep"}\n');
  });

  it('serves the seeded runs through replay, feed, and expanded suite endpoints', async () => {
    const root = await mkdtemp(join(tmpdir(), 'replays-demo-feed-'));
    roots.push(root);
    const output = join(root, 'seed');
    const dataDir = join(root, 'data');
    const sampleDir = join(root, 'sample');
    await writeDemoSeed(output);
    await cp(join(output, 'sample'), sampleDir, { recursive: true });
    await mkdir(join(dataDir, '_suites'), { recursive: true });
    await cp(join(output, 'data', '_suites'), join(dataDir, '_suites'), { recursive: true });

    const store = new ReplayStore(dataDir, sampleDir);
    const handle = createApp({ ...appDefaults(), store, clientDir: join(root, 'client') });
    const server = createServer((request, response) => void handle(request, response));
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('demo server has no port');
    const origin = `http://127.0.0.1:${address.port}`;

    const feed = (await (await fetch(`${origin}/api/replays`)).json()) as Array<{ id: string }>;
    expect(feed.map(({ id }) => id)).toHaveLength(6);
    const suites = (await (await fetch(`${origin}/api/suites?expand=runs`)).json()) as Array<{
      id: string;
      runDetails: Array<{ replayId?: string; replay?: { id: string } }>;
    }>;
    expect(suites).toHaveLength(3);
    expect(suites.find((item) => item.id === 'demo-suite-release-smoke')?.runDetails.map((run) => run.replay?.id)).toEqual([
      'demo-seed-signup',
      'demo-seed-checkout-error',
      'demo-seed-dashboard-search',
      undefined,
    ]);
    const playerBundle = (await (await fetch(`${origin}/api/replays/demo-seed-network-retry`)).json()) as {
      events: Array<{ type: number; timestamp: number; data?: { source?: number } }>;
      network: Array<{ status: number }>;
      suiteRun?: { suiteId: string; runId: string };
    };
    expect(playerBundle.events[0]?.type).toBe(EventType.Meta);
    expect(playerBundle.events[1]?.type).toBe(EventType.FullSnapshot);
    expect(
      playerBundle.events.some(({ type, data }) => type === EventType.IncrementalSnapshot && data?.source === IncrementalSource.Mutation),
    ).toBe(true);
    expect(playerBundle.events.at(-1)!.timestamp - playerBundle.events[0]!.timestamp).toBe(19_800);
    expect(playerBundle.events[1]!.timestamp).toBeGreaterThan(playerBundle.events[0]!.timestamp);
    expect(playerBundle.network.map(({ status }) => status)).toContain(0);
    expect(playerBundle.suiteRun).toEqual({ suiteId: 'demo-suite-reliability', runId: 'export-first-attempt' });
  });
});
