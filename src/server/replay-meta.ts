import type { ReplaySummary } from '../shared/replay.ts';
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
  const { by: _by, at: _at, ...kept } = current ?? { by, at: '' };
  return { ...kept, ...patch, by, at: now.toISOString() };
}

/**
 * The summary as overridden. An explicit purpose replaces the producer's (and any inferred one); `purpose: null`
 * removes the override's purpose so the catalog can infer again. Runs before `PurposeCatalog.apply`.
 */
function purposeOf(summary: ReplaySummary, overrides: MetaOverrides): Pick<ReplaySummary, 'purpose' | 'purposeInferred'> {
  if (overrides.purpose === null) return {};
  if (overrides.purpose !== undefined) return { purpose: overrides.purpose };
  return { ...(summary.purpose ? { purpose: summary.purpose } : {}), ...(summary.purposeInferred ? { purposeInferred: true } : {}) };
}

export function withOverrides(summary: ReplaySummary, overrides: MetaOverrides | undefined): ReplaySummary {
  if (!overrides) return summary;
  const { purpose: _purpose, purposeInferred: _inferred, ...rest } = summary;
  const purpose = purposeOf(summary, overrides);
  return {
    ...rest,
    ...(overrides.title === undefined ? {} : { title: overrides.title }),
    ...(overrides.tags === undefined ? {} : { tags: overrides.tags }),
    ...purpose,
  };
}

/** When a replay deleted at `trashedMs` (the server's write time of its trash record) is removed for good. */
export const trashExpiryMs = (trashedMs: number) => trashedMs + TRASH_DAYS * DAY_MS;
