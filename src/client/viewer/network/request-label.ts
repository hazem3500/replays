/** A request's path with the parts that identify nothing swapped for `:id`, and the middle cut out when it is too long. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LONG_HEX = /^[0-9a-f]{16,}$/i;
const NUMBER = /^\d+$/;
const ID_TOKEN = ':id';
const ELLIPSIS = '…';

/** A numeric, uuid or long hex segment is an id: it differs per request and says nothing about the endpoint. */
export function isIdSegment(segment: string) {
  return NUMBER.test(segment) || UUID.test(segment) || LONG_HEX.test(segment);
}

/** The path's segments with ids as `:id`; no query, no origin. */
export function labelSegments(path: string) {
  const bare = path.split(/[?#]/)[0] ?? '';
  return bare
    .split('/')
    .filter(Boolean)
    .map((segment) => (isIdSegment(segment) ? ID_TOKEN : segment));
}

const join = (segments: readonly string[]) => `/${segments.join('/')}`;

/**
 * The path to show in `maxChars` characters: ids as `:id`, short paths unchanged, otherwise the first segment and the
 * last three, two or one that fit around an ellipsis, so `/api/…/workspaces/:id/search` keeps what names the endpoint.
 * A budget that still cannot fit gets the tightest form; CSS clips the rest. Without a budget nothing is cut.
 */
export function shortenPath(path: string, maxChars?: number) {
  const segments = labelSegments(path);
  const full = join(segments);
  if (maxChars === undefined || full.length <= maxChars || segments.length <= 2) return full;
  const [first = ''] = segments;
  const tail = (count: number) => join([first, ELLIPSIS, ...segments.slice(-count)]);
  for (const count of [3, 2, 1]) {
    // why: cutting nothing but an ellipsis would only make it longer.
    if (count >= segments.length - 1) continue;
    const candidate = tail(count);
    if (candidate.length <= maxChars || count === 1) return candidate;
  }
  return full;
}

/** Full text for a tooltip or label: method and path, then the query when there is one. */
export function requestTitle(method: string, url: string) {
  return `${method} ${url}`;
}

/** How many characters a monospace label of `width` px holds, at `charWidth` px each; undefined while unmeasured. */
export function charBudget(width: number, charWidth: number) {
  return width > 0 ? Math.max(8, Math.floor(width / charWidth)) : undefined;
}
