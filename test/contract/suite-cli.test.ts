import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { upload } from '../../src/capture/bundle-io.ts';
import type { ReplayBundle } from '../../src/shared/replay.ts';
import { runSuiteCli } from '../../src/suite/cli.ts';
import { connect } from '../../src/suite/connection.ts';
import { parsePlan } from '../../src/suite/plan.ts';
import { recordSuite, type RecordDeps } from '../../src/suite/record.ts';
import { replay } from '../fixtures.ts';
import { contractApps } from './harness.ts';

const boot = contractApps();

interface Answer {
  code: number | string | undefined;
  body: unknown;
}

/** Runs `replays suite …` against the app and returns the JSON it printed. */
async function suite(origin: string, ...argv: string[]): Promise<Answer> {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => out.push(String(chunk)) > 0);
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => err.push(String(chunk)) > 0);
  process.exitCode = undefined;
  await runSuiteCli([...argv, '--upload-url', `${origin}/api/replays`, '--json'], { NO_COLOR: '1' });
  const code = process.exitCode;
  vi.restoreAllMocks();
  process.exitCode = undefined;
  const body: unknown = JSON.parse((out.join('') || err.join('')).trim());
  return { code, body };
}

const attached = (id: string, runId: string, suiteId: string): ReplayBundle => ({ ...replay(id), suiteRun: { suiteId, runId } });

describe('replays suite against the real server routes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('creates a suite, and creating it again counts as success', async () => {
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
    expect((await suite(client.origin, 'create', ...base)).body).toMatchObject({ success: true, created: false });
    const conflict = await suite(client.origin, 'create', '--id', 'cli-suite', '--title', 'Other');
    expect(conflict.code).toBe(1);
    expect(conflict.body).toMatchObject({ success: false });
    expect(JSON.stringify(conflict.body)).toMatch(/different title/);
  });

  it('adds runs, attaches a replay, sets the status and reads it all back', async () => {
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
    await suite(client.origin, 'create', ...base, '--person', 'reviewer:ada@example.com');
    const added = await suite(client.origin, 'run', 'add', 'cli-suite', '--run', 'desktop', '--title', 'Desktop checkout');
    expect(added.body).toMatchObject({ run: { id: 'desktop', status: 'running', sequence: 1 } });
    await suite(client.origin, 'run', 'add', 'cli-suite', '--run', 'phone', '--title', 'Phone checkout');

    const dir = await mkdtemp(join(tmpdir(), 'replays-suite-cli-'));
    const receipt = await upload(attached('cli-suite-desktop', 'desktop', 'cli-suite'), dir, `${client.origin}/api/replays`);
    expect(receipt.id).toBe('cli-suite-desktop');

    const set = await suite(client.origin, 'run', 'set', 'cli-suite', 'desktop', '--status', 'passed', '--summary', 'Checkout works.');
    expect(set.body).toMatchObject({ run: { id: 'desktop', status: 'passed', summary: 'Checkout works.' } });
    const refused = await suite(client.origin, 'run', 'set', 'cli-suite', 'desktop', '--status', 'failed');
    expect(refused.code).toBe(1);
    expect(JSON.stringify(refused.body)).toMatch(/already finished as passed/);

    await suite(client.origin, 'summary', 'cli-suite', 'Desktop passes; phone not run yet.');
    await suite(client.origin, 'run', 'set', 'cli-suite', 'phone', '--status', 'failed', '--summary', '- Cart total wrong');
    const shown = await suite(client.origin, 'show', 'cli-suite');
    expect(shown.body).toMatchObject({
      suite: {
        id: 'cli-suite',
        title: 'Checkout review',
        status: 'Failed',
        profile: 'design-review',
        source: 'https://github.com/example-org/shop-demo/issues/42',
        summary: 'Desktop passes; phone not run yet.',
        people: [{ role: 'reviewer', email: 'ada@example.com' }],
        runs: [
          {
            id: 'desktop',
            status: 'passed',
            replayId: 'cli-suite-desktop',
            replayUrl: `${client.origin}/s/cli-suite/r/cli-suite-desktop`,
            duration: 1000,
            summary: 'Checkout works.',
          },
          { id: 'phone', status: 'failed', summary: '- Cart total wrong' },
        ],
      },
    });
  });
});

describe('replays suite list and show against the real server routes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('lists suites and explains a missing one', async () => {
    const { client } = await boot();
    await suite(client.origin, 'create', '--id', 'cli-suite', '--title', 'Checkout review');
    await suite(client.origin, 'run', 'add', 'cli-suite', '--run', 'one', '--title', 'One', '--status', 'failed');
    const listed = await suite(client.origin, 'list');
    expect(listed.body).toMatchObject({ suites: [{ id: 'cli-suite', runs: 1, failed: 1, url: `${client.origin}/s/cli-suite` }] });
    const missing = await suite(client.origin, 'show', 'no-such-suite');
    expect(missing.code).toBe(1);
    expect(JSON.stringify(missing.body)).toMatch(/suite list/);
  });
});

async function recorder(origin: string, reachable: () => boolean): Promise<RecordDeps> {
  const dir = await mkdtemp(join(tmpdir(), 'replays-suite-record-'));
  return {
    connection: await connect({ 'upload-url': `${origin}/api/replays` }),
    outputDirFor: (run) => join(dir, run.id),
    retryCommand: (run) => `retry ${run.id}`,
    recordRun: (run, replayId) =>
      run.id === 'two'
        ? Promise.reject(new Error('step 2 failed: #missing not found'))
        : Promise.resolve({ bundle: attached(replayId, run.id, 'plan-suite'), reused: false }),
    uploadRun: async (bundle, outputDir) => {
      if (!reachable() && bundle.suiteRun?.runId === 'three') throw new Error('could not reach upload server');
      await writeFile(join(dir, 'uploaded'), bundle.meta.id);
      return upload(bundle, outputDir, `${origin}/api/replays`);
    },
  };
}

describe('suite record against the real server routes', () => {
  const ids = ['one', 'two', 'three'];
  const plan = parsePlan({
    id: 'plan-suite',
    title: 'Plan suite',
    source: 'github:example-org/shop-demo#42',
    runs: ids.map((id) => ({ id, title: id, url: 'https://example.com/', steps: [], ...(id === 'one' ? { summary: 'Run one.' } : {}) })),
  });

  it('records a plan with a failing run and a retried upload', async () => {
    const { client } = await boot();
    let reachable = false;
    const deps = await recorder(client.origin, () => reachable);
    const first = await recordSuite(plan, plan.runs, deps);
    expect(first.runs.map((run) => run.status)).toEqual(['passed', 'failed', 'upload-failed']);
    expect(first.runs[2]?.retry).toBe('retry three');
    expect(first.suite.url).toBe(`${client.origin}/s/plan-suite`);
    expect(await (await client.fetch('/api/suites/plan-suite')).json()).toMatchObject({
      runs: [
        { id: 'one', status: 'passed', replayId: 'plan-suite-one', summary: 'Run one.' },
        { id: 'two', status: 'failed', summary: 'Recording failed: step 2 failed: #missing not found' },
        { id: 'three', status: 'running' },
      ],
    });

    reachable = true;
    const retry = await recordSuite(plan, plan.runs, deps);
    expect(retry.runs.map((run) => run.status)).toEqual(['skipped', 'failed', 'passed']);
    expect(await (await client.fetch('/api/suites/plan-suite')).json()).toMatchObject({
      runs: [{ status: 'passed' }, { status: 'failed' }, { id: 'three', status: 'passed', replayId: 'plan-suite-three' }],
    });
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
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => out.push(String(chunk)) > 0);
    await runSuiteCli(['record', '--plan', file, '--dry-run', '--json'], {});
    vi.restoreAllMocks();
    const body: unknown = JSON.parse(out.join(''));
    expect(body).toMatchObject({
      success: true,
      dryRun: true,
      upload: false,
      suite: { id: 'dry' },
      runs: [{ id: 'a', steps: 1, viewport: '1440x900' }],
    });
    expect(await readFile(file, 'utf8')).toContain('"dry"');
  });
});
