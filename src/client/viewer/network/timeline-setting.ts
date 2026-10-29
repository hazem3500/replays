import type { ReplayBundle } from '../../../shared/replay.ts';
import { replayProfile } from '../../profiles.ts';
import { readStorage, writeStorage } from '../../storage.ts';

/** Views (src/shared/views.ts) that open with the Network timeline shown: they are about when things happened. */
const TIMELINE_VIEWS: ReadonlySet<string> = new Set(['performance', 'debug']);

/**
 * The view the Network panel remembers its timeline under: `?view=`, else the replay's profile's view, else Standard.
 * invariant: same order as views/resolve.ts on feat/viewer-views (#159); once that lands, the resolved view replaces this.
 */
export function timelineView(bundle: Pick<ReplayBundle, 'meta'>, search = location.search) {
  return new URLSearchParams(search).get('view') ?? replayProfile(bundle)?.view ?? 'standard';
}

/** invariant: the per-view settings key and `'1'`/`'0'` values of views/settings.ts, so #159's reset forgets it too. */
function timelineKey(view: string) {
  return `replays-view:${view}:timeline`;
}

/** Whether the Network timeline is shown in `view`: the person's choice for that view, else the view's default. */
export function readTimeline(view: string) {
  const saved = readStorage(timelineKey(view));
  if (saved === '1' || saved === '0') return saved === '1';
  return TIMELINE_VIEWS.has(view);
}

export function writeTimeline(view: string, shown: boolean) {
  writeStorage(timelineKey(view), shown ? '1' : '0');
}
