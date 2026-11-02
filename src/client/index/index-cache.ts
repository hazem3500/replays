import { PRODUCT_SLUG } from '../../shared/brand.ts';
import { readSessionStorage, writeSessionStorage } from '../storage.ts';

const COUNTS_KEY = `${PRODUCT_SLUG}-index-counts`;
const NEWEST_KEY = `${PRODUCT_SLUG}-index-newest`;
const MAX_COUNTS = 60;

/**
 * A view's last shape (per tab, sessionStorage): how many entries it showed and whether a suite led it, so a pending
 * feed for a view whose list isn't cached still draws as many cards as will arrive, with the room a leading suite
 * stack peeks into, never a screenful that collapses to one.
 */
export interface FeedShape {
  count: number;
  leadingSuite: boolean;
}

const isShape = (value: unknown): value is FeedShape =>
  typeof value === 'object' &&
  value !== null &&
  'count' in value &&
  typeof value.count === 'number' &&
  'leadingSuite' in value &&
  typeof value.leadingSuite === 'boolean';

const isShapeEntry = (value: unknown): value is [string, FeedShape] =>
  Array.isArray(value) && typeof value[0] === 'string' && isShape(value[1]);

// why: parsed once per stored value, not once per render; a changed value (another write, a cleared tab) re-reads.
let cache: { raw: string | null; shapes: Map<string, FeedShape> } | undefined;

function loadShapes() {
  const raw = readSessionStorage(COUNTS_KEY);
  if (cache?.raw === raw) return cache.shapes;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw ?? '[]');
  } catch {
    parsed = [];
  }
  cache = { raw, shapes: new Map(Array.isArray(parsed) ? parsed.filter(isShapeEntry) : []) };
  return cache.shapes;
}

/** How a view looked last time in this tab (`undefined`: never seen). */
export function knownShape(view: string): FeedShape | undefined {
  return loadShapes().get(view);
}

export function rememberShape(view: string, shape: FeedShape) {
  const map = loadShapes();
  const known = map.get(view);
  if (known?.count === shape.count && known.leadingSuite === shape.leadingSuite) return;
  // invariant: re-inserted last, so the map's order is least recently seen first and the oldest go past the cap.
  map.delete(view);
  map.set(view, shape);
  for (const key of [...map.keys()].slice(0, Math.max(0, map.size - MAX_COUNTS))) map.delete(key);
  const raw = JSON.stringify([...map]);
  writeSessionStorage(COUNTS_KEY, raw);
  cache = { raw, shapes: map };
}

/** The newest capturedAt this tab has listed: anything newer in a later list is new, and glows once. */
export function listedNewest(): string | undefined {
  return readSessionStorage(NEWEST_KEY) ?? undefined;
}

export function rememberNewest(value: string | undefined) {
  if (value) writeSessionStorage(NEWEST_KEY, value);
}
