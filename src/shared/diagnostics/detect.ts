import type { EditTimeline } from '../edits.ts';
import {
  hasNoResponse,
  isFailedRequest,
  type ReplayBundle,
  type ReplayNetworkEntry,
  type ReplayPerformanceEntry,
  type ReplayStep,
} from '../replay.ts';
import { DEFAULT_BUDGETS, isDuration, verdictFor } from './budgets.ts';
import type { DetectOptions, Issue, IssueLink, IssueSeverity } from './types.ts';

const STRINGS = {
  request: (entry: ReplayNetworkEntry) => `${entry.method} ${pathOf(entry.url)}`,
  failedTitle: (action: string | undefined, entry: ReplayNetworkEntry) =>
    `${action ? `“${action}” failed` : 'A request failed'}: ${STRINGS.request(entry)} → ${entry.status || entry.statusText || 'no response'}`,
  failedShort: (entry: ReplayNetworkEntry) => `${STRINGS.request(entry)} returned ${entry.status || entry.statusText || 'no response'}`,
  noAnswer: (entry: ReplayNetworkEntry) =>
    `No response after ${ms(entry.duration)} (${entry.statusText || 'network error'}). The request never got an answer, so look at the network or the service’s availability, not the page.`,
  serverFailed: (entry: ReplayNetworkEntry) =>
    `The server answered ${entry.status} in ${ms(entry.duration)}: the request arrived, and the backend failed while handling it.`,
  serverRejected: (entry: ReplayNetworkEntry) =>
    `The server answered ${entry.status}${entry.statusText ? ` ${entry.statusText}` : ''} in ${ms(entry.duration)}, so the network was fine. The backend rejected the request: either the page sent something it won’t accept, or the endpoint is missing.`,
  status: (entry: ReplayNetworkEntry) => `${entry.status || 'ERR'} · ${ms(entry.duration)}`,
  retried: (entry: ReplayNetworkEntry) => `Retried: ${STRINGS.request(entry)}`,
  nextStep: 'next step',
  errorTitle: (action: string | undefined, message: string) => `Error logged${action ? ` during “${action}”` : ''}: ${message}`,
  errorReason:
    'Logged by the page with no failing request around it, so it most likely comes from frontend code. The stack was not captured.',
  slowTitle: (action: string | undefined, value: number) => `${action ? `“${action}”` : 'An interaction'} took ${ms(value)} to respond`,
  slowShort: (event: string | undefined, value: number) => `Slow ${event ?? 'interaction'} · ${ms(value)}`,
  slowBusy: (task: number, inflight: number) =>
    `A ${ms(task)} task blocked the main thread at the same moment${inflight ? '' : ', with no request in flight'}. The delay is frontend work (script attribution was not captured).`,
  slowIdle: (inflight: number) =>
    `No long task was captured around it${inflight ? `, and ${inflight} ${inflight === 1 ? 'request was' : 'requests were'} in flight` : ''}. Rendering or input handling is the likely cost.`,
  interaction: (events: readonly string[]) => events.join(' → '),
  toPaint: (value: number) => `${ms(value)} to next paint`,
  busy: 'Main thread busy',
  frozeTitle: (action: string | undefined, value: number) => `The page froze for ${ms(value)}${action ? ` after “${action}”` : ''}`,
  frozeShort: (value: number) => `Long task · ${ms(value)}`,
  frozeReason: 'One main-thread task this long blocks input and rendering. Script attribution was not captured.',
  slowRequestTitle: (entry: ReplayNetworkEntry) => `${STRINGS.request(entry)} took ${ms(entry.duration)}`,
  slowRequestShort: (entry: ReplayNetworkEntry) => `Slow ${STRINGS.request(entry)}`,
  slowRequestReason: (factor: number) =>
    `${factor.toFixed(1)}× this host’s median. Without phase timing we can’t split server time from transfer time.`,
  paintTitle: (value: number) => `The main content painted at ${ms(value)}`,
  paintShort: (value: number) => `Largest paint · ${ms(value)}`,
  paintReason:
    'The largest element painted late. Render-blocking resources, heavy script and a slow document response all contribute; which one was not captured.',
  largestPaint: 'Largest contentful paint',
};

/** "82 ms", "1.24 s", "10.0 s". */
export function ms(value: number) {
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(value < 10_000 ? 2 : 1)} s`;
}

function pathOf(url: string) {
  try {
    return new URL(url).pathname || '/';
  } catch {
    return url.split(/[?#]/)[0] || url;
  }
}
function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}
function median(values: readonly number[]) {
  const sorted = values.toSorted((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

const valid = (at: number) => Number.isFinite(at) && at >= 0;

export interface Interaction {
  at: number;
  end: number;
  /** The slowest of its events, ms. */
  value: number;
  events: string[];
  /** Positions of its events in `performance.entries`. */
  indexes: number[];
}

/**
 * Slow-interaction entries as interactions: one press fires several events (pointerdown, pointerup, click) within a few
 * ms, and each is reported once, at its slowest.
 */
export function groupInteractions(entries: ReadonlyArray<{ entry: ReplayPerformanceEntry; index: number }>): Interaction[] {
  const interactions: Interaction[] = [];
  for (const { entry, index } of entries) {
    if (entry.kind !== 'slow-interaction' || !isDuration(entry.value)) continue;
    const last = interactions.at(-1);
    if (last && entry.at - last.at < 30) {
      last.value = Math.max(last.value, entry.value);
      last.end = Math.max(last.end, entry.at + entry.value);
      last.events.push(entry.eventType ?? 'event');
      last.indexes.push(index);
    } else
      interactions.push({
        at: entry.at,
        end: entry.at + entry.value,
        value: entry.value,
        events: [entry.eventType ?? 'event'],
        indexes: [index],
      });
  }
  return interactions;
}

const RANK: Readonly<Record<IssueSeverity, number>> = { failure: 0, poor: 1, 'needs-improvement': 2 };

/** Failures first, then Poor, then Needs work; within each, by time. */
export function byImportance(a: Issue, b: Issue) {
  return RANK[a.severity] - RANK[b.severity] || a.at - b.at || a.id.localeCompare(b.id);
}

/**
 * What went wrong in a replay, from its captured rows alone: failed requests (with the console lines and retry that
 * followed), errors, slow responses to input explained by what overlapped them, long tasks, slow requests against
 * their host's median, and a late largest paint. Links are by time, so a chain is "likely", not proof. Pass the
 * captured bundle with the edit timeline: rows wholly inside a cut are left out and times move to the player's clock.
 */
export function detectIssues(bundle: ReplayBundle, timeline?: EditTimeline, options: DetectOptions = {}): Issue[] {
  const budgets = options.budgets ?? DEFAULT_BUDGETS;
  const triggerWindow = options.triggerWindow ?? 5000;
  const consoleWindow = options.consoleWindow ?? 1500;
  const kept = (from: number, to = from) => {
    if (!valid(from)) return false;
    if (!timeline) return true;
    if (from > timeline.originalDuration) return false;
    if (to <= from) return !timeline.isRemoved(from);
    return !timeline.removed.some((range) => range.from <= from && range.to >= to);
  };
  const clock = (at: number) => (timeline ? timeline.toEdited(at) : at);

  const steps = bundle.steps.map((step, index) => ({ step, index })).filter(({ step }) => kept(step.at));
  const actionBefore = (at: number) =>
    steps.findLast(({ step }) => step.kind !== 'wait' && step.at <= at + 5 && at - step.at <= triggerWindow);
  const stepAfter = (at: number) => steps.find(({ step }) => step.at > at && step.at - at <= triggerWindow);
  const stepLink = (found: { step: ReplayStep; index: number }, role: IssueLink['role'], detail?: string): IssueLink => ({
    ref: { kind: 'step', index: found.index },
    role,
    at: clock(found.step.at),
    label: found.step.label,
    ...(detail ? { detail } : {}),
  });

  const requests = bundle.network.filter((entry) => kept(entry.at, entry.at + (isDuration(entry.duration) ? entry.duration : 0)));
  const consoleRows = bundle.console.map((entry, index) => ({ entry, index })).filter(({ entry }) => kept(entry.at));
  const performance = (bundle.performance?.entries ?? [])
    .map((entry, index) => ({
      entry,
      index,
      end: entry.at + (entry.kind === 'long-task' || entry.kind === 'slow-interaction' ? entry.value : 0),
    }))
    .filter(({ entry, end }) => isDuration(entry.value) && kept(entry.at, end));
  const tasks = performance.filter(({ entry }) => entry.kind === 'long-task');

  const interactions = groupInteractions(performance.map(({ entry, index }) => ({ entry, index })));

  const issues: Issue[] = [];
  const claimed = new Set<number>();
  for (const entry of requests.filter((request) => isFailedRequest(request))) {
    const duration = isDuration(entry.duration) ? entry.duration : 0;
    const end = entry.at + duration;
    const trigger = actionBefore(entry.at);
    const logs = consoleRows.filter(
      ({ entry: log }) => (log.level === 'error' || log.level === 'warn') && log.at >= entry.at - 50 && log.at <= end + consoleWindow,
    );
    for (const { index } of logs) claimed.add(index);
    const retry = requests.find(
      (other) => other.at > entry.at && other.method === entry.method && pathOf(other.url) === pathOf(entry.url) && !isFailedRequest(other),
    );
    const next = stepAfter(retry ? retry.at + retry.duration : end);
    const networkError = entry.status === 0;
    const chain: IssueLink[] = [
      ...(trigger ? [stepLink(trigger, 'trigger')] : []),
      {
        ref: { kind: 'request', id: entry.id },
        role: 'cause',
        at: clock(entry.at),
        label: STRINGS.request(entry),
        detail: STRINGS.status(entry),
        tone: 'bad',
      },
      ...logs.map(({ entry: log, index }): IssueLink => ({
        ref: { kind: 'console', index },
        role: 'effect',
        at: clock(log.at),
        label: log.message,
        detail: log.level,
        ...(log.level === 'error' ? { tone: 'bad' as const } : { tone: 'warn' as const }),
      })),
      ...(retry
        ? [
            {
              ref: { kind: 'request', id: retry.id },
              role: 'retry',
              at: clock(retry.at),
              label: STRINGS.retried(retry),
              detail: STRINGS.status(retry),
              tone: 'ok',
            } satisfies IssueLink,
          ]
        : []),
      ...(next ? [stepLink(next, 'next', STRINGS.nextStep)] : []),
    ];
    issues.push({
      id: `failed-request:${entry.id}`,
      kind: 'failed-request',
      severity: 'failure',
      layer: networkError ? 'network' : 'backend',
      title: STRINGS.failedTitle(trigger?.step.label, entry),
      short: STRINGS.failedShort(entry),
      reason: networkError ? STRINGS.noAnswer(entry) : entry.status >= 500 ? STRINGS.serverFailed(entry) : STRINGS.serverRejected(entry),
      at: clock(entry.at),
      end: clock(end),
      sourceAt: entry.at,
      primary: { kind: 'request', id: entry.id },
      ...(trigger ? { trigger: { kind: 'step' as const, index: trigger.index } } : {}),
      chain,
    });
  }

  for (const { entry, index } of consoleRows.filter((row) => row.entry.level === 'error' && !claimed.has(row.index))) {
    const trigger = actionBefore(entry.at);
    issues.push({
      id: `console-error:${index}`,
      kind: 'console-error',
      severity: 'failure',
      layer: 'frontend',
      title: STRINGS.errorTitle(trigger?.step.label, entry.message),
      short: entry.message,
      reason: STRINGS.errorReason,
      at: clock(entry.at),
      end: clock(entry.at),
      sourceAt: entry.at,
      primary: { kind: 'console', index },
      ...(trigger ? { trigger: { kind: 'step' as const, index: trigger.index } } : {}),
      chain: [
        ...(trigger ? [stepLink(trigger, 'trigger')] : []),
        { ref: { kind: 'console', index }, role: 'cause', at: clock(entry.at), label: entry.message, detail: entry.level, tone: 'bad' },
      ],
    });
  }

  const explained = new Set<number>();
  for (const interaction of interactions.filter(({ value }) => value > budgets.interaction[0])) {
    const overlapping = tasks
      .filter(({ entry, end }) => entry.at < interaction.end + 20 && end > interaction.at - 20)
      .toSorted((a, b) => b.entry.value - a.entry.value);
    for (const { index } of overlapping) explained.add(index);
    const inflight = requests.filter(
      (entry) => entry.at < interaction.end && entry.at + (isDuration(entry.duration) ? entry.duration : 0) > interaction.at,
    ).length;
    const verdict = verdictFor(interaction.value, budgets.interaction);
    const trigger = actionBefore(interaction.at);
    const first = interaction.indexes[0]!;
    issues.push({
      id: `slow-interaction:${first}`,
      kind: 'slow-interaction',
      severity: verdict === 'poor' ? 'poor' : 'needs-improvement',
      layer: 'frontend',
      title: STRINGS.slowTitle(trigger?.step.label, interaction.value),
      short: STRINGS.slowShort(interaction.events.at(-1), interaction.value),
      reason: overlapping[0] ? STRINGS.slowBusy(overlapping[0].entry.value, inflight) : STRINGS.slowIdle(inflight),
      at: clock(interaction.at),
      end: clock(interaction.end),
      sourceAt: interaction.at,
      primary: { kind: 'performance', index: first },
      ...(trigger ? { trigger: { kind: 'step' as const, index: trigger.index } } : {}),
      value: interaction.value,
      verdict,
      chain: [
        ...(trigger ? [stepLink(trigger, 'trigger')] : []),
        {
          ref: { kind: 'performance', index: first },
          role: 'effect',
          at: clock(interaction.at),
          label: STRINGS.interaction(interaction.events),
          detail: STRINGS.toPaint(interaction.value),
          tone: verdict === 'poor' ? 'bad' : 'warn',
        },
        ...overlapping.map(({ entry, index }): IssueLink => ({
          ref: { kind: 'performance', index },
          role: 'cause',
          at: clock(entry.at),
          label: STRINGS.busy,
          detail: ms(entry.value),
          tone: 'warn',
        })),
      ],
    });
  }

  for (const { entry, index, end } of tasks.filter((row) => !explained.has(row.index) && row.entry.value > budgets['long-task'][1])) {
    const trigger = actionBefore(entry.at);
    issues.push({
      id: `long-task:${index}`,
      kind: 'long-task',
      severity: 'poor',
      layer: 'frontend',
      title: STRINGS.frozeTitle(trigger?.step.label, entry.value),
      short: STRINGS.frozeShort(entry.value),
      reason: STRINGS.frozeReason,
      at: clock(entry.at),
      end: clock(end),
      sourceAt: entry.at,
      primary: { kind: 'performance', index },
      ...(trigger ? { trigger: { kind: 'step' as const, index: trigger.index } } : {}),
      value: entry.value,
      verdict: 'poor',
      chain: [
        ...(trigger ? [stepLink(trigger, 'trigger')] : []),
        {
          ref: { kind: 'performance', index },
          role: 'cause',
          at: clock(entry.at),
          label: STRINGS.busy,
          detail: ms(entry.value),
          tone: 'bad',
        },
      ],
    });
  }

  const medians = new Map<string, number>();
  const ok = requests.filter((entry) => !isFailedRequest(entry) && !hasNoResponse(entry) && isDuration(entry.duration));
  for (const host of new Set(ok.map((entry) => hostOf(entry.url))))
    medians.set(host, median(ok.filter((entry) => hostOf(entry.url) === host).map((entry) => entry.duration)));
  const factor = options.slowRequestFactor ?? 4;
  const minimum = options.slowRequestMinimum ?? 1000;
  for (const entry of ok.filter((request) => request.duration >= Math.max(minimum, factor * (medians.get(hostOf(request.url)) ?? 0)))) {
    const trigger = actionBefore(entry.at);
    const hostMedian = Math.max(1, medians.get(hostOf(entry.url)) ?? 1);
    issues.push({
      id: `slow-request:${entry.id}`,
      kind: 'slow-request',
      severity: 'needs-improvement',
      layer: 'backend',
      title: STRINGS.slowRequestTitle(entry),
      short: STRINGS.slowRequestShort(entry),
      reason: STRINGS.slowRequestReason(entry.duration / hostMedian),
      at: clock(entry.at),
      end: clock(entry.at + entry.duration),
      sourceAt: entry.at,
      primary: { kind: 'request', id: entry.id },
      ...(trigger ? { trigger: { kind: 'step' as const, index: trigger.index } } : {}),
      value: entry.duration,
      chain: [
        ...(trigger ? [stepLink(trigger, 'trigger')] : []),
        {
          ref: { kind: 'request', id: entry.id },
          role: 'cause',
          at: clock(entry.at),
          label: STRINGS.request(entry),
          detail: ms(entry.duration),
          tone: 'warn',
        },
      ],
    });
  }

  // why: the latest candidate is the page's LCP; only a late one is a problem.
  const lcp = performance.filter(({ entry }) => entry.kind === 'largest-contentful-paint').at(-1);
  if (lcp && lcp.entry.value > budgets.lcp[0]) {
    const verdict = verdictFor(lcp.entry.value, budgets.lcp);
    issues.push({
      id: `slow-paint:${lcp.index}`,
      kind: 'slow-paint',
      severity: verdict === 'poor' ? 'poor' : 'needs-improvement',
      layer: 'frontend',
      title: STRINGS.paintTitle(lcp.entry.value),
      short: STRINGS.paintShort(lcp.entry.value),
      reason: STRINGS.paintReason,
      at: clock(lcp.entry.at),
      end: clock(lcp.entry.at),
      sourceAt: lcp.entry.at,
      primary: { kind: 'performance', index: lcp.index },
      value: lcp.entry.value,
      verdict,
      chain: [
        {
          ref: { kind: 'performance', index: lcp.index },
          role: 'cause',
          at: clock(lcp.entry.at),
          label: STRINGS.largestPaint,
          detail: ms(lcp.entry.value),
          tone: verdict === 'poor' ? 'bad' : 'warn',
        },
      ],
    });
  }

  for (const issue of issues) issue.chain.sort((a, b) => a.at - b.at);
  return issues.sort(byImportance);
}
