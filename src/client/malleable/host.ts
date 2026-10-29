import { viewerRegistry } from '../plugins/registry.ts';
import { useSyncExternalStore } from 'react';

import { closedPolicy, type HostVersions, type MalleablePolicy } from '../../shared/malleable-policy.ts';
import { apiUrl } from '../api/fetch.ts';

/**
 * What the host deployment says about user plugins, read once from `GET /api/config`: its policy (`malleable`) and its
 * versions (`core`, `distribution`). Until it has arrived, `hostPolicy()` waits, so a draft installed during start-up
 * cannot slip a denied capability through; if it cannot be read, writes are denied (`closedPolicy`).
 */
export interface HostInfo {
  policy: MalleablePolicy;
  versions: HostVersions;
  /** False until `/api/config` answered (or failed). */
  loaded: boolean;
}

let info: HostInfo = { policy: closedPolicy(), versions: { core: '' }, loaded: false };
const listeners = new Set<() => void>();
let loading: Promise<HostInfo> | undefined;

function set(next: HostInfo) {
  info = next;
  viewerRegistry.setPolicy(next.policy);
  for (const listener of listeners) listener();
}

export function loadHost(): Promise<HostInfo> {
  loading ??= fetch(apiUrl('config'))
    .then(async (response) => {
      if (!response.ok) throw new Error(`config ${response.status}`);
      const body = (await response.json()) as { malleable?: MalleablePolicy; core?: string; distribution?: HostVersions['distribution'] };
      set({
        policy: body.malleable ?? closedPolicy(),
        versions: { core: body.core ?? '', ...(body.distribution ? { distribution: body.distribution } : {}) },
        loaded: true,
      });
      return info;
    })
    .catch((error: unknown) => {
      console.warn('the host’s plugin policy could not be read; write capabilities are denied:', error);
      set({ ...info, loaded: true });
      return info;
    });
  return loading;
}

/** The policy to enforce now (waits for the first load). */
export const hostPolicy = async () => (await loadHost()).policy;
export const hostInfo = () => info;
export const useHost = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => info,
  );

/** Tests only. */
export function setHostForTests(next: Partial<HostInfo> | undefined) {
  if (!next) {
    loading = undefined;
    info = { policy: closedPolicy(), versions: { core: '' }, loaded: false };
    return;
  }
  set({ ...info, ...next, loaded: true });
  loading = Promise.resolve(info);
}
