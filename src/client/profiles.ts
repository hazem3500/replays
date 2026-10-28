import type { ProfileInfo } from '../shared/profiles.ts';
import { replayProfileId, type ReplayBundle } from '../shared/replay.ts';

let cached: readonly ProfileInfo[] | undefined;
let override: readonly ProfileInfo[] | undefined;

function isProfileInfo(item: unknown): item is ProfileInfo {
  return typeof item === 'object' && item !== null && 'id' in item && typeof item.id === 'string';
}

/**
 * The deployment's profiles, written into index.html by the server (`<meta name="app-profiles">`, in tab order).
 * Empty in a plain core: then the index has no segments, the upload dialog no picker and the viewer no defaults.
 * A page rendered by a server from before the rename names the meta `app-purposes`.
 */
export function pageProfiles(): readonly ProfileInfo[] {
  if (override) return override;
  if (cached) return cached;
  if (typeof document === 'undefined') return [];
  const meta =
    document.querySelector<HTMLMetaElement>('meta[name="app-profiles"]') ??
    document.querySelector<HTMLMetaElement>('meta[name="app-purposes"]');
  const content = meta?.content ?? '';
  try {
    const parsed: unknown = content ? JSON.parse(content) : [];
    cached = Array.isArray(parsed) ? parsed.filter(isProfileInfo) : [];
  } catch {
    cached = [];
  }
  return cached;
}

/** Tests only. */
export function setPageProfilesForTests(value: readonly ProfileInfo[] | undefined) {
  override = value;
}

/** Inferred profiles by replay id, from the bundle response's `x-replay-profile` header (queries.ts). */
const served = new Map<string, string>();

/** `x-replay-profile: triage; inferred` → `triage`. */
export function rememberServedProfile(id: string, header: string | null) {
  const profile = header?.split(';')[0]?.trim();
  if (profile) served.set(id, profile);
}

/** The replay's profile as this deployment knows it: `meta.profile` (or the older `meta.purpose`), else the inferred one. */
export function replayProfile(bundle: Pick<ReplayBundle, 'meta'>): ProfileInfo | undefined {
  let id: string | undefined;
  try {
    id = replayProfileId(bundle.meta) ?? served.get(bundle.meta.id);
  } catch {
    id = bundle.meta.profile;
  }
  return id ? pageProfiles().find((profile) => profile.id === id) : undefined;
}

/**
 * The profiles the index offers as tabs: the deployment's own, plus a built-in one once some replay has it or the URL
 * names it, so a plain core shows no tabs until they would hold something.
 */
export function indexProfiles(
  profiles: readonly ProfileInfo[],
  counts: Readonly<Record<string, number>> | undefined,
  selected?: string,
): readonly ProfileInfo[] {
  return profiles.filter((profile) => !profile.builtIn || profile.id === selected || (counts?.[profile.id] ?? 0) > 0);
}
