import type { ReplayEdits } from '../../shared/edits.ts';
import { removeHighlight } from './highlight-edits.ts';
import { clearTrim, removeCut, removeEffect, type Selection } from './state.ts';

/** The edits without the selected object; a range or nothing selected has nothing to remove. */
export function removeSelection(edits: ReplayEdits, selection: Selection): ReplayEdits | undefined {
  if (!selection || selection.kind === 'range') return undefined;
  if (selection.kind === 'trim') return clearTrim(edits);
  if (selection.kind === 'cut') return removeCut(edits, selection.id);
  if (selection.kind === 'highlight') return removeHighlight(edits, selection.id);
  return removeEffect(edits, selection.kind, selection.id);
}
