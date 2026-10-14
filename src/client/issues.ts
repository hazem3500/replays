import type { ReplayBundle } from '../shared/replay.ts';
import { isFailedRequest, requestPath } from './format.ts';

export interface ReplayError {
  at: number;
  kind: 'console' | 'network';
  label: string;
  /** Network request id, for expanding the matching row. */
  requestId?: string;
}

/** Console errors and failed requests (net::ERR_* or >= 400), in time order. */
export function collectErrors(bundle: Pick<ReplayBundle, 'console' | 'network'>): ReplayError[] {
  const errors: ReplayError[] = [];
  for (const entry of bundle.console) {
    if (entry.level !== 'error') continue;
    const message = entry.message.length > 120 ? `${entry.message.slice(0, 119)}…` : entry.message;
    errors.push({ at: entry.at, kind: 'console', label: `Console error: ${message}` });
  }
  for (const entry of bundle.network) {
    if (!isFailedRequest(entry)) continue;
    const status = entry.status === 0 ? entry.statusText : `${entry.status}${entry.statusText ? ` ${entry.statusText}` : ''}`;
    errors.push({
      at: entry.at,
      kind: 'network',
      label: `${entry.method} ${requestPath(entry.url)} failed (${status})`,
      requestId: entry.id,
    });
  }
  return errors.sort((a, b) => a.at - b.at);
}

/** Margin so "next" from an error's own timestamp moves on instead of sticking. */
const EPSILON = 50;

export function nextError(errors: readonly ReplayError[], time: number) {
  return errors.find((error) => error.at > time + EPSILON);
}

export function previousError(errors: readonly ReplayError[], time: number) {
  return errors.findLast((error) => error.at < time - EPSILON);
}
