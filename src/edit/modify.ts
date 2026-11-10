import { editListOf, normalizeEdits, type ReplayEdits, sameEdits, type StoredReplayEdits } from '../shared/edits.ts';
import type { EditsApi } from './client.ts';
import { diffEdits, type EditChanges } from './describe.ts';
import { EditError } from './errors.ts';

export interface ModifyResult {
  before: ReplayEdits;
  after: ReplayEdits;
  saved: StoredReplayEdits;
  changed: boolean;
  changes: EditChanges;
  /** Saves lost to someone else's edit before one landed (0 or 1). */
  retries: number;
}

export const CONFLICT_MESSAGE =
  'someone else edited this replay while you were changing it; run `replays edit <id> pull` again and redo your change';

/**
 * Read, change, write with `If-Match`. A 409 hands back the list that won; the change is applied to that list and sent
 * once more (`retries` extra attempts), so two people editing different things both land. Anything still conflicting
 * after that is an error that says to pull again. `change` runs on each attempt's fresh list, normalized, and may throw to refuse.
 */
export async function modifyEdits(
  api: EditsApi,
  change: (edits: ReplayEdits) => ReplayEdits,
  options: { validate?: (edits: ReplayEdits) => void; retries?: number } = {},
): Promise<ModifyResult> {
  const { validate, retries = 1 } = options;
  let current = await api.getEdits();
  for (let attempt = 0; ; attempt++) {
    const before = normalizeEdits(editListOf(current.edits));
    const after = normalizeEdits(change(before));
    validate?.(after);
    if (sameEdits(before, after))
      return { before, after, saved: current.edits, changed: false, changes: diffEdits(before, after), retries: attempt };
    const result = await api.putEdits(after, current.etag);
    if (result.status === 'saved')
      return { before, after, saved: result.edits, changed: true, changes: diffEdits(before, after), retries: attempt };
    if (attempt >= retries) throw new EditError(CONFLICT_MESSAGE);
    current = result.current;
  }
}
