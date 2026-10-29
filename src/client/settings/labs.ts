import { useSyncExternalStore } from 'react';

import {
  BETA_FLAG_IDS,
  type BetaChoices,
  type BetaFlagId,
  type BetaFlags,
  betaEffective,
  betaFlag,
  betaFromTokens,
  NO_BETA,
} from '../../shared/beta-flags.ts';
import { readStorage, removeStorage, writeStorage } from '../storage.ts';
import { pageMeta } from '../page-meta.ts';

/**
 * The page's side of the beta flags (src/shared/beta-flags.ts): what the server allows (`<meta name="app-beta">`, written
 * into index.html, so it is known synchronously at boot) and what this person chose under Settings › Labs.
 *
 * Choices live in a `LabsChoiceStore`. Today that is this browser's localStorage; once sign-in carries preferences, a
 * per-user store can be installed with `setLabsChoiceStore` without touching any call site.
 */
export interface LabsChoiceStore {
  get(id: BetaFlagId): boolean | undefined;
  /** `undefined` clears the choice (back to the flag's default). */
  set(id: BetaFlagId, value: boolean | undefined): void;
  /** Called when a choice changes elsewhere (another tab, another device). Returns an unsubscribe. */
  subscribe(listener: () => void): () => void;
}

const STORAGE: Record<BetaFlagId, { key: string; on: string; off: string }> = {
  editor: { key: 'replays-labs-editor', on: 'on', off: 'off' },
  malleable: { key: 'replays-labs-malleable', on: 'on', off: 'off' },
};

const CHANGE = 'replays-labs-change';
const volatile: BetaChoices = {};

export const browserLabsChoices: LabsChoiceStore = {
  get(id) {
    const storage = STORAGE[id];
    const value = readStorage(storage.key);
    if (value === storage.on) return true;
    if (value === storage.off) return false;
    return value === null ? volatile[id] : undefined;
  },
  set(id, value) {
    const storage = STORAGE[id];
    if (value === undefined) {
      delete volatile[id];
      removeStorage(storage.key);
    } else {
      volatile[id] = value;
      writeStorage(storage.key, value ? storage.on : storage.off);
    }
  },
  subscribe(listener) {
    if (typeof window === 'undefined') return () => {};
    window.addEventListener('storage', listener);
    return () => window.removeEventListener('storage', listener);
  },
};

let store: LabsChoiceStore = browserLabsChoices;
const listeners = new Set<() => void>();
let unsubscribeStore: (() => void) | undefined;
let version = 0;

function notify() {
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    unsubscribeStore = store.subscribe(notify);
    if (typeof window !== 'undefined') window.addEventListener(CHANGE, notify);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size) return;
    unsubscribeStore?.();
    unsubscribeStore = undefined;
    if (typeof window !== 'undefined') window.removeEventListener(CHANGE, notify);
  };
}

/** Swap the choice store (a per-user store once auth carries preferences; tests). Returns the previous one. */
export function setLabsChoiceStore(next: LabsChoiceStore) {
  const previous = store;
  if (unsubscribeStore) {
    unsubscribeStore();
    unsubscribeStore = next.subscribe(notify);
  }
  store = next;
  notify();
  return previous;
}

let allowedOverride: Partial<BetaFlags> | undefined;

/** The flags this server allows: the ceiling (src/server/beta.ts). */
export function betaAllowedFlags(): BetaFlags {
  if (allowedOverride) return { ...NO_BETA, ...allowedOverride };
  return betaFromTokens(pageMeta('app-beta'));
}

export function betaAllowed(id: BetaFlagId) {
  return betaAllowedFlags()[id];
}

/** This person's saved choice, or undefined (the default applies). */
export function betaChoice(id: BetaFlagId): boolean | undefined {
  try {
    return store.get(id);
  } catch {
    return undefined;
  }
}

/** Allowed by the server ∧ chosen (or on by default). */
export function betaEnabled(id: BetaFlagId) {
  return betaEffective(id, betaAllowed(id), betaChoice(id));
}

export function setBetaChoice(id: BetaFlagId, value: boolean | undefined) {
  store.set(id, value);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGE));
  else notify();
}

/** What each flag was when this page loaded: `applies: 'reload'` flags keep that value until a reload. */
const atLoad: Partial<BetaFlags> = {};
export function betaEnabledAtLoad(id: BetaFlagId) {
  atLoad[id] ??= betaEnabled(id);
  return atLoad[id];
}

/** Live view of one flag for React (Settings › Labs, and any view that wants to follow a change without a reload). */
export function useBetaFlag(id: BetaFlagId) {
  useSyncExternalStore(
    subscribe,
    () => version,
    () => 0,
  );
  const allowed = betaAllowed(id);
  const choice = betaChoice(id);
  const enabled = betaEffective(id, allowed, choice);
  const pendingReload = betaFlag(id).applies === 'reload' && enabled !== betaEnabledAtLoad(id);
  return { allowed, choice, enabled, pendingReload, setEnabled: (value: boolean) => setBetaChoice(id, value) };
}

/** Tests only: pretend the server allowed these flags (undefined reads the meta again). */
export function setBetaAllowedForTests(value: Partial<BetaFlags> | undefined) {
  allowedOverride = value;
  for (const id of BETA_FLAG_IDS) delete atLoad[id];
  notify();
}
