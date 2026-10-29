import { thumbHashDataUrl } from '../../shared/thumbhash.ts';

const MAX_CACHED = 400;
const cache = new Map<string, string | undefined>();

/**
 * A summary's ThumbHash as a PNG data URL for the poster placeholder, decoded once per hash: rows re-render on hover
 * and scroll, and the same replay shows in the feed and the quick results.
 */
export function posterPlaceholderUrl(hash: string | undefined): string | undefined {
  if (!hash) return;
  if (cache.has(hash)) return cache.get(hash);
  const url = thumbHashDataUrl(hash);
  if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value ?? '');
  cache.set(hash, url);
  return url;
}
