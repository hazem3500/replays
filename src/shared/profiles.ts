/**
 * Profile ids, like plugin names: `triage`, `design-review`. A profile says why a replay was recorded (triage, a
 * design review, a walkthrough…) and so how it is kept (retention), opened (viewer defaults), listed (index segments)
 * and drawn (poster). A deployment declares them in the config file (`profiles`) or a plugin registers them
 * (`api.profile`); inference lives on the server (src/server/profiles.ts). Profiles used to be called purposes;
 * src/shared/purposes.ts keeps the deprecated names.
 */
export const PROFILE_ID = /^[a-z][a-z0-9-]{0,39}$/;

export function isProfileId(value: unknown): value is string {
  return typeof value === 'string' && PROFILE_ID.test(value);
}

/** Where the viewer opens a replay of this profile: at the start, or just before its first error. */
export type ProfileOpenAt = 'start' | 'first-error';

/** How the viewer first shows a replay of this profile. A person's own stored choice (captions, the folded panel) wins. */
export interface ProfileViewerDefaults {
  /** Default `'start'`. A permalink (`?t=`, `#step-…`) always wins. */
  openAt?: ProfileOpenAt;
  /** With `openAt: 'first-error'`: how long before the error to land (ms, default 1000). */
  leadMs?: number;
  /** The bottom panel (Console, Network, …) open or folded to its tab row, when the person has no stored choice. */
  inspector?: 'open' | 'collapsed';
  /** Step captions on the player, when the person has no stored choice. */
  captions?: boolean;
}

/** The poster (list thumbnail) moment: the middle step settled (the default), just after the first error, or after the last step. */
export type PosterMoment = 'middle-step' | 'first-error' | 'last-step';
export const POSTER_MOMENTS: readonly PosterMoment[] = ['middle-step', 'first-error', 'last-step'];

/** A profile as the config file declares it (`profiles: [...]`); `api.profile` takes the same plus `infer`. */
export interface ProfileConfig {
  id: string;
  /** Shown on the index tab, the upload picker and the viewer. */
  label: string;
  /** Lower first: tab order, and the order inference tries profiles in. Default 0; ties keep declaration order. */
  order?: number;
  /** Whole days to keep a replay of this profile; 0 keeps it forever (explicit profiles only). Default: `retentionDays`. */
  retentionDays?: number;
  viewer?: ProfileViewerDefaults;
  /** Default `'middle-step'`. */
  poster?: PosterMoment;
}

/** A profile as `GET /api/config` and the page (`<meta name="app-profiles">`) list it. */
export interface ProfileInfo {
  id: string;
  label: string;
  order: number;
  /** The effective window (config, plugin or `RETENTION_PROFILE_<ID>_DAYS`); absent means the default window. */
  retentionDays?: number;
  viewer?: ProfileViewerDefaults;
  poster?: PosterMoment;
  /** A plugin can infer it for replays uploaded without `meta.profile`. */
  inferable?: boolean;
}

export const DEFAULT_LEAD_MS = 1000;
const MAX_LEAD_MS = 60_000;
const MAX_LABEL = 40;
const CONFIG_KEYS = new Set(['id', 'label', 'order', 'retentionDays', 'viewer', 'poster']);
const VIEWER_KEYS = new Set(['openAt', 'leadMs', 'inspector', 'captions']);

const envId = (id: string) => id.toUpperCase().replaceAll('-', '_');

/** `RETENTION_PROFILE_<ID>_DAYS`: the id upper-cased, `-` as `_`. */
export function profileRetentionEnv(id: string) {
  return `RETENTION_PROFILE_${envId(id)}_DAYS`;
}

/** The deprecated spelling of profileRetentionEnv, read only when the new one is unset. */
export function legacyProfileRetentionEnv(id: string) {
  return `RETENTION_PURPOSE_${envId(id)}_DAYS`;
}

export function isRetentionDays(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 3650;
}

/**
 * Throws a readable error unless `value` is a well-formed profile. `extra` lists keys allowed besides the config
 * ones (`infer` for plugins).
 */
export function assertProfileConfig(value: unknown, where = 'profile', extra: readonly string[] = []): asserts value is ProfileConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${where} must be an object { id, label }`);
  const profile = value as Record<string, unknown>;
  const unknown = Object.keys(profile).filter((key) => !CONFIG_KEYS.has(key) && !extra.includes(key));
  if (unknown.length) throw new Error(`${where} has unknown keys: ${unknown.join(', ')}`);
  if (!isProfileId(profile.id))
    throw new Error(`${where}.id must look like "triage" or "design-review" (got ${JSON.stringify(profile.id)})`);
  const label = profile.label;
  if (typeof label !== 'string' || !label.trim() || label.length > MAX_LABEL)
    throw new Error(`${where}.label must be a non-empty string of at most ${MAX_LABEL} characters`);
  if (profile.order !== undefined && !Number.isFinite(profile.order)) throw new Error(`${where}.order must be a finite number`);
  if (profile.retentionDays !== undefined && !isRetentionDays(profile.retentionDays))
    throw new Error(`${where}.retentionDays must be a whole number of days from 0 (never expire) to 3650`);
  if (profile.poster !== undefined && !POSTER_MOMENTS.includes(profile.poster as PosterMoment))
    throw new Error(`${where}.poster must be one of ${POSTER_MOMENTS.join(', ')}`);
  if (profile.viewer !== undefined) {
    const viewer = profile.viewer as Record<string, unknown>;
    if (!viewer || typeof viewer !== 'object' || Array.isArray(viewer)) throw new Error(`${where}.viewer must be an object`);
    const extraViewer = Object.keys(viewer).filter((key) => !VIEWER_KEYS.has(key));
    if (extraViewer.length) throw new Error(`${where}.viewer has unknown keys: ${extraViewer.join(', ')}`);
    if (viewer.openAt !== undefined && viewer.openAt !== 'start' && viewer.openAt !== 'first-error')
      throw new Error(`${where}.viewer.openAt must be "start" or "first-error"`);
    if (
      viewer.leadMs !== undefined &&
      (typeof viewer.leadMs !== 'number' || !Number.isInteger(viewer.leadMs) || viewer.leadMs < 0 || viewer.leadMs > MAX_LEAD_MS)
    )
      throw new Error(`${where}.viewer.leadMs must be a whole number of milliseconds from 0 to ${MAX_LEAD_MS}`);
    if (viewer.inspector !== undefined && viewer.inspector !== 'open' && viewer.inspector !== 'collapsed')
      throw new Error(`${where}.viewer.inspector must be "open" or "collapsed"`);
    if (viewer.captions !== undefined && typeof viewer.captions !== 'boolean')
      throw new Error(`${where}.viewer.captions must be a boolean`);
  }
}

/** `meta.profile` on an upload, checked against the deployment's profiles; `undefined` when it is fine. */
export function profileProblem(profile: unknown, allowed: readonly string[]): string | undefined {
  if (profile === undefined) return undefined;
  if (!allowed.length)
    return 'replay.meta.profile is set, but this server defines no profiles (remove it, or declare profiles in the config)';
  if (typeof profile !== 'string' || !allowed.includes(profile))
    return `replay.meta.profile must be one of ${allowed.join(', ')} (got ${JSON.stringify(profile)})`;
  return undefined;
}

/** A record that may carry a profile under its deprecated name too: bundle meta, CLI options, filters. */
export interface AliasedProfile {
  profile?: string | undefined;
  purpose?: string | undefined;
}

/** `value.profile`, else the deprecated `value.purpose`. */
export function profileOf(value: AliasedProfile): string | undefined {
  return value.profile ?? value.purpose;
}

/** A deployment's profile list under its new name, else under the deprecated `purposes`. */
export function profilesOf<T>(value: { profiles?: T | undefined; purposes?: T | undefined }): T | undefined {
  return value.profiles ?? value.purposes;
}

/**
 * A value under its new name, else under its deprecated alias. Both set to different values is refused: `names`
 * reads like "meta.profile and meta.purpose".
 */
export function readAliased<T>(current: T | undefined, legacy: T | undefined, names: string): T | undefined {
  if (current !== undefined && legacy !== undefined && current !== legacy)
    throw new Error(`${names} disagree; set only the first (the second is a deprecated alias)`);
  return current ?? legacy;
}
