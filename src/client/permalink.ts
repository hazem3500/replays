/** `?t=<seconds>`, `#step-<n>` (1-based) and `#comment-<id>` permalinks. */
export interface PermalinkTarget {
  time?: number;
  step?: number;
  /** A comment's id (`#comment-c-ab12cd34ef`, with `?t=` as its time on the timeline that was on screen). */
  comment?: string;
}

const COMMENT_HASH = /^#comment-(c-[a-z0-9]{6,20})$/;

export function parsePermalink(search: string, hash: string, stepCount: number): PermalinkTarget {
  const step = /^#step-(\d{1,6})$/.exec(hash);
  if (step) {
    const number = Number(step[1]);
    if (number >= 1 && number <= stepCount) return { step: number - 1 };
  }
  const comment = COMMENT_HASH.exec(hash)?.[1];
  const raw = new URLSearchParams(search).get('t');
  if (raw !== null) {
    const match = /^(\d+(?:\.\d+)?)s?$/.exec(raw.trim());
    if (match) return { time: Math.round(Number(match[1]) * 1000), ...(comment ? { comment } : {}) };
  }
  return comment ? { comment } : {};
}

export function formatSeconds(ms: number) {
  return (Math.max(0, Math.round(ms / 100)) / 10).toFixed(1);
}

/** The current URL pointing at `ms`: sets `t`, drops any step hash. */
export function timePermalink(href: string, ms: number) {
  const url = new URL(href);
  url.searchParams.set('t', formatSeconds(ms));
  url.hash = '';
  return url.toString();
}

/** The current URL pointing at a step (0-based index): drops `t`, sets `#step-<n>`. */
export function stepPermalink(href: string, index: number) {
  const url = new URL(href);
  url.searchParams.delete('t');
  url.hash = `step-${index + 1}`;
  return url.toString();
}

/** A comment's permalink: `?t=` is where it sits on the timeline on screen, `#comment-<id>` names it. */
export function commentPermalink(href: string, id: string, ms: number | undefined) {
  const url = new URL(href);
  if (ms === undefined) url.searchParams.delete('t');
  else url.searchParams.set('t', formatSeconds(ms));
  url.hash = `comment-${id}`;
  return url.toString();
}
