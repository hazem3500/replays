import { MAX_LABEL } from './edit-list.ts';
import type { ReplayStep } from './replay.ts';

/** Most renamed steps one replay can hold. */
export const MAX_STEP_NAMES = 500;

/**
 * The key a step's name is stored under (`edits.stepNames`): its original start in whole ms, with `#n` for the nth
 * further step starting in that same ms. Keys follow the recording, so they survive cuts and relabelling.
 */
export function stepNameKeys(steps: ReadonlyArray<Pick<ReplayStep, 'at'>>): string[] {
  const seen = new Map<string, number>();
  return steps.map(({ at }) => {
    const base = String(Math.round(at));
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count ? `${base}#${count}` : base;
  });
}

/** The steps with their stored names as labels; the same array when nothing is renamed. */
export function renameSteps<T extends Pick<ReplayStep, 'at' | 'label'>>(
  steps: readonly T[],
  names: Readonly<Record<string, string>> | undefined,
) {
  if (!names || Object.keys(names).length === 0) return steps;
  const keys = stepNameKeys(steps);
  return steps.map((step, index) => {
    const name = names[keys[index]!];
    return name ? { ...step, label: name } : step;
  });
}

/** `name` trimmed and capped for one step; an empty name removes it (the step goes back to its automatic label). */
export function withStepName(names: Readonly<Record<string, string>> | undefined, key: string, name: string) {
  const { [key]: _previous, ...rest } = names ?? {};
  const value = name.trim().slice(0, MAX_LABEL).trim();
  const next = value ? { ...rest, [key]: value } : rest;
  return Object.keys(next).length ? next : undefined;
}

/** The edit list without its step names (the part of it that changes what plays). */
export function withoutStepNames<T extends { stepNames?: unknown }>(edits: T): Omit<T, 'stepNames'> {
  const { stepNames: _names, ...rest } = edits;
  return rest;
}
