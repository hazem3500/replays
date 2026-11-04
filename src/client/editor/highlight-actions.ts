import { MAX_HIGHLIGHTS, type EditTimeline, type ReplayEdits } from '../../shared/edits.ts';
import { addPeriodHighlight, addPointHighlight } from './highlight-edits.ts';
import { trimOf, type Selection } from './state.ts';

type HighlightRequest = { present: ReplayEdits; selection: Selection; timeline: EditTimeline; time: number; duration: number };

/** The edit to apply and what to select, or a note explaining why nothing was added. */
export type HighlightOutcome = { edits: ReplayEdits; select: Selection } | { note: string };

const FULL_NOTE = `A replay can have up to ${MAX_HIGHLIGHTS} highlights`;

/** A point highlight at the playhead, unless the list is full or the playhead is in cut or trimmed time. */
function pointHighlight({ present, timeline, time, duration }: HighlightRequest): HighlightOutcome {
  const duplicate = present.highlights?.some((highlight) => highlight.kind === 'point' && highlight.at === time);
  if (!duplicate && (present.highlights?.length ?? 0) >= MAX_HIGHLIGHTS) return { note: FULL_NOTE };
  if (timeline.isRemoved(time)) return { note: 'Move to a kept moment to add a highlight' };
  const added = addPointHighlight(present, time, duration);
  return { edits: added.edits, select: { kind: 'highlight', id: added.id } };
}

/** A period highlight over the selected range, limited to the part that remains in the edited replay. */
function periodHighlight({ present, selection, timeline, duration }: HighlightRequest): HighlightOutcome {
  if ((present.highlights?.length ?? 0) >= MAX_HIGHLIGHTS) return { note: FULL_NOTE };
  if (selection?.kind !== 'range') return { note: 'Select a stretch on the clip first' };
  const bounds = trimOf(present, duration);
  const from = Math.max(bounds.start, selection.from);
  const to = Math.min(bounds.end, selection.to);
  if (timeline.toEdited(to) <= timeline.toEdited(from)) return { note: 'Select a stretch that remains in the edited replay' };
  const added = addPeriodHighlight(present, from, to, duration);
  if (!added) return { note: 'Select at least 0.1 seconds of the clip' };
  return { edits: added.edits, select: { kind: 'highlight', id: added.id } };
}

/** The one Highlight action: over the selected range when there is one, else at the playhead's moment. */
export function highlightHere(request: HighlightRequest): HighlightOutcome {
  return request.selection?.kind === 'range' ? periodHighlight(request) : pointHighlight(request);
}

/** Applies an outcome: the edit with its selection, or the explaining note. */
export function applyHighlight(
  change: (edits: ReplayEdits, select?: Selection) => void,
  say: (message: string) => void,
  outcome: HighlightOutcome,
) {
  if ('note' in outcome) say(outcome.note);
  else change(outcome.edits, outcome.select);
}
