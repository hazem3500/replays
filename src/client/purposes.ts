import type { PurposeInfo } from '../shared/purposes.ts';
import type { ReplayBundle } from '../shared/replay.ts';

let cached: readonly PurposeInfo[] | undefined;
let override: readonly PurposeInfo[] | undefined;

/**
 * The deployment's purposes, written into index.html by the server (`<meta name="app-purposes">`, in tab order).
 * Empty in a plain core: then the index has no segments, the upload dialog no picker and the viewer no defaults.
 */
export function pagePurposes(): readonly PurposeInfo[] {
  if (override) return override;
  if (cached) return cached;
  if (typeof document === 'undefined') return [];
  const content = document.querySelector<HTMLMetaElement>('meta[name="app-purposes"]')?.content ?? '';
  try {
    const parsed: unknown = content ? JSON.parse(content) : [];
    cached = Array.isArray(parsed) ? (parsed as PurposeInfo[]).filter((item) => item && typeof item.id === 'string') : [];
  } catch {
    cached = [];
  }
  return cached;
}

/** Tests only. */
export function setPagePurposesForTests(value: readonly PurposeInfo[] | undefined) {
  override = value;
}

/** Inferred purposes by replay id, from the bundle response's `x-replay-purpose` header (queries.ts). */
const served = new Map<string, string>();

/** `x-replay-purpose: triage; inferred` → `triage`. */
export function rememberServedPurpose(id: string, header: string | null) {
  const purpose = header?.split(';')[0]?.trim();
  if (purpose) served.set(id, purpose);
}

/** The replay's purpose as this deployment knows it: `meta.purpose`, else the one the server inferred. */
export function replayPurpose(bundle: Pick<ReplayBundle, 'meta'>): PurposeInfo | undefined {
  const id = bundle.meta.purpose ?? served.get(bundle.meta.id);
  return id ? pagePurposes().find((purpose) => purpose.id === id) : undefined;
}
