import { isFailedRequest, type ReplayConsoleEntry, type ReplayNetworkEntry, type ReplayPerformanceEntry } from '../../shared/replay.ts';
import { plural } from '../plural.ts';

/**
 * One compact count on an inspector tab: the whole recording's total, tinted when part of it is a problem (red for
 * errors and failures, amber for warnings and slow work). `label` is its spoken form; the pill itself is decorative.
 */
export interface TabBadge {
  value: number;
  tone?: 'danger' | 'warning';
  label: string;
}

function badge(total: number, noun: readonly [string, string], problems: readonly (readonly [number, string, 'danger' | 'warning'])[]) {
  if (total === 0) return undefined;
  const found = problems.filter(([count]) => count > 0);
  const label = [plural(total, ...noun), ...found.map(([count, word]) => `${count} ${word}`)].join(', ');
  const tone = found[0]?.[2];
  return tone ? { value: total, tone, label } : { value: total, label };
}

export function consoleBadge(entries: readonly ReplayConsoleEntry[]): TabBadge | undefined {
  const errors = entries.filter((entry) => entry.level === 'error').length;
  const warnings = entries.filter((entry) => entry.level === 'warn').length;
  return badge(
    entries.length,
    ['entry', 'entries'],
    [
      [errors, errors === 1 ? 'error' : 'errors', 'danger'],
      [warnings, warnings === 1 ? 'warning' : 'warnings', 'warning'],
    ],
  );
}

export function networkBadge(entries: readonly ReplayNetworkEntry[]): TabBadge | undefined {
  const failed = entries.filter(isFailedRequest).length;
  return badge(entries.length, ['request', 'requests'], [[failed, 'failed', 'danger']]);
}

/** Long tasks and slow interactions are the problems among performance signals; paints are milestones. */
export function performanceBadge(entries: readonly ReplayPerformanceEntry[]): TabBadge | undefined {
  const slow = entries.filter((entry) => entry.kind === 'long-task' || entry.kind === 'slow-interaction').length;
  return badge(entries.length, ['signal', 'signals'], [[slow, 'slow', 'warning']]);
}

export function stepsBadge(count: number): TabBadge | undefined {
  return count > 0 ? { value: count, label: plural(count, 'step') } : undefined;
}
