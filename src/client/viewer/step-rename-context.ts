import { createContext, useContext, useSyncExternalStore } from 'react';

import type { ReplayStep } from '../../shared/replay.ts';
import type { RenameStore, RenameSurface } from './step-rename.ts';

/** Inline renaming for the viewer's step labels (steps list and captions); absent where renaming is not offered. */
export interface StepRenaming {
  /** Stored names by step key. */
  names: Readonly<Record<string, string>>;
  /** The key of each shown step. */
  keys: readonly string[];
  allowed: boolean;
  store: RenameStore;
  start: (index: number, surface: RenameSurface, label: string, wasPlaying?: boolean) => void;
  change: (draft: string) => void;
  /** Saves (or, with `reset`, restores the automatic label) and ends the session. */
  finish: (action: 'save' | 'cancel' | 'reset') => void;
}

export const StepRenamingContext = createContext<StepRenaming | null>(null);

export const useStepRenaming = () => useContext(StepRenamingContext);

/** The open rename, if any; re-renders on every keystroke, so only the inputs read it. */
export function useRenameSession(renaming: StepRenaming) {
  return useSyncExternalStore(renaming.store.subscribe, renaming.store.get);
}

/** The steps with their stored names as labels; the same array when nothing is renamed. */
export function labelledSteps(steps: ReplayStep[], renaming: StepRenaming | null): ReplayStep[] {
  if (!renaming || Object.keys(renaming.names).length === 0) return steps;
  return steps.map((step, index) => {
    const name = renaming.names[renaming.keys[index] ?? ''];
    return name ? { ...step, label: name } : step;
  });
}

const NO_SUBSCRIBE = () => () => {};
// oxlint-disable-next-line unicorn/no-useless-undefined -- why: a stable no-op subscription value for useSyncExternalStore.
const NO_KEY = () => undefined;

/** The key of the step being renamed on `surface`, undefined otherwise; unlike the session it does not change as one types. */
export function useRenamingKey(renaming: StepRenaming | null, surface: RenameSurface) {
  return useSyncExternalStore(
    renaming ? renaming.store.subscribe : NO_SUBSCRIBE,
    renaming ? () => (renaming.store.get()?.surface === surface ? renaming.store.get()?.key : undefined) : NO_KEY,
  );
}
