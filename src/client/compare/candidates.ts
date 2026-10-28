import type { ReplaySummary } from '../../shared/replay.ts';

/** A summary, or a bundle's meta (no `host`: it comes from the URL). */
export type Comparable = Pick<ReplaySummary, 'id' | 'title' | 'url' | 'capturedAt' | 'suiteRun'> & { host?: string };

const words = (title: string) =>
  new Set(
    title
      .toLowerCase()
      .replaceAll(/\([^)]*\)/g, ' ')
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length > 1),
  );

function overlap(a: ReadonlySet<string>, b: ReadonlySet<string>) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

const parsed = (url: string) => {
  try {
    return new URL(url);
  } catch {
    return;
  }
};
const page = (url: string) => {
  const address = parsed(url);
  return address ? `${address.host}${address.pathname.replace(/\/+$/, '')}` : url;
};
const hostOf = (item: Comparable) => item.host ?? parsed(item.url)?.host;

/** The same page scores 2, the same host 1. */
function placeScore(base: Comparable, other: Comparable) {
  if (page(base.url) === page(other.url)) return 2;
  const host = hostOf(base);
  return host && host === hostOf(other) ? 1 : 0;
}

/**
 * How likely `other` is a useful counterpart to `base`: the same scenario (a suite run id), a similar title (shared
 * words over the shorter title, ignoring parentheticals like "(fictional demo)"), the same page, the same host. Zero means unrelated.
 */
export function similarity(base: Comparable, other: Comparable) {
  const title = overlap(words(base.title), words(other.title));
  return (
    (base.suiteRun && base.suiteRun.runId === other.suiteRun?.runId ? 3 : 0) + (title >= 0.5 ? 3 * title : 0) + placeScore(base, other)
  );
}

/** Other recordings for "Compare with…": likely counterparts first (best match, then newest), then everything else by date. */
export function rankCandidates<T extends Comparable>(base: Comparable, replays: readonly T[]) {
  const scored = replays.filter((replay) => replay.id !== base.id).map((replay) => ({ replay, score: similarity(base, replay) }));
  const byScore = (a: (typeof scored)[number], b: (typeof scored)[number]) =>
    b.score - a.score || b.replay.capturedAt.localeCompare(a.replay.capturedAt);
  return {
    similar: scored
      .filter((item) => item.score > 0)
      .toSorted(byScore)
      .map((item) => item.replay),
    others: scored
      .filter((item) => item.score === 0)
      .toSorted(byScore)
      .map((item) => item.replay),
  };
}
