/** `?t=<seconds>` and `#step-<n>` (1-based) permalinks. */
export interface PermalinkTarget {
  time?: number;
  step?: number;
}

export function parsePermalink(search: string, hash: string, stepCount: number): PermalinkTarget {
  const step = /^#step-(\d{1,6})$/.exec(hash);
  if (step) {
    const number = Number(step[1]);
    if (number >= 1 && number <= stepCount) return { step: number - 1 };
  }
  const raw = new URLSearchParams(search).get('t');
  if (raw !== null) {
    const match = /^(\d+(?:\.\d+)?)s?$/.exec(raw.trim());
    if (match) return { time: Math.round(Number(match[1]) * 1000) };
  }
  return {};
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
