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

/** A search box's text as the lower-case words every match must contain. */
export function searchWords(text: string) {
  return text.toLowerCase().trim().split(/\s+/).filter(Boolean);
}

/** The segments at `kept` indexes, each run of left-out segments one ellipsis. */
function keepOnly(segments: readonly string[], kept: ReadonlySet<number>) {
  const parts: string[] = [];
  for (const [index, segment] of segments.entries()) {
    if (kept.has(index)) parts.push(segment);
    else if (parts.at(-1) !== ELLIPSIS) parts.push(ELLIPSIS);
  }
  return join(parts);
}

/**
 * The path to show in `maxChars` characters: ids as `:id`, short paths unchanged, otherwise the first segment and the
 * last three, two or one that fit around an ellipsis, so `/api/…/workspaces/:id/search` keeps what names the endpoint.
 * A segment holding one of the search `words` is never cut: it stays between the ellipses (`/api/…/capacities/…/users`).
 * A budget that still cannot fit gets the tightest form; CSS clips the rest. Without a budget nothing is cut.
 */
export function shortenPath(path: string, maxChars?: number, words: readonly string[] = []) {
  const segments = labelSegments(path);
  const full = join(segments);
  if (maxChars === undefined || full.length <= maxChars || segments.length <= 2) return full;
  const lower = full.toLowerCase();
  const wanted = words.filter((word) => lower.includes(word));
  // why: a word that only matches across a slash marks no segment; the label then shortens as without a search.
  const hits = [...segments.keys()].filter((index) => wanted.some((word) => segments[index]?.toLowerCase().includes(word)));
  const last = segments.length - 1;
  for (const count of [3, 2, 1]) {
    // why: cutting nothing but an ellipsis would only make it longer.
    if (count >= last) continue;
    const candidate = keepOnly(segments, new Set([0, ...hits, ...[...segments.keys()].filter((index) => index > last - count)]));
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

/** `text` split into the stretches that match one of `words` (any case) and the stretches between. */
export function markWords(text: string, words: readonly string[]): Array<{ text: string; hit: boolean }> {
  const lower = text.toLowerCase();
  const hit = Array.from({ length: text.length }, () => false);
  for (const word of words) {
    for (let at = lower.indexOf(word); at !== -1; at = lower.indexOf(word, at + word.length)) hit.fill(true, at, at + word.length);
  }
  const parts: Array<{ text: string; hit: boolean }> = [];
  for (let index = 0; index < text.length; index += 1) {
    const marked = hit[index] ?? false;
    const previous = parts.at(-1);
    if (previous?.hit === marked) previous.text += text.charAt(index);
    else parts.push({ text: text.charAt(index), hit: marked });
  }
  return parts;
}
