import { profileOfSummary, summaryProfile, withoutProfile, type ReplaySummary } from '../shared/replay.ts';
import {
  type MetaOverrides,
  metaOverridesSchema,
  type ReplayMetaPatch,
  TRASH_DAYS,
  type TrashRecord,
  trashRecordSchema,
} from '../shared/schemas/replay-meta.ts';

const DAY_MS = 24 * 60 * 60_000;

/** A stored overrides sidecar, or undefined when it is missing or unreadable (the bundle's meta then applies as is). */
export function parseOverrides(value: unknown): MetaOverrides | undefined {
  const parsed = metaOverridesSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function parseTrash(value: unknown): TrashRecord | undefined {
  const parsed = trashRecordSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** The next overrides record: `patch` over what was there, stamped with who changed it and when. */
export function nextOverrides(current: MetaOverrides | undefined, patch: ReplayMetaPatch, by: string, now: Date): MetaOverrides {
  const { by: _by, at: _at, purpose: storedLegacy, ...kept } = current ?? { by, at: '' };
  const { purpose: legacy, ...changes } = patch;
  const stored = kept.profile !== undefined ? kept.profile : storedLegacy;
  const profile = patch.profile !== undefined ? patch.profile : legacy !== undefined ? legacy : stored;
  return { ...kept, ...changes, ...(profile === undefined ? {} : { profile }), by, at: now.toISOString() };
}

/** The override's profile: `null` drops it, `undefined` keeps the summary's. Overrides written before the rename say `purpose`. */
function overriddenProfile(overrides: MetaOverrides) {
  return overrides.profile !== undefined ? overrides.profile : overrides.purpose;
}

/**
 * The summary as overridden. An explicit profile replaces the producer's (and any inferred one); `profile: null`
 * removes the override's profile so the catalog can infer again. Runs before `ProfileCatalog.apply`.
 */
export function withOverrides(summary: ReplaySummary, overrides: MetaOverrides | undefined): ReplaySummary {
  if (!overrides) return summary;
  const rest = withoutProfile(summary);
  const override = overriddenProfile(overrides);
  const own = profileOfSummary(summary);
  const profile = override === null ? {} : override !== undefined ? summaryProfile(override, false) : summaryProfile(own.id, own.inferred);
  return {
    ...rest,
    ...(overrides.title === undefined ? {} : { title: overrides.title }),
    ...(overrides.tags === undefined ? {} : { tags: overrides.tags }),
    ...profile,
  };
}

/** When a replay deleted at `trashedMs` (the server's write time of its trash record) is removed for good. */
export const trashExpiryMs = (trashedMs: number) => trashedMs + TRASH_DAYS * DAY_MS;
