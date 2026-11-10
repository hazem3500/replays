import { describe, expect, it } from 'vitest';

import { ReviewSuiteHttpError, type ReviewSuiteAdapter } from '../src/capture/review-suite.ts';
import { HttpError } from '../src/shared/http-error.ts';
import type { ReplayBundle } from '../src/shared/replay.ts';
import type { ReviewRunRegistration, ReviewSuite, ReviewSuiteRegistration } from '../src/shared/review-suite.ts';
import { registration, withRecording, withRun } from '../src/server/store/suite-changes.ts';
import type { SuiteConnection } from '../src/suite/connection.ts';
import { parsePlan } from '../src/suite/plan.ts';
import { recordSuite, type RecordDeps } from '../src/suite/record.ts';
import { addRun, ensureSuite, setRunStatus, setSuiteSummary } from '../src/suite/service.ts';
import { replay } from './fixtures.ts';

/** The server's own change rules behind the adapter's interface, so the CLI is held to the real 409s. */
class FakeServer {
  suite: ReviewSuite | undefined;
  readonly calls: string[] = [];

  private refuse<T>(work: () => T): T {
    try {
      return work();
    } catch (error) {
      if (error instanceof HttpError) throw new ReviewSuiteHttpError(error.status, error.message);
      throw error;
    }
  }

  readonly api = {
    registerSuite: async (input: ReviewSuiteRegistration) => {
      this.calls.push(`PUT suite ${input.id}`);
      const { subject, ...rest } = input;
      const resolved = {
        ...rest,
        ...(subject ? { subject: { ...subject, url: `https://github.com/${(subject as { ref: string }).ref}` } } : {}),
      };
      const change = this.refuse(() => registration(this.suite, input.id, resolved as never));
      if (change.next) this.suite = change.next;
      return change.result;
    },
    registerRun: async (suiteId: string, run: ReviewRunRegistration) => {
      this.calls.push(`PUT run ${run.id} ${run.status}`);
      if (!this.suite) throw new ReviewSuiteHttpError(404, 'no suite');
      this.suite = this.refuse(() => withRun(this.suite!, run.id, run));
      void suiteId;
      return this.suite;
    },
    getSuite: async () => this.suite,
  } as unknown as ReviewSuiteAdapter;

  attach(runId: string, bundle: ReplayBundle) {
    this.suite = this.refuse(() => withRecording(this.suite!, runId, bundle));
  }

  connection: SuiteConnection = { server: 'https://replays.test', api: this.api };
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

function deps(server: FakeServer, overrides: Partial<RecordDeps> = {}): RecordDeps {
  return {
    connection: server.connection,
    outputDirFor: (run) => `/out/${run.id}`,
    retryCommand: (run) => `replays suite record --plan plan.json --upload --only ${run.id}`,
    recordRun: async (run, replayId) => {
      const bundle = replay(replayId);
      bundle.suiteRun = { suiteId: 'review-1', runId: run.id };
      return { bundle, reused: false };
    },
    uploadRun: async (bundle) => {
      server.attach(bundle.suiteRun!.runId, bundle);
      return { url: `https://replays.test/r/${bundle.meta.id}` };
    },
    now: () => new Date('2026-11-10T10:00:00.000Z'),
    ...overrides,
  };
}

describe('suite record', () => {
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

  it('continues past a run whose capture throws and marks it failed with the reason', async () => {
    const server = new FakeServer();
    const seen: string[] = [];
    const result = await recordSuite(
      plan,
      plan.runs,
      deps(server, {
        recordRun: async (run, replayId) => {
          if (run.id === 'b') throw new Error('selector #go not found');
          return { bundle: replay(replayId), reused: false };
        },
        uploadRun: async (bundle) => {
          seen.push(bundle.meta.id);
          return { url: 'https://replays.test/r/x' };
        },
        onResult: (outcome) => seen.push(`done ${outcome.id}`),
      }),
    );
    expect(result.failed).toBe(1);
    expect(result.runs.map((run) => run.status)).toEqual(['passed', 'failed', 'passed']);
    expect(result.runs[1]?.error).toBe('recording failed: selector #go not found');
    expect(seen).toEqual(['review-1-a', 'done a', 'done b', 'review-1-c', 'done c']);
    const failed = server.suite?.runs.find((run) => run.id === 'b');
    expect(failed?.status).toBe('failed');
    expect(failed?.summary).toBe('Recording failed: selector #go not found');
    expect(failed?.finishedAt).toBeDefined();
  });

  it('marks a run failed when an expectation does not hold, keeping its replay and summary', async () => {
    const server = new FakeServer();
    const result = await recordSuite(
      plan,
      plan.runs,
      deps(server, {
        recordRun: async (run, replayId) => {
          const bundle = replay(replayId);
          bundle.suiteRun = { suiteId: 'review-1', runId: run.id };
          if (run.id === 'b') bundle.console = [{ at: 1, level: 'error', message: 'boom' }];
          return { bundle, reused: false };
        },
      }),
    );
    const b = result.runs.find((run) => run.id === 'b');
    expect(b).toMatchObject({ status: 'failed', uploaded: true, error: 'expectations not met: 1 console error' });
    expect(server.suite?.runs.find((run) => run.id === 'b')).toMatchObject({
      status: 'failed',
      replayId: 'review-1-b',
      summary: 'Expectations not met: 1 console error',
    });
  });

  it('keeps a failed upload local, leaves the run running and prints the retry command', async () => {
    const server = new FakeServer();
    const result = await recordSuite(
      plan,
      plan.runs,
      deps(server, {
        uploadRun: async (bundle) => {
          if (bundle.suiteRun?.runId === 'a') throw new Error('could not reach upload server');
          server.attach(bundle.suiteRun!.runId, bundle);
          return { url: 'https://replays.test/r/x' };
        },
      }),
    );
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
    await recordSuite(
      plan,
      [plan.runs[0]!],
      deps(server, {
        uploadRun: async (bundle) => {
          server.attach('a', bundle);
          throw new Error('lost the response');
        },
      }),
    );
    let uploads = 0;
    const result = await recordSuite(
      plan,
      [plan.runs[0]!],
      deps(server, {
        uploadRun: async () => {
          uploads += 1;
          return { url: 'x' };
        },
      }),
    );
    expect(uploads).toBe(0);
    expect(result.runs[0]?.status).toBe('passed');
  });

  it('skips a run that already passed and reports one that already failed', async () => {
    const server = new FakeServer();
    await recordSuite(
      plan,
      plan.runs,
      deps(server, {
        recordRun: async (run, id) => {
          if (run.id === 'b') throw new Error('x');
          return { bundle: { ...replay(id), suiteRun: { suiteId: 'review-1', runId: run.id } }, reused: false };
        },
      }),
    );
    const again = await recordSuite(plan, plan.runs, deps(server));
    expect(again.runs.map((run) => run.status)).toEqual(['skipped', 'failed', 'skipped']);
    expect(again.runs[1]?.error).toMatch(/already finished as failed.*new run id/);
    expect(again.failed).toBe(1);
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

describe('suite service', () => {
  const identity = { id: 'review-1', title: 'Review 1', source: 'github:example-org/shop#4' };

  it('counts the same suite again as success, and keeps the stored creation time', async () => {
    const server = new FakeServer();
    const first = await ensureSuite(server.api, identity, () => new Date('2026-11-10T10:00:00.000Z'));
    const second = await ensureSuite(server.api, { ...identity, summary: 'Updated.' }, () => new Date('2026-11-11T10:00:00.000Z'));
    expect([first.created, second.created]).toEqual([true, false]);
    expect(second.suite).toMatchObject({ createdAt: '2026-11-10T10:00:00.000Z', summary: 'Updated.' });
  });

  it('explains a conflicting suite instead of passing the 409 on', async () => {
    const server = new FakeServer();
    await ensureSuite(server.api, identity);
    await expect(ensureSuite(server.api, { ...identity, title: 'Another title' })).rejects.toThrow(/already exists with a different title/);
  });

  it("keeps a run's identity across add and set, and refuses to change a finished run", async () => {
    const server = new FakeServer();
    await ensureSuite(server.api, identity);
    const added = await addRun(server.api, 'review-1', { id: 'r1', title: 'Run one', status: 'running' });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const done = await setRunStatus(server.api, 'review-1', 'r1', 'passed', 'All good.');
    expect(done.run).toMatchObject({
      label: 'Run one',
      sequence: 1,
      startedAt: added.run.startedAt,
      status: 'passed',
      summary: 'All good.',
    });
    await expect(setRunStatus(server.api, 'review-1', 'r1', 'failed')).rejects.toThrow(/already finished as passed/);
    await expect(setRunStatus(server.api, 'review-1', 'nope', 'failed')).rejects.toThrow(/not in suite/);
  });

  it('sets the suite summary without changing anything else', async () => {
    const server = new FakeServer();
    await ensureSuite(server.api, identity);
    await addRun(server.api, 'review-1', { id: 'r1', title: 'Run one', status: 'running' });
    await setSuiteSummary(server.api, 'review-1', 'Found nothing.');
    expect(server.suite).toMatchObject({ summary: 'Found nothing.', title: 'Review 1' });
    expect(server.suite?.runs).toHaveLength(1);
    await expect(setSuiteSummary(server.api, 'review-1', '')).rejects.toThrow(/summary/);
  });
});
