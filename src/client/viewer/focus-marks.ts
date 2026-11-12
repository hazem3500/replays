import type { ReplayBundle } from '../../shared/replay.ts';
import type { FocusTests } from '../../shared/run-focus.ts';
import { requestPath } from '../format.ts';

/** A seek bar mark for a request or console message the suite run marked to look at. */
export interface FocusSpot {
  at: number;
  label: string;
}

/** Marked requests and console messages in time order, named by the run's note or else by the row itself. */
export function focusSpots(bundle: Pick<ReplayBundle, 'console' | 'network'>, focus: FocusTests | undefined): FocusSpot[] {
  if (!focus) return [];
  const spots: FocusSpot[] = [];
  if (focus.has.network) {
    for (const entry of bundle.network) {
      const marker = focus.network(entry);
      if (marker) spots.push({ at: entry.at, label: marker.note ?? `${entry.method} ${requestPath(entry.url)}` });
    }
  }
  if (focus.has.console) {
    for (const entry of bundle.console) {
      const marker = focus.console(entry);
      const message = entry.message.length > 80 ? `${entry.message.slice(0, 79)}…` : entry.message;
      if (marker) spots.push({ at: entry.at, label: marker.note ?? message });
    }
  }
  return spots.toSorted((a, b) => a.at - b.at);
}
