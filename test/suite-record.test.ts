import { describe, expect, it } from 'vitest';

import { ReviewSuiteHttpError, type ReviewSuiteApi } from '../src/capture/review-suite.ts';
import { HttpError } from '../src/shared/http-error.ts';
import type { ReplayBundle } from '../src/shared/replay.ts';
import type { ReviewRunRegistration, ReviewSuite, ReviewSuiteRegistration } from '../src/shared/review-suite.ts';
import { registration, withRecording, withRun } from '../src/server/store/suite-changes.ts';
import type { SuiteConnection } from '../src/suite/connection.ts';
import { parsePlan } from '../src/suite/plan.ts';
import { recordSuite, type RecordDeps, type RecordedRun } from '../src/suite/record.ts';
import { addRun, ensureSuite, setSuiteSummary, updateRun } from '../src/suite/service.ts';
import { replay } from './fixtures.ts';

function refuse<T>(work: () => T): T {
  try {
    return work();
  } catch (error) {
    if (error instanceof HttpError) throw new ReviewSuiteHttpError(error.status, error.message);
    throw error;
  }
}

/** The server's own change rules behind the adapter's interface, so the CLI is held to the real 409s. */
class FakeServer implements ReviewSuiteApi {
  suite: ReviewSuite | undefined;
  readonly calls: string[] = [];
  readonly connection: SuiteConnection = { server: 'https://replays.test', api: this };

  registerSuite(input: ReviewSuiteRegistration) {
    this.calls.push(`PUT suite ${input.id}`);
    const { subject, ...rest } = input;
    const resolved = { ...rest, ...(subject ? { subject: { ...subject, url: `https://github.com/${subject.ref ?? ''}` } } : {}) };
    const change = refuse(() => registration(this.suite, input.id, resolved));
    if (change.next) this.suite = change.next;
    return Promise.resolve(change.result);
  }

  registerRun(_suiteId: string, run: ReviewRunRegistration) {
    this.calls.push(`PUT run ${run.id} ${run.status}`);
    const current = this.suite;
    if (!current) return Promise.reject(new ReviewSuiteHttpError(404, 'no suite'));
    const next = refuse(() => withRun(current, run.id, run));
    this.suite = next;
    return Promise.resolve(next);
  }

  getSuite() {
    return Promise.resolve(this.suite);
  }

  listSuites() {
    return Promise.resolve([]);
  }

  attach(bundle: ReplayBundle) {
    const runId = bundle.suiteRun?.runId ?? '';
    const current = this.suite;
    if (current) this.suite = refuse(() => withRecording(current, runId, bundle));
  }
}

const plan = parsePlan({
  id: 'review-1',
  title: 'Review 1',
  summary: 'The suite summary.',
  runs: [
    { id: 'a', title: 'A', url: 'https://example.com/', steps: [], summary: 'Run A.' },
    { id: 'b', title: 'B', url: 'https://example.com/', steps: [], expect: { noConsoleErrors: true } },
    { id: 'c', title: 'C', url: 'https://example.com/', steps: [] },
  ],
});

const attached = (id: string, runId: string): ReplayBundle => ({ ...replay(id), suiteRun: { suiteId: 'review-1', runId } });
const recorded = (id: string, runId: string): Promise<RecordedRun> => Promise.resolve({ bundle: attached(id, runId), reused: false });

function deps(server: FakeServer, overrides: Partial<RecordDeps> = {}): RecordDeps {
  return {
    connection: server.connection,
    outputDirFor: (run) => `/out/${run.id}`,
    retryCommand: (run) => `replays suite record --plan plan.json --upload --only ${run.id}`,
    recordRun: (run, replayId) => recorded(replayId, run.id),
    uploadRun: (bundle) => {
      server.attach(bundle);
      return Promise.resolve({ url: `https://replays.test/r/${bundle.meta.id}` });
    },
    now: () => new Date('2026-11-10T10:00:00.000Z'),
    ...overrides,
  };
}

describe('suite record: the happy path', () => {
  it('registers the suite, then each run running to passed, with its replay attached', async () => {
    const server = new FakeServer();
    const result = await recordSuite(plan, plan.runs, deps(server));
    expect(result.failed).toBe(0);
    expect(result.suite).toEqual({ id: 'review-1', title: 'Review 1', url: 'https://replays.test/s/review-1' });
    expect(result.runs.map((run) => [run.id, run.status, run.uploaded])).toEqual([
      ['a', 'passed', true],
      ['b', 'passed', true],
      ['c', 'passed', true],
    ]);
    expect(server.suite?.summary).toBe('The suite summary.');
    expect(server.suite?.runs.map((run) => [run.id, run.status, run.replayId, run.sequence])).toEqual([
      ['a', 'passed', 'review-1-a', 1],
      ['b', 'passed', 'review-1-b', 2],
      ['c', 'passed', 'review-1-c', 3],
    ]);
    expect(server.suite?.runs[0]?.summary).toBe('Run A.');
    expect(server.calls.slice(0, 4)).toEqual(['PUT suite review-1', 'PUT run a running', 'PUT run a passed', 'PUT run b running']);
  });

  it('records locally without touching a server when there is no connection', async () => {
    const server = new FakeServer();
    const result = await recordSuite(plan, plan.runs, deps(server, { connection: undefined }));
    expect(server.calls).toEqual([]);
    expect(result.suite.url).toBeUndefined();
    expect(result.runs.map((run) => [run.status, run.uploaded, run.outputDir])).toEqual([
      ['passed', false, '/out/a'],
      ['passed', false, '/out/b'],
      ['passed', false, '/out/c'],
    ]);
  });
});

describe('suite record: partial failures', () => {
  it('continues past a run whose capture throws and marks it failed with the reason', async () => {
    const server = new FakeServer();
    const seen: string[] = [];
    const result = await recordSuite(
      plan,
      plan.runs,
      deps(server, {
        recordRun: (run, replayId) => (run.id === 'b' ? Promise.reject(new Error('selector #go not found')) : recorded(replayId, run.id)),
        onResult: (outcome) => seen.push(`done ${outcome.id}`),
      }),
    );
    expect(result.failed).toBe(1);
    expect(result.runs.map((run) => run.status)).toEqual(['passed', 'failed', 'passed']);
    expect(result.runs[1]?.error).toBe('recording failed: selector #go not found');
    expect(seen).toEqual(['done a', 'done b', 'done c']);
    expect(server.suite?.runs.find((run) => run.id === 'b')).toMatchObject({
      status: 'failed',
      summary: 'Recording failed: selector #go not found',
      finishedAt: '2026-11-10T10:00:00.000Z',
    });
  });

  it('keeps only the first line of a driver error in the run summary', async () => {
    const server = new FakeServer();
    await recordSuite(
      plan,
      plan.runs.slice(0, 1),
      deps(server, { recordRun: () => Promise.reject(new Error('Timeout 15000ms\nCall log:\n  - waiting')) }),
    );
    expect(server.suite?.runs[0]?.summary).toBe('Run A.\n\nRecording failed: Timeout 15000ms');
  });

  it('marks a run failed when an expectation does not hold, keeping its replay and summary', async () => {
    const server = new FakeServer();
    const result = await recordSuite(
      plan,
      plan.runs,
      deps(server, {
        recordRun: (run, replayId) => {
          const bundle = attached(replayId, run.id);
          if (run.id === 'b') bundle.console = [{ at: 1, level: 'error', message: 'boom' }];
          return Promise.resolve({ bundle, reused: false });
        },
      }),
    );
    expect(result.runs.find((run) => run.id === 'b')).toMatchObject({
      status: 'failed',
      uploaded: true,
      error: 'expectations not met: 1 console error',
    });
    expect(server.suite?.runs.find((run) => run.id === 'b')).toMatchObject({
      status: 'failed',
      replayId: 'review-1-b',
      summary: 'Expectations not met: 1 console error',
    });
  });
});

describe('suite record: retries', () => {
  it('keeps a failed upload local, leaves the run running and prints the retry command', async () => {
    const server = new FakeServer();
    const flaky = (bundle: ReplayBundle) => {
      if (bundle.suiteRun?.runId === 'a') return Promise.reject(new Error('could not reach upload server'));
      server.attach(bundle);
      return Promise.resolve({ url: 'https://replays.test/r/x' });
    };
    const result = await recordSuite(plan, plan.runs, deps(server, { uploadRun: flaky }));
    expect(result.failed).toBe(1);
    expect(result.runs[0]).toMatchObject({
      status: 'upload-failed',
      uploaded: false,
      outputDir: '/out/a',
      retry: 'replays suite record --plan plan.json --upload --only a',
    });
    expect(server.suite?.runs.find((run) => run.id === 'a')?.status).toBe('running');
    expect(result.runs.slice(1).map((run) => run.status)).toEqual(['passed', 'passed']);

    const retried = await recordSuite(
      plan,
      plan.runs.filter((run) => run.id === 'a'),
      deps(server),
    );
    expect(retried.runs[0]?.status).toBe('passed');
    expect(server.suite?.runs.find((run) => run.id === 'a')).toMatchObject({ status: 'passed', sequence: 1 });
  });

  it('does not upload again when the run already holds the replay', async () => {
    const server = new FakeServer();
    const first = plan.runs.slice(0, 1);
    const lost = (bundle: ReplayBundle) => {
      server.attach(bundle);
      return Promise.reject(new Error('lost the response'));
    };
    await recordSuite(plan, first, deps(server, { uploadRun: lost }));
    let uploads = 0;
    const count = () => {
      uploads += 1;
      return Promise.resolve({ url: 'x' });
    };
    const result = await recordSuite(plan, first, deps(server, { uploadRun: count }));
    expect(uploads).toBe(0);
    expect(result.runs[0]?.status).toBe('passed');
  });

  it('skips a run that already passed and reports one that already failed', async () => {
    const server = new FakeServer();
    await recordSuite(
      plan,
      plan.runs,
      deps(server, { recordRun: (run, id) => (run.id === 'b' ? Promise.reject(new Error('x')) : recorded(id, run.id)) }),
    );
    const again = await recordSuite(plan, plan.runs, deps(server));
    expect(again.runs.map((run) => run.status)).toEqual(['skipped', 'failed', 'skipped']);
    expect(again.runs[1]?.error).toMatch(/already finished as failed.*new run id/);
    expect(again.failed).toBe(1);
  });
});

describe('suite service', () => {
  const identity = { id: 'review-1', title: 'Review 1', source: 'github:example-org/shop#4' };

  it('counts the same suite again as success, and keeps the stored creation time', async () => {
    const server = new FakeServer();
    const first = await ensureSuite(server, identity, () => new Date('2026-11-10T10:00:00.000Z'));
    const second = await ensureSuite(server, { ...identity, summary: 'Updated.' }, () => new Date('2026-11-11T10:00:00.000Z'));
    expect([first.created, second.created]).toEqual([true, false]);
    expect(second.suite).toMatchObject({ createdAt: '2026-11-10T10:00:00.000Z', summary: 'Updated.' });
  });

  it('explains a conflicting suite instead of passing the 409 on', async () => {
    const server = new FakeServer();
    await ensureSuite(server, identity);
    await expect(ensureSuite(server, { ...identity, title: 'Another title' })).rejects.toThrow(/already exists with a different title/);
  });

  it("keeps a run's identity across add and update, and refuses to change a finished run", async () => {
    const server = new FakeServer();
    await ensureSuite(server, identity);
    const added = await addRun(server, 'review-1', { id: 'r1', title: 'Run one', status: 'running' });
    const done = await updateRun(server, 'review-1', { id: 'r1', status: 'passed', summary: 'All good.' });
    expect(done.run).toMatchObject({
      label: 'Run one',
      sequence: 1,
      startedAt: added.run.startedAt,
      status: 'passed',
      summary: 'All good.',
    });
    await expect(updateRun(server, 'review-1', { id: 'r1', status: 'failed' })).rejects.toThrow(/already finished as passed/);
    await expect(updateRun(server, 'review-1', { id: 'nope', status: 'failed' })).rejects.toThrow(/not in suite/);
  });

  it('sets a run summary alone, and the suite summary without changing anything else', async () => {
    const server = new FakeServer();
    await ensureSuite(server, identity);
    await addRun(server, 'review-1', { id: 'r1', title: 'Run one', status: 'running' });
    await updateRun(server, 'review-1', { id: 'r1', summary: 'Looks fine so far.' });
    await setSuiteSummary(server, 'review-1', 'Found nothing.');
    expect(server.suite).toMatchObject({ summary: 'Found nothing.', title: 'Review 1' });
    expect(server.suite?.runs).toMatchObject([{ id: 'r1', status: 'running', summary: 'Looks fine so far.' }]);
    await expect(setSuiteSummary(server, 'review-1', '')).rejects.toThrow(/summary/);
  });
});
