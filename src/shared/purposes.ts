/*
 * Purposes: why a replay was recorded (triage, a design review, a walkthrough…). The core defines none; a
 * deployment declares them in the config file (`purposes`) or a plugin registers them (`api.purpose`). A purpose
 * changes how a replay is kept (retention), opened (viewer defaults), listed (index segments) and drawn (poster).
 * Shared by the server, the viewer and the CLI; the inference functions live on the server (src/server/purposes.ts).
 */

/** Purpose ids, like plugin names: `triage`, `design-review`. */
export const PURPOSE_ID = /^[a-z][a-z0-9-]{0,39}$/;

export function isPurposeId(value: unknown): value is string {
  return typeof value === 'string' && PURPOSE_ID.test(value);
}

/** Where the viewer opens a replay of this purpose: at the start, or just before its first error. */
export type PurposeOpenAt = 'start' | 'first-error';

/** How the viewer first shows a replay of this purpose. A person's own stored choice (captions, the folded panel) wins. */
export interface PurposeViewerDefaults {
  /** Default `'start'`. A permalink (`?t=`, `#step-…`) always wins. */
  openAt?: PurposeOpenAt;
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

/** A purpose as the config file declares it (`purposes: [...]`); `api.purpose` takes the same plus `infer`. */
export interface PurposeConfig {
  id: string;
  /** Shown on the index tab, the upload picker and the viewer. */
  label: string;
  /** Lower first: tab order, and the order inference tries purposes in. Default 0; ties keep declaration order. */
  order?: number;
  /** Whole days to keep a replay of this purpose; 0 keeps it forever (explicit purposes only). Default: `retentionDays`. */
  retentionDays?: number;
  viewer?: PurposeViewerDefaults;
  /** Default `'middle-step'`. */
  poster?: PosterMoment;
}

/** A purpose as `GET /api/config` and the page (`<meta name="app-purposes">`) list it. */
export interface PurposeInfo {
  id: string;
  label: string;
  order: number;
  /** The effective window (config, plugin or `RETENTION_PURPOSE_<ID>_DAYS`); absent means the default window. */
  retentionDays?: number;
  viewer?: PurposeViewerDefaults;
  poster?: PosterMoment;
  /** A plugin can infer it for replays uploaded without `meta.purpose`. */
  inferable?: boolean;
}

export const DEFAULT_LEAD_MS = 1000;
const MAX_LEAD_MS = 60_000;
const MAX_LABEL = 40;
const CONFIG_KEYS = new Set(['id', 'label', 'order', 'retentionDays', 'viewer', 'poster']);
const VIEWER_KEYS = new Set(['openAt', 'leadMs', 'inspector', 'captions']);

/** `RETENTION_PURPOSE_<ID>_DAYS`: the id upper-cased, `-` as `_`. */
export function purposeRetentionEnv(id: string) {
  return `RETENTION_PURPOSE_${id.toUpperCase().replaceAll('-', '_')}_DAYS`;
}

export function isRetentionDays(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 3650;
}

/**
 * Throws a readable error unless `value` is a well-formed purpose. `extra` lists keys allowed besides the config
 * ones (`infer` for plugins).
 */
export function assertPurposeConfig(value: unknown, where = 'purpose', extra: readonly string[] = []): asserts value is PurposeConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${where} must be an object { id, label }`);
  const purpose = value as Record<string, unknown>;
  const unknown = Object.keys(purpose).filter((key) => !CONFIG_KEYS.has(key) && !extra.includes(key));
  if (unknown.length) throw new Error(`${where} has unknown keys: ${unknown.join(', ')}`);
  if (!isPurposeId(purpose.id)) throw new Error(`${where}.id must look like "triage" or "design-review" (got ${JSON.stringify(purpose.id)})`);
  const label = purpose.label;
  if (typeof label !== 'string' || !label.trim() || label.length > MAX_LABEL)
    throw new Error(`${where}.label must be a non-empty string of at most ${MAX_LABEL} characters`);
  if (purpose.order !== undefined && !Number.isFinite(purpose.order)) throw new Error(`${where}.order must be a finite number`);
  if (purpose.retentionDays !== undefined && !isRetentionDays(purpose.retentionDays))
    throw new Error(`${where}.retentionDays must be a whole number of days from 0 (never expire) to 3650`);
  if (purpose.poster !== undefined && !POSTER_MOMENTS.includes(purpose.poster as PosterMoment))
    throw new Error(`${where}.poster must be one of ${POSTER_MOMENTS.join(', ')}`);
  if (purpose.viewer !== undefined) {
    const viewer = purpose.viewer as Record<string, unknown>;
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
    if (viewer.captions !== undefined && typeof viewer.captions !== 'boolean') throw new Error(`${where}.viewer.captions must be a boolean`);
  }
}

/** `meta.purpose` on an upload, checked against the deployment's purposes; `undefined` when it is fine. */
export function purposeProblem(purpose: unknown, allowed: readonly string[]): string | undefined {
  if (purpose === undefined) return undefined;
  if (!allowed.length) return 'replay.meta.purpose is set, but this server defines no purposes (remove it, or declare purposes in the config)';
  if (typeof purpose !== 'string' || !allowed.includes(purpose))
    return `replay.meta.purpose must be one of ${allowed.join(', ')} (got ${JSON.stringify(purpose)})`;
  return undefined;
}
