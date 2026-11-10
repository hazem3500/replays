import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';

import { assertTransition, nextSequence } from '../src/suite/lifecycle.ts';
import { parsePlan } from '../src/suite/plan.ts';
import { failedExpectations, replayIdFor } from '../src/suite/record.ts';
import { replay } from './fixtures.ts';

const run = { id: 'desktop', title: 'Desktop', url: 'https://example.com/', steps: [] };
const plan = (extra: Record<string, unknown> = {}, runs: unknown[] = [run]) => ({ id: 'my-suite', title: 'My suite', runs, ...extra });
const problem = (value: unknown) => {
  try {
    parsePlan(value);
    return 'accepted';
  } catch (error) {
    return (error as Error).message;
  }
};

describe('suite plan validation', () => {
  it('accepts the minimal plan and fills the defaults', () => {
    expect(parsePlan(plan())).toEqual({
      id: 'my-suite',
      title: 'My suite',
      people: [],
      runs: [{ ...run, viewport: { width: 1440, height: 900 } }],
    });
  });

  it('accepts the sample plan, and the JSON schema agrees', async () => {
    const root = join(import.meta.dirname, '..');
    const sample: unknown = JSON.parse(await readFile(join(root, 'sample/suite-plan.json'), 'utf8'));
    const parsed = parsePlan(sample);
    expect(parsed.runs.map((item) => item.viewport)).toEqual([
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]);
    expect(parsed.people).toEqual([
      { role: 'pr-author', email: 'ada@example.com' },
      { role: 'reviewer', email: 'grace@example.com' },
    ]);
    const ajv = new Ajv2020.default({ strict: false, allErrors: true });
    (addFormats as unknown as { default: (a: unknown) => void }).default(ajv);
    const validate = ajv.compile(JSON.parse(await readFile(join(root, 'docs/formats/suite-plan.schema.json'), 'utf8')));
    expect(validate(sample)).toBe(true);
    expect(validate(plan({}, [{ ...run, steps: [{ kind: 'click' }] }]))).toBe(false);
    expect(validate(plan({ title: '' }))).toBe(false);
  });

  it.each([
    [{ ...plan(), id: 'Bad Id' }, 'plan.id'],
    [plan({ title: '  ' }), 'plan.title'],
    [plan({ profile: 'Not A Profile' }), 'plan.profile'],
    [plan({ source: 'nonsense' }), 'plan.source'],
    [plan({ people: ['nobody'] }), 'plan.people'],
    [plan({ people: [1] }), 'plan.people must be a list'],
    [plan({ summary: 'bad\u0001' }), 'plan.summary'],
    [plan({ extra: 1 }), 'unsupported field extra'],
    [plan({}, []), 'at least one run'],
    [plan({}, [run, run]), 'run id desktop twice'],
    [plan({}, [{ ...run, id: '-x' }]), 'runs[0].id'],
    [plan({}, [{ ...run, url: 'http://example.com/' }]), 'runs[0].url'],
    [plan({}, [{ ...run, steps: undefined }]), 'runs[0].steps is required'],
    [plan({}, [{ ...run, steps: [{ kind: 'click' }] }]), 'runs[0].steps'],
    [plan({}, [{ ...run, steps: [{ kind: 'eval', code: 'x' }] }]), 'unsupported'],
    [plan({}, [{ ...run, viewport: '10x10' }]), 'runs[0].viewport'],
    [plan({}, [{ ...run, expect: { noConsoleErrors: 'yes' } }]), 'runs[0].expect.noConsoleErrors'],
    [plan({}, [{ ...run, expect: { other: true } }]), 'unsupported field other'],
    [plan({}, [{ ...run, summary: '' }]), 'runs[0].summary'],
    [plan({}, [run, { ...run, id: 'two', title: undefined }]), 'runs[1].title'],
  ])('rejects %#: names %s', (value, text) => {
    expect(problem(value)).toContain(text);
  });

  it('keeps a goto step to https or localhost', () => {
    expect(problem(plan({}, [{ ...run, steps: [{ kind: 'goto', url: 'http://example.com/' }] }]))).toContain('runs[0].steps');
  });
});

describe('run status transitions', () => {
  it('lets a new or running run take any status', () => {
    for (const to of ['running', 'passed', 'failed', 'partial'] as const) {
      expect(() => assertTransition('r', undefined, to)).not.toThrow();
      expect(() => assertTransition('r', 'running', to)).not.toThrow();
    }
  });

  it('keeps a finished run as it is, and says what to do instead', () => {
    expect(() => assertTransition('r', 'passed', 'passed')).not.toThrow();
    expect(() => assertTransition('r', 'failed', 'passed')).toThrow(/already finished as failed.*r-2/);
    expect(() => assertTransition('r', 'passed', 'running')).toThrow(/cannot become running/);
  });

  it('numbers the next run after the highest sequence', () => {
    expect(nextSequence([])).toBe(1);
    expect(nextSequence([{ sequence: 1 }, { sequence: 4 }])).toBe(5);
  });
});

describe('expectations and replay ids', () => {
  it('reports each broken expectation', () => {
    const bundle = replay();
    bundle.console = [{ at: 1, level: 'error', message: 'boom' }];
    bundle.network = [
      {
        id: '1',
        at: 1,
        duration: 1,
        method: 'GET',
        url: 'https://x/',
        status: 500,
        statusText: '',
        requestHeaders: [],
        responseHeaders: [],
      },
    ];
    expect(failedExpectations(bundle, undefined)).toEqual([]);
    expect(failedExpectations(bundle, { noConsoleErrors: true, noFailedRequests: true, maxDurationMs: 10 })).toEqual([
      '1 console error',
      '1 failed request (status 400 or above)',
      'took 1000 ms, over the 10 ms limit',
    ]);
    expect(failedExpectations(bundle, { noConsoleErrors: false })).toEqual([]);
  });

  it('derives a stable valid replay id, hashing only when it must shorten', () => {
    expect(replayIdFor('my-suite', 'Desktop-1')).toBe('my-suite-desktop-1');
    const long = replayIdFor('s'.repeat(60), 'R'.repeat(60));
    expect(long).toMatch(/^[a-z0-9][a-z0-9-]{0,79}$/);
    expect(long).toBe(replayIdFor('s'.repeat(60), 'R'.repeat(60)));
    expect(long).not.toBe(replayIdFor('s'.repeat(60), 'R'.repeat(59) + 'Q'));
  });
});
