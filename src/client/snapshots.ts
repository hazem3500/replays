import type { ReplayBundle } from '../shared/replay.ts';

const DOM_CONTENT_LOADED = 0;
const LOAD = 1;
const FULL_SNAPSHOT = 2;
const META = 4;

/**
 * One rendered document on the replay timeline. Times are offsets from the
 * first event, the same clock as the playhead and the other tracks.
 */
export interface SnapshotGroup {
  /** When this document replaced the previous one on screen. */
  start: number;
  /** Its full snapshot: the earliest frame of it the recording has. */
  snapshot: number;
  href?: string;
}

/**
 * Finds every full snapshot and when its document took over. After a
 * navigation the recorder only snapshots the new document once it is running,
 * which can be a few hundred milliseconds after the browser committed it. The
 * group therefore starts at the earliest of: the run of DOMContentLoaded /
 * Load / Meta events just before the snapshot, or the end of the document
 * request for the Meta's URL (the navigation commit).
 */
export function snapshotGroups(events: ReplayBundle['events'], network: ReplayBundle['network'] = []): SnapshotGroup[] {
  const origin = events[0]?.timestamp ?? 0;
  const groups: SnapshotGroup[] = [];
  let previousSnapshot = Number.NEGATIVE_INFINITY;
  events.forEach((event, index) => {
    if (event.type !== FULL_SNAPSHOT) return;
    const snapshot = event.timestamp - origin;
    let start = snapshot;
    let href: string | undefined;
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const lead = events[cursor]!;
      if (lead.type !== META && lead.type !== LOAD && lead.type !== DOM_CONTENT_LOADED) break;
      start = Math.min(start, lead.timestamp - origin);
      if (lead.type === META && href === undefined) {
        const value = (lead.data as { href?: unknown } | undefined)?.href;
        if (typeof value === 'string') href = value;
      }
    }
    if (href && groups.length > 0) {
      const commit = network
        .filter((entry) => sameDocument(entry.url, href!) && entry.status >= 200 && entry.status < 400)
        .map((entry) => entry.at + Math.max(0, entry.duration))
        .filter((at) => at > previousSnapshot && at <= snapshot)
        .at(-1);
      if (commit !== undefined) start = Math.min(start, commit);
    }
    // Never before the previous document's own first frame.
    start = Math.max(start, previousSnapshot === Number.NEGATIVE_INFINITY ? 0 : previousSnapshot);
    groups.push({ start, snapshot, ...(href ? { href } : {}) });
    previousSnapshot = snapshot;
  });
  return groups;
}

function sameDocument(a: string, b: string) {
  try {
    const left = new URL(a);
    const right = new URL(b);
    return left.origin === right.origin && left.pathname === right.pathname && left.search === right.search;
  } catch {
    return a === b;
  }
}

/** The document on screen at `time`: the last group that started at or before it. */
export function groupAt(groups: readonly SnapshotGroup[], time: number) {
  let found: SnapshotGroup | undefined;
  for (const group of groups) {
    if (group.start > time) break;
    found = group;
  }
  return found;
}

/**
 * The offset to hand rrweb so the frame shown is the document on screen at
 * `time`. rrweb rebuilds from the latest Meta + full snapshot before the
 * offset and applies only events strictly before it, so the result is
 * inclusive (+1 ms) and, inside a navigation gap, lands just after the new
 * document's first snapshot.
 */
export function renderOffset(groups: readonly SnapshotGroup[], time: number) {
  const group = groupAt(groups, time);
  return Math.max(time, group?.snapshot ?? 0) + 1;
}
