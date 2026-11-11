import { describe, expect, it } from 'vitest';

import { assertTransition, nextSequence } from '../src/suite/lifecycle.ts';
import { parsePlan } from '../src/suite/plan.ts';
import { failedExpectations, replayIdFor } from '../src/suite/record.ts';
import { replay } from './fixtures.ts';

const run = { id: 'desktop', title: 'Desktop', url: 'https://example.com/', steps: [] };
const { steps: _steps, ...runWithoutSteps } = run;
const { title: _title, ...runWithoutTitle } = run;
const plan = (extra: Record<string, unknown> = {}, runs: unknown[] = [run]) => ({ id: 'my-suite', title: 'My suite', runs, ...extra });
const problem = (value: unknown) => {
  try {
    parsePlan(value);
    return 'accepted';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

describe('suite plan validation: accepted', () => {
  it('accepts the minimal plan and fills the defaults', () => {
    expect(parsePlan(plan())).toEqual({
      id: 'my-suite',
      title: 'My suite',
      people: [],
      runs: [{ ...run, viewport: { width: 1440, height: 900 } }],
    });
  });

  it('reads every optional field', () => {
    const parsed = parsePlan(
      plan(
        {
          profile: 'design-review',
          source: 'github:example-org/shop#4',
          people: ['reviewer:ada@example.com'],
          summary: 'Hi.',
          createdAt: '2026-11-10T10:00:00.000Z',
        },
        [{ ...run, viewport: { width: 390, height: 844 }, expect: { noConsoleErrors: true, maxDurationMs: 5000 }, summary: 'Run.' }],
      ),
    );
    expect(parsed).toMatchObject({
      profile: 'design-review',
      source: 'github:example-org/shop#4',
      summary: 'Hi.',
      createdAt: '2026-11-10T10:00:00.000Z',
    });
    expect(parsed.people).toEqual([{ role: 'reviewer', email: 'ada@example.com' }]);
    expect(parsed.runs[0]).toMatchObject({
      viewport: { width: 390, height: 844 },
      expect: { noConsoleErrors: true, maxDurationMs: 5000 },
      summary: 'Run.',
    });
  });
});

describe('suite plan validation: rejected', () => {
  it.each([
    [{ ...plan(), id: 'Bad Id' }, 'plan.id'],
    [plan({ title: '  ' }), 'plan.title'],
    [plan({ profile: 'Not A Profile' }), 'plan.profile'],
    [plan({ source: 'nonsense' }), 'plan.source'],
    [plan({ people: ['nobody'] }), 'plan.people'],
    [plan({ people: [1] }), 'plan.people must be a list'],
    [plan({ summary: 'bad\u0001' }), 'plan.summary'],
    [plan({ createdAt: 'yesterday' }), 'plan.createdAt'],
    [plan({ extra: 1 }), 'unsupported field extra'],
    [plan({}, []), 'at least one run'],
    [plan({}, [run, run]), 'run id desktop twice'],
    [plan({}, [{ ...run, id: '-x' }]), 'runs[0].id'],
    [plan({}, [{ ...run, url: 'http://example.com/' }]), 'runs[0].url'],
    [plan({}, [runWithoutSteps]), 'runs[0].steps is required'],
    [plan({}, [{ ...run, steps: [{ kind: 'click' }] }]), 'runs[0].steps'],
    [plan({}, [{ ...run, steps: [{ kind: 'eval', code: 'x' }] }]), 'unsupported'],
    [plan({}, [{ ...run, steps: [{ kind: 'goto', url: 'http://example.com/' }] }]), 'runs[0].steps'],
    [plan({}, [{ ...run, viewport: '10x10' }]), 'runs[0].viewport'],
    [plan({}, [{ ...run, expect: { noConsoleErrors: 'yes' } }]), 'runs[0].expect.noConsoleErrors'],
    [plan({}, [{ ...run, expect: { maxDurationMs: 0 } }]), 'runs[0].expect.maxDurationMs'],
    [plan({}, [{ ...run, expect: { other: true } }]), 'unsupported field other'],
    [plan({}, [{ ...run, summary: '' }]), 'runs[0].summary'],
    [plan({}, [run, { ...runWithoutTitle, id: 'two' }]), 'runs[1].title'],
  ])('rejects %#: names %s', (value, text) => {
    expect(problem(value)).toContain(text);
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
    expect(failedExpectations(bundle, {})).toEqual([]);
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
    expect(long).not.toBe(replayIdFor('s'.repeat(60), `${'R'.repeat(59)}Q`));
  });
});

describe('suite plan validation: groups', () => {
  const timed = { ...run, steps: [{ kind: 'click', selector: '#go', label: 'Entries visible' }] };
  const grouped = (extra: Record<string, unknown> = {}) => ({
    ...timed,
    group: 'Cold open',
    target: 'main',
    measure: 'Entries visible',
    ...extra,
  });

  it('reads group, target, measure and baseline', () => {
    const parsed = parsePlan(plan({ baseline: 'main' }, [grouped()]));
    expect(parsed.baseline).toBe('main');
    expect(parsed.runs[0]).toMatchObject({ group: 'Cold open', target: 'main', measure: 'Entries visible' });
  });

  it('leaves an old plan without them', () => {
    expect(parsePlan(plan()).runs[0]).not.toHaveProperty('group');
  });

  it('rejects a measure that is not one of the run steps', () => {
    expect(problem(plan({}, [grouped({ measure: 'Nope' })]))).toContain('must be the label of one of the run');
  });

  it('rejects over-long and empty names', () => {
    expect(problem(plan({}, [grouped({ group: 'x'.repeat(81) })]))).toContain('runs[0].group');
    expect(problem(plan({}, [grouped({ target: 'x'.repeat(41) })]))).toContain('runs[0].target');
    expect(problem(plan({}, [grouped({ target: ' ' })]))).toContain('runs[0].target');
  });

  it('rejects a baseline no run targets', () => {
    expect(problem(plan({ baseline: 'other' }, [grouped()]))).toContain('plan.baseline');
  });
});
