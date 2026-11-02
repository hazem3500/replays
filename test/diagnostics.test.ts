import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { detectIssues, groupInteractions, headline } from '../src/shared/diagnostics/index.ts';
import { editTimeline } from '../src/shared/edits.ts';
import type { ReplayBundle } from '../src/shared/replay.ts';
import { tabSummary } from '../src/client/viewer/tab-summary.ts';
import { hasIssues } from '../src/client/viewer/has-issues.ts';
import { request, waterfallFixture } from './waterfall-fixture.ts';

const demoShop = () => JSON.parse(readFileSync(new URL('../sample/demo-shop.json', import.meta.url), 'utf8')) as ReplayBundle;

function retryFixture() {
  const bundle = waterfallFixture();
  bundle.meta.duration = 19_800;
  bundle.steps = [
    { at: 700, kind: 'click', label: 'Start a report export' },
    { at: 11_200, kind: 'wait', label: 'Observe the request timeout' },
    { at: 12_600, kind: 'click', label: 'Retry the export' },
  ];
  bundle.network = [
    request({
      id: 'export',
      at: 700,
      duration: 10_000,
      method: 'POST',
      url: 'https://api.test/v1/exports',
      status: 0,
      statusText: 'Network Error',
    }),
    request({ id: 'retry', at: 12_600, duration: 620, method: 'POST', url: 'https://api.test/v1/exports', status: 200 }),
  ];
  bundle.console = [{ at: 10_710, level: 'error', message: 'Export request failed: network timeout' }];
  return bundle;
}

describe('detectIssues', () => {
  it('links a rejected request to its action, console lines and next step (demo shop)', () => {
    const issues = detectIssues(demoShop());
    expect(issues.map((issue) => [issue.kind, issue.severity, issue.layer])).toEqual([
      ['failed-request', 'failure', 'backend'],
      ['slow-interaction', 'needs-improvement', 'frontend'],
    ]);
    const [failed, slow] = issues;
    expect(failed!.title).toBe('“Apply the coupon” failed: GET /api/coupons/SPRING10 → 404');
    expect(failed!.reason).toMatch(/so the network was fine/);
    expect(failed!.chain.map((link) => [link.role, link.label])).toEqual([
      ['trigger', 'Apply the coupon'],
      ['cause', 'GET /api/coupons/SPRING10'],
      ['effect', 'coupon lookup failed 404'],
      ['effect', 'Coupon service answered 404'],
      ['next', 'Read the coupon error'],
    ]);
    expect(failed!.primary).toEqual({ kind: 'request', id: expect.any(String) });
    // Console lines explained by the request are not reported again on their own.
    expect(issues.some((issue) => issue.kind === 'console-error')).toBe(false);
    expect(slow).toMatchObject({ title: '“Place the order” took 208 ms to respond', value: 208, verdict: 'needs-improvement' });
    expect(slow!.reason).toMatch(/182 ms task blocked the main thread.*no request in flight/);
    expect(slow!.chain.map((link) => link.role)).toEqual(['trigger', 'effect', 'cause']);
  });

  it('calls a request with no answer a network problem, and notes the retry', () => {
    const [issue, ...rest] = detectIssues(retryFixture());
    expect(rest).toEqual([]);
    expect(issue).toMatchObject({ kind: 'failed-request', layer: 'network', severity: 'failure' });
    expect(issue!.reason).toMatch(/No response after 10.0 s \(Network Error\)/);
    expect(issue!.chain.map((link) => link.role)).toEqual(['trigger', 'cause', 'effect', 'retry']);
  });

  it('reports unexplained errors, long tasks, slow requests and a late LCP', () => {
    const bundle = waterfallFixture();
    bundle.steps = [{ at: 100, kind: 'click', label: 'Open reports' }];
    bundle.console = [{ at: 200, level: 'error', message: 'TypeError: x is undefined' }];
    bundle.network = [
      request({ id: 'a', at: 100, duration: 50, url: 'https://api.test/a' }),
      request({ id: 'b', at: 100, duration: 60, url: 'https://api.test/b' }),
      request({ id: 'slow', at: 300, duration: 2400, url: 'https://api.test/report' }),
    ];
    bundle.performance = {
      supported: ['longtask', 'largest-contentful-paint'],
      entries: [
        { at: 500, kind: 'long-task', value: 320 },
        { at: 900, kind: 'long-task', value: 120 },
        { at: 4600, kind: 'largest-contentful-paint', value: 4600 },
      ],
    };
    const issues = detectIssues(bundle);
    expect(issues.map((issue) => `${issue.kind}:${issue.severity}:${issue.layer}`)).toEqual([
      'console-error:failure:frontend',
      'long-task:poor:frontend',
      'slow-paint:poor:frontend',
      'slow-request:needs-improvement:backend',
    ]);
    expect(issues[1]!.title).toBe('The page froze for 320 ms after “Open reports”');
  });

  it('maps to the edited clock and drops what a cut removes', () => {
    const bundle = retryFixture();
    const cutRetry = editTimeline({ version: 1, cuts: [{ id: 'c', from: 12_000, to: 14_000 }] }, 19_800);
    const [issue] = detectIssues(bundle, cutRetry);
    expect(issue!.chain.some((link) => link.role === 'retry')).toBe(false);
    const trimmed = editTimeline({ version: 1, trim: { start: 500, end: 19_800 }, cuts: [] }, 19_800);
    expect(detectIssues(bundle, trimmed)[0]!.at).toBe(200);
    const cutAll = editTimeline({ version: 1, cuts: [{ id: 'c', from: 0, to: 12_000 }] }, 19_800);
    expect(detectIssues(bundle, cutAll)).toEqual([]);
  });

  it('finds nothing in a healthy replay', () => {
    const bundle = waterfallFixture();
    bundle.network = [request({ duration: 40 })];
    expect(detectIssues(bundle)).toEqual([]);
    expect(hasIssues(bundle)).toBe(false);
    expect(headline([])).toBe('No problems found in this replay.');
  });
});

describe('groupInteractions', () => {
  it('reports one press (pointerdown, pointerup, click) as one interaction at its slowest', () => {
    const entries = [
      { at: 100, kind: 'slow-interaction' as const, value: 60, eventType: 'pointerdown' },
      { at: 101, kind: 'slow-interaction' as const, value: 72, eventType: 'pointerup' },
      { at: 102, kind: 'slow-interaction' as const, value: 70, eventType: 'click' },
      { at: 900, kind: 'slow-interaction' as const, value: 40, eventType: 'keydown' },
      { at: 950, kind: 'long-task' as const, value: 400 },
    ].map((entry, index) => ({ entry, index }));
    expect(groupInteractions(entries)).toEqual([
      { at: 100, end: 173, value: 72, events: ['pointerdown', 'pointerup', 'click'], indexes: [0, 1, 2] },
      { at: 900, end: 940, value: 40, events: ['keydown'], indexes: [3] },
    ]);
  });
});

describe('headline', () => {
  it('says what happened in one sentence', () => {
    expect(headline(detectIssues(demoShop()))).toBe(
      'The server rejected “Apply the coupon” (404) and “Place the order” was slow to respond (208 ms) because the page was busy.',
    );
    expect(headline(detectIssues(retryFixture()))).toBe(
      '“Start a report export” got no response (gave up after 10.0 s). A retry recovered.',
    );
  });

  it('names the first three and counts the rest', () => {
    const bundle = waterfallFixture();
    bundle.console = [1, 2, 3, 4, 5].map((n) => ({ at: n * 100, level: 'error' as const, message: `boom ${n}` }));
    expect(headline(detectIssues(bundle))).toBe(
      'The page logged an error, the page logged an error, the page logged an error, and 2 more problems.',
    );
  });
});

describe('issues tab summary', () => {
  it('counts issues, tinted by failure', () => {
    expect(tabSummary(demoShop(), 'issues')).toEqual({ total: 2, problems: 2, problemKind: 'failed', problemLabel: '1 failure' });
    const slowOnly = waterfallFixture();
    slowOnly.performance = { supported: ['longtask'], entries: [{ at: 500, kind: 'long-task', value: 400 }] };
    expect(tabSummary(slowOnly, 'issues')).toEqual({ total: 1, problems: 1, problemKind: 'warning', problemLabel: '' });
  });
});
