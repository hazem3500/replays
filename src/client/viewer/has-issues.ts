import type { EditTimeline } from '../../shared/edits.ts';
import type { ReplayBundle } from '../../shared/replay.ts';
import { detectIssues } from '../../shared/diagnostics/detect.ts';

/** Whether the replay has anything to diagnose: picks the default tab (Issues, else Steps). Light enough for the eager chunk. */
export function hasIssues(bundle: ReplayBundle, timeline?: EditTimeline) {
  return detectIssues(bundle, timeline).length > 0;
}
