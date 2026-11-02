import type { ReplayConsoleEntry } from '../../shared/replay.ts';
import { plural } from '../plural.ts';

/**
 * One compact count on an inspector tab: the whole recording's total, filled with the problem's colour when part of it
 * is a problem (red for errors and failures, amber for warnings and slow work). `label` is its spoken form; the badge
 * itself is decorative.
 */
export interface TabBadge {
  value: number;
  tone?: 'danger' | 'warning';
  label: string;
}

function badge(total: number, noun: readonly [string, string], problems: readonly (readonly [number, string, 'danger' | 'warning'])[]) {
  if (total === 0) return;
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

/** What a tab's badge shows: nothing for zero, the count up to 99, then "99+" so the badge keeps its small size. */
export function badgeText(value: number) {
  if (value <= 0) return;
  return value > 99 ? '99+' : String(value);
}

export function stepsBadge(count: number): TabBadge | undefined {
  return count > 0 ? { value: count, label: plural(count, 'step') } : undefined;
}
