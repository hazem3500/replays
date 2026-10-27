import { assertReplayId, isFailedRequest, type ReplayBundle, type ReplayConsoleEntry } from '../../shared/replay.ts';
import { collectErrors } from '../issues.ts';
import type { ComparisonSide } from './coordinator.ts';

export const SIDE_LABELS = { a: 'A · Before', b: 'B · After' } as const;

/** Only IDs or replay URLs belonging to this deployment; never fetch the submitted URL. */
export function comparisonReplayId(value: string, origin: string, base = '') {
  const input = value.trim();
  if (/^[a-z0-9][a-z0-9-]{0,79}$/.test(input)) return assertReplayId(input);
  let url: URL;
  try {
    url = new URL(input, `${origin}${base}/`);
  } catch {
    throw new Error('Enter a replay ID or a replay URL from this workspace.');
  }
  if (url.origin !== origin || url.username || url.password || !['https:', 'http:'].includes(url.protocol))
    throw new Error('Choose a replay from this workspace. External URLs are not loaded.');
  const prefix = base.replace(/\/+$/, '');
  if (prefix && !url.pathname.startsWith(`${prefix}/`)) throw new Error('This URL belongs to a different workspace.');
  const path = url.pathname.slice(prefix.length);
  const match = /^\/r\/([^/]+)(?:\/edit)?\/?$/.exec(path) ?? /^\/s\/[^/]+\/r\/([^/]+)\/?$/.exec(path);
  if (!match) throw new Error('Enter a replay ID or a replay URL from this workspace.');
  try {
    return assertReplayId(decodeURIComponent(match[1]!));
  } catch {
    throw new Error('The replay ID in this URL is invalid.');
  }
}

/** Unclamped: an event before the shared origin must not be misrepresented as occurring at zero. */
export function sharedEventTime(side: ComparisonSide, local: number, offsetB: number, offsetA = 0) {
  return local - (side === 'b' ? offsetB : offsetA);
}

function consoleLabel(message: string) {
  return `Console error: ${message.length > 120 ? `${message.slice(0, 119)}…` : message}`;
}

export function comparisonErrors(bundles: Partial<Record<ComparisonSide, ReplayBundle>>, offsetB: number, offsetA = 0) {
  return (['a', 'b'] as const)
    .flatMap((side) => {
      const bundle = bundles[side];
      if (!bundle) return [];
      const consoleEntries = new Map<string, { entries: ReplayConsoleEntry[]; next: number }>();
      for (const entry of bundle.console) {
        if (entry.level !== 'error') continue;
        const key = `${entry.at}\0${consoleLabel(entry.message)}`;
        const group = consoleEntries.get(key) ?? { entries: [], next: 0 };
        group.entries.push(entry);
        consoleEntries.set(key, group);
      }
      const requests = new Map(bundle.network.map((entry) => [entry.id, entry]));
      return collectErrors(bundle).map((error, index) => {
        const group = error.kind === 'console' ? consoleEntries.get(`${error.at}\0${error.label}`) : undefined;
        return {
          ...error,
          side,
          id: `${side}-${error.kind}-${index}`,
          sharedAt: sharedEventTime(side, error.at, offsetB, offsetA),
          consoleEntry: group ? group.entries[group.next++] : undefined,
          request: error.requestId ? requests.get(error.requestId) : undefined,
        };
      });
    })
    .sort((a, b) => a.sharedAt - b.sharedAt || a.id.localeCompare(b.id));
}

export type ComparisonError = ReturnType<typeof comparisonErrors>[number];

export function evidenceSuggestion(bundles: Partial<Record<ComparisonSide, ReplayBundle>>) {
  const available = Object.values(bundles);
  if (available.some((bundle) => bundle.console.some((entry) => entry.level === 'error') || bundle.network.some(isFailedRequest)))
    return 'Debugging may help: this pair contains captured errors or failed requests.';
  if (available.some((bundle) => bundle.performance?.entries.length))
    return 'Performance may help: this pair contains captured performance observations.';
  if (available.some((bundle) => bundle.steps.length)) return 'Walkthrough may help: this pair contains recorded steps.';
  return 'Choose a layout for your task. Suggestions never change your layout.';
}
