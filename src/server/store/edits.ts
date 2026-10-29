import { assertStoredReplayEdits, EMPTY_EDITS, type ReplayEdits, sameEdits, type StoredReplayEdits } from '../../shared/edits.ts';
import { HttpError } from '../../shared/http-error.ts';
import { ObjectExistsError, type ObjectStorage, PreconditionFailedError, readJson, StoredDataError } from '../storage/index.ts';

const JSON_TYPE = 'application/json; charset=utf-8';

/** An edit list and the storage version it was read at (undefined: nothing was ever saved). */
export interface EditsRead {
  edits: StoredReplayEdits;
  version: string | undefined;
}

/** A save's outcome; `changed` is false when the list was already stored. */
export interface EditsSaved extends EditsRead {
  changed: boolean;
}

/** A 409 for a save over a version the editor did not load; carries the list that is stored now. */
export class EditsConflictError extends HttpError {
  readonly current: StoredReplayEdits;
  readonly version: string | undefined;

  constructor(latest: EditsRead) {
    super(409, 'the edits changed since they were loaded');
    this.current = latest.edits;
    this.version = latest.version;
  }
}

const unsupportedVersion = (parsed: unknown): boolean =>
  typeof parsed === 'object' &&
  parsed !== null &&
  'version' in parsed &&
  typeof parsed.version === 'number' &&
  parsed.version !== EMPTY_EDITS.version;

/** invariant: an unreadable, newer or corrupt sidecar throws, so a save can never replace it with an empty list. */
export async function readEdits(storage: ObjectStorage, key: string): Promise<EditsRead> {
  let info;
  try {
    info = await storage.stat(key);
  } catch (cause) {
    throw new StoredDataError('Stored edits could not be read; retry before saving.', 503, { cause });
  }
  if (!info) return { edits: { ...EMPTY_EDITS, revision: 0 }, version: undefined };
  const parsed = await readJson(storage, key);
  if (unsupportedVersion(parsed))
    throw new StoredDataError('Stored edits use an unsupported version; upgrade the server before saving.', 409);
  try {
    assertStoredReplayEdits(parsed);
  } catch (cause) {
    throw new StoredDataError('Stored edits are corrupt or unavailable; restore them before saving.', 503, { cause });
  }
  return { edits: parsed, version: info.version };
}

/** Who saves, the version they loaded (null: none) and the save time. */
export interface EditsSave {
  by: string;
  ifVersion: string | null;
  now?: Date;
}

/**
 * Stores a normalized edit list, generation-checked against `save.ifVersion`; a save over anything else throws
 * EditsConflictError. Saving the list already stored is a no-op (an idempotent retry), whatever `ifVersion` says.
 */
export async function saveEdits(storage: ObjectStorage, key: string, next: ReplayEdits, save: EditsSave): Promise<EditsSaved> {
  const current = await readEdits(storage, key);
  if (sameEdits(current.edits, next)) return { ...current, changed: false };
  if ((current.version ?? null) !== save.ifVersion) throw new EditsConflictError(current);
  const stored: StoredReplayEdits = {
    ...next,
    revision: current.edits.revision + 1,
    updatedBy: save.by,
    updatedAt: (save.now ?? new Date()).toISOString(),
  };
  try {
    const info = await storage.write(key, `${JSON.stringify(stored)}\n`, {
      contentType: JSON_TYPE,
      ...(current.version === undefined ? { createOnly: true } : { ifVersion: current.version }),
    });
    return { edits: stored, version: info.version, changed: true };
  } catch (error) {
    if (!(error instanceof PreconditionFailedError || error instanceof ObjectExistsError)) throw error;
    // why: another replica saved first; its list wins unless it is this very list (a retry that raced itself).
    const latest = await readEdits(storage, key);
    if (sameEdits(latest.edits, next)) return { ...latest, changed: false };
    throw new EditsConflictError(latest);
  }
}
