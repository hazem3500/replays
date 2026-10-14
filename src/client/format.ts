import type { ReplayNetworkEntry } from '../shared/replay.ts';

export function favicon(url: string) {
  try {
    return `${new URL(url).origin}/favicon.ico`;
  } catch {
    return '';
  }
}

export function domain(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function requestPath(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

function headerValue(headers: Array<{ name: string; value: string }>, name: string) {
  return headers.find((header) => header.name.toLowerCase() === name)?.value;
}

export function entrySize(entry: ReplayNetworkEntry) {
  const value = Number.parseInt(headerValue(entry.responseHeaders, 'content-length') ?? '', 10);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function formatBytes(bytes?: number) {
  if (bytes === undefined) return '—';
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(bytes < 10_240 ? 1 : 0)} kB`;
}

export { hasNoResponse, isFailedRequest } from '../shared/replay.ts';

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const RELATIVE_NARROW = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'narrow' });
const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 3600_000],
  ['month', 30 * 24 * 3600_000],
  ['week', 7 * 24 * 3600_000],
  ['day', 24 * 3600_000],
  ['hour', 3600_000],
  ['minute', 60_000],
];

/** "3 days ago", "yesterday", "just now"; `narrow` gives "3d ago" for tight columns. */
export function formatRelative(iso: string, now = Date.now(), style: 'long' | 'narrow' = 'long') {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return '—';
  const delta = time - now;
  for (const [unit, size] of UNITS) {
    if (Math.abs(delta) >= size) return (style === 'narrow' ? RELATIVE_NARROW : RELATIVE).format(Math.round(delta / size), unit);
  }
  return 'just now';
}
