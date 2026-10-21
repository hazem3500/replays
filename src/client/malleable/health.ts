import { type PluginVersion } from '../../shared/malleable.ts';
import { type HostVersions, targetsFor, versionsKey } from '../../shared/malleable-policy.ts';

/*
 * Load health of saved user plugins, per (core, distribution) version pair, kept in this browser's localStorage. It exists
 * for one thing: after the host upgrades, a plugin that loaded before and fails now is pointed out in the workshop ("Review
 * plugins"). It never switches a plugin off, deletes it or changes it; the notice is all it does, and it can be dismissed.
 *
 *   { "<core> <distribution@version>": { "<plugin id>": { status: "ok" | "failed", sha, at, reviewed? } } }
 *
 * `sha` is the saved version's sha256, so a new version starts with a clean record.
 */

const KEY = 'replays-malleable-health';
/** Version pairs remembered (the oldest are dropped). */
const MAX_KEYS = 6;

interface HealthRecord {
  status: 'ok' | 'failed';
  sha: string;
  at: number;
  reviewed?: boolean;
}
type Book = Record<string, Record<string, HealthRecord>>;

let cache: Book | undefined;

function read(): Book {
  if (cache) return cache;
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    cache = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Book) : {};
  } catch {
    cache = {};
  }
  return cache;
}

function write(book: Book) {
  const keys = Object.keys(book);
  for (const old of keys.slice(0, Math.max(0, keys.length - MAX_KEYS))) delete book[old];
  cache = book;
  try {
    localStorage.setItem(KEY, JSON.stringify(book));
  } catch {
    /* private mode: health lasts for this page */
  }
}

/**
 * Records one load of a saved plugin's version under the current versions. A success never clears a failure of the same
 * version (a tab that throws when opened was registered fine first); a failure always wins.
 */
export function recordLoad(versions: HostVersions, id: string, sha: string, ok: boolean) {
  if (!versions.core) return;
  const book = read();
  const key = versionsKey(versions);
  const plugins = { ...book[key] };
  const current = plugins[id];
  if (ok && current?.sha === sha) return;
  if (!ok && current?.sha === sha && current.status === 'failed') return;
  plugins[id] = { status: ok ? 'ok' : 'failed', sha, at: Date.now() };
  // Re-inserting the key moves it last, so the pair in use is the last one dropped.
  const { [key]: _previous, ...rest } = book;
  write({ ...rest, [key]: plugins });
}

/**
 * Whether a saved plugin should be reviewed: it failed to load under the current versions, the versions changed since it
 * was kept (its `targets` differ) or since it last loaded fine, and nobody dismissed the notice yet.
 */
export function needsReview(versions: HostVersions, id: string, saved: PluginVersion | undefined) {
  if (!versions.core || !saved) return false;
  const book = read();
  const key = versionsKey(versions);
  const record = book[key]?.[id];
  if (record?.status !== 'failed' || record.sha !== saved.sha256 || record.reviewed) return false;
  const targets = saved.manifest.targets;
  const keptUnderOthers = Boolean(targets) && JSON.stringify(targets) !== JSON.stringify(targetsFor(versions));
  const loadedUnderOthers = Object.entries(book).some(([other, plugins]) => other !== key && plugins[id]?.status === 'ok');
  return keptUnderOthers || loadedUnderOthers;
}

/** "Dismiss": the current failures stay recorded but are not pointed out again (until a new version or a new upgrade). */
export function dismissReview(versions: HostVersions, ids: readonly string[]) {
  const book = read();
  const key = versionsKey(versions);
  const plugins = { ...book[key] };
  for (const id of ids) if (plugins[id]) plugins[id] = { ...plugins[id]!, reviewed: true };
  write({ ...book, [key]: plugins });
}

/** Tests only. */
export function resetHealthForTests() {
  cache = undefined;
}
