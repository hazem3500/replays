import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { runSuiteCli } from '../../src/suite/cli.ts';
import { recordSuite } from '../../src/suite/record.ts';
import { connect } from '../../src/suite/connection.ts';
import { parsePlan } from '../../src/suite/plan.ts';
import { upload } from '../../src/capture/bundle-io.ts';
import { replay } from '../fixtures.ts';
import { contractApps } from './harness.ts';

const boot = contractApps();

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

/** Runs `replays suite …` against the app and returns what it printed. */
async function suite(origin: string, ...argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => (out.push(String(chunk)), true));
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => (err.push(String(chunk)), true));
  process.exitCode = undefined;
  await runSuiteCli([...argv, '--upload-url', `${origin}/api/replays`, '--json'], { NO_COLOR: '1' });
  const code = process.exitCode as number | undefined;
  vi.restoreAllMocks();
  process.exitCode = undefined;
  const line = (out.join('') || err.join('')).trim();
  return { code, body: JSON.parse(line) as Record<string, any> };
}

describe('replays suite against the real server routes', () => {
  it('creates a suite, adds runs, attaches a replay, sets the status and reads it back', async () => {
    const { client } = await boot();
    const base = [
      '--id',
      'cli-suite',
      '--title',
      'Checkout review',
      '--source',
      'github:example-org/shop-demo#42',
      '--profile',
      'design-review',
    ];

    const created = await suite(client.origin, 'create', ...base, '--person', 'reviewer:ada@example.com', '--summary', 'First pass.');
    expect(created.body).toMatchObject({ success: true, id: 'cli-suite', created: true, url: `${client.origin}/s/cli-suite`, runs: 0 });
    const again = await suite(client.origin, 'create', ...base);
    expect(again.body).toMatchObject({ success: true, created: false });
    const conflict = await suite(client.origin, 'create', '--id', 'cli-suite', '--title', 'Other');
    expect(conflict.code).toBe(1);
    expect(conflict.body.error).toMatch(/different title/);

    const added = await suite(client.origin, 'run', 'add', 'cli-suite', '--run', 'desktop', '--title', 'Desktop checkout');
    expect(added.body.run).toMatchObject({ id: 'desktop', status: 'running', sequence: 1 });
    await suite(client.origin, 'run', 'add', 'cli-suite', '--run', 'phone', '--title', 'Phone checkout');

    const bundle = { ...replay('cli-suite-desktop'), suiteRun: { suiteId: 'cli-suite', runId: 'desktop' } };
    const dir = await mkdtemp(join(tmpdir(), 'replays-suite-cli-'));
    const receipt = await upload(bundle, dir, `${client.origin}/api/replays`);
    expect(receipt.id).toBe('cli-suite-desktop');

    const set = await suite(client.origin, 'run', 'set', 'cli-suite', 'desktop', '--status', 'passed', '--summary', 'Checkout works.');
    expect(set.body.run).toMatchObject({ id: 'desktop', status: 'passed', summary: 'Checkout works.' });
    const refused = await suite(client.origin, 'run', 'set', 'cli-suite', 'desktop', '--status', 'failed');
    expect(refused.code).toBe(1);
    expect(refused.body.error).toMatch(/already finished as passed/);

    await suite(client.origin, 'summary', 'cli-suite', 'Desktop passes; phone not run yet.');
    await suite(client.origin, 'run', 'set', 'cli-suite', 'phone', '--status', 'failed', '--summary', '- Cart total wrong');

    const shown = await suite(client.origin, 'show', 'cli-suite');
    expect(shown.body.suite).toMatchObject({
      id: 'cli-suite',
      title: 'Checkout review',
      status: 'Failed',
      profile: 'design-review',
      source: 'https://github.com/example-org/shop-demo/issues/42',
      summary: 'Desktop passes; phone not run yet.',
      people: [{ role: 'reviewer', email: 'ada@example.com' }],
    });
    expect(shown.body.suite.runs).toMatchObject([
      {
        id: 'desktop',
        status: 'passed',
        replayId: 'cli-suite-desktop',
        replayUrl: `${client.origin}/s/cli-suite/r/cli-suite-desktop`,
        duration: 1000,
        summary: 'Checkout works.',
      },
      { id: 'phone', status: 'failed', summary: '- Cart total wrong' },
    ]);

    const listed = await suite(client.origin, 'list');
    expect(listed.body.suites).toMatchObject([{ id: 'cli-suite', runs: 2, failed: 1, url: `${client.origin}/s/cli-suite` }]);
    const missing = await suite(client.origin, 'show', 'no-such-suite');
    expect(missing.code).toBe(1);
    expect(missing.body.hint).toMatch(/suite list/);
  });

  it('records a plan end to end with a failing run and a retried upload', async () => {
    const { client } = await boot();
    const connection = await connect({ 'upload-url': `${client.origin}/api/replays` });
    const dir = await mkdtemp(join(tmpdir(), 'replays-suite-record-'));
    const plan = parsePlan({
      id: 'plan-suite',
      title: 'Plan suite',
      source: 'github:example-org/shop-demo#42',
      runs: [
        { id: 'one', title: 'One', url: 'https://example.com/', steps: [], summary: 'Run one.' },
        { id: 'two', title: 'Two', url: 'https://example.com/', steps: [] },
        { id: 'three', title: 'Three', url: 'https://example.com/', steps: [] },
      ],
    });
    let reachable = false;
    const deps = {
      connection,
      outputDirFor: (run: { id: string }) => join(dir, run.id),
      retryCommand: (run: { id: string }) => `retry ${run.id}`,
      recordRun: async (run: { id: string }, replayId: string) => {
        if (run.id === 'two') throw new Error('step 2 failed: #missing not found');
        return { bundle: { ...replay(replayId), suiteRun: { suiteId: 'plan-suite', runId: run.id } }, reused: false };
      },
      uploadRun: async (bundle: ReturnType<typeof replay>, outputDir: string) => {
        if (!reachable && bundle.suiteRun?.runId === 'three') throw new Error('could not reach upload server');
        await writeFile(join(dir, 'uploaded'), bundle.meta.id);
        return upload(bundle, outputDir, `${client.origin}/api/replays`);
      },
    };
    const first = await recordSuite(plan, plan.runs, deps);
    expect(first.runs.map((run) => run.status)).toEqual(['passed', 'failed', 'upload-failed']);
    expect(first.runs[2]?.retry).toBe('retry three');
    expect(first.suite.url).toBe(`${client.origin}/s/plan-suite`);

    let stored = (await (await client.fetch('/api/suites/plan-suite')).json()) as { runs: Array<Record<string, unknown>> };
    expect(stored.runs.map((run) => [run.id, run.status, run.replayId ?? null])).toEqual([
      ['one', 'passed', 'plan-suite-one'],
      ['two', 'failed', null],
      ['three', 'running', null],
    ]);
    expect(stored.runs[1]?.summary).toBe('Recording failed: step 2 failed: #missing not found');
    expect(stored.runs[0]?.summary).toBe('Run one.');

    reachable = true;
    const retry = await recordSuite(plan, plan.runs, deps);
    expect(retry.runs.map((run) => run.status)).toEqual(['skipped', 'failed', 'passed']);
    stored = (await (await client.fetch('/api/suites/plan-suite')).json()) as typeof stored;
    expect(stored.runs.map((run) => [run.id, run.status])).toEqual([
      ['one', 'passed'],
      ['two', 'failed'],
      ['three', 'passed'],
    ]);
    expect(stored.runs[2]?.replayId).toBe('plan-suite-three');
    expect(await readFile(join(dir, 'uploaded'), 'utf8')).toBe('plan-suite-three');
  });

  it('checks a plan with --dry-run without contacting the server', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'replays-suite-dry-'));
    const file = join(dir, 'plan.json');
    await writeFile(
      file,
      JSON.stringify({
        id: 'dry',
        title: 'Dry',
        runs: [{ id: 'a', title: 'A', url: 'https://example.com/', steps: [{ kind: 'wait', ms: 5 }] }],
      }),
    );
    const out: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => (out.push(String(chunk)), true));
    await runSuiteCli(['record', '--plan', file, '--dry-run', '--json'], {});
    const body = JSON.parse(out.join('')) as Record<string, any>;
    expect(body).toMatchObject({
      success: true,
      dryRun: true,
      upload: false,
      suite: { id: 'dry' },
      runs: [{ id: 'a', steps: 1, viewport: '1440x900' }],
    });
  });
});
