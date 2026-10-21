import type { IndexFilterDefinition, SummaryFieldsDefinition } from '../plugin/types.ts';
import type { Owned } from '../plugin/registry.ts';
import type { ReplayBundle, ReplaySummary, SummaryFieldValue } from '../shared/replay.ts';

/*
 * The index half of the plugin API on the server: values plugins derive into `summary.ext` when a summary is built
 * (src/server/store.ts), and plugin filters over `GET /api/replays` (src/server/app.ts). Summaries are listed by the
 * thousand and live in every replay's `meta.json`, so what a plugin may add is small and checked.
 */

/** What one plugin may add to a summary: at most `keys` fields, strings cut to `stringLength`, `bytes` of JSON in all. */
export const SUMMARY_FIELD_LIMITS = Object.freeze({ keys: 20, stringLength: 200, bytes: 2048 });

const KEY = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;

export type SummaryExt = Record<string, Record<string, SummaryFieldValue>>;

const jsonBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

/** Cuts a string to `max` UTF-16 units without leaving half a surrogate pair. */
function cut(value: string, max: number) {
  if (value.length <= max) return value;
  const end = /[\uD800-\uDBFF]/.test(value[max - 1]!) ? max - 1 : max;
  return value.slice(0, end);
}

/**
 * Checks one `fields` result against the limits and returns the values to store: `undefined`/`null` is "nothing", long
 * strings are cut, anything else that breaks a limit (not an object, a bad key, too many keys, a value that is not a
 * string, finite number, boolean or null, too large) throws, naming the problem.
 */
export function capSummaryFields(result: unknown): Record<string, SummaryFieldValue> | undefined {
  if (result === undefined || result === null) return undefined;
  if (typeof result !== 'object' || Array.isArray(result)) throw new Error('fields must return an object of values');
  const entries = Object.entries(result as Record<string, unknown>);
  if (entries.length > SUMMARY_FIELD_LIMITS.keys)
    throw new Error(`fields returned ${entries.length} keys; at most ${SUMMARY_FIELD_LIMITS.keys} are kept`);
  const out: Record<string, SummaryFieldValue> = {};
  for (const [key, value] of entries) {
    if (!KEY.test(key)) throw new Error(`field key ${JSON.stringify(key)} must match ${KEY}`);
    if (typeof value === 'string') out[key] = cut(value, SUMMARY_FIELD_LIMITS.stringLength);
    else if (typeof value === 'boolean' || value === null) out[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    else throw new Error(`field ${JSON.stringify(key)} must be a string, finite number, boolean or null`);
  }
  const bytes = jsonBytes(out);
  if (bytes > SUMMARY_FIELD_LIMITS.bytes) throw new Error(`fields are ${bytes} bytes of JSON; at most ${SUMMARY_FIELD_LIMITS.bytes}`);
  return out;
}

/** What the store calls when it builds a summary (src/server/store.ts). */
export interface SummaryFieldsRunner {
  /** Names the sets and their versions; a stored summary with another `extVersion` is rebuilt. */
  readonly version: string;
  derive(bundle: ReplayBundle): Promise<SummaryExt | undefined>;
}

/**
 * Runs every registered set, in plugin order, and merges each plugin's sets into `ext[plugin]`. A set that throws or
 * breaks a limit is logged and left out; so is a later set of the same plugin that would repeat a key or push the
 * plugin past the limits. Undefined when no plugin registered any.
 */
export function summaryFieldsRunner(
  sets: readonly Owned<SummaryFieldsDefinition>[],
  log: (message: string, error?: unknown) => void = (message, error) => console.error(message, error),
): SummaryFieldsRunner | undefined {
  if (!sets.length) return undefined;
  return {
    version: sets.map(({ plugin, value }) => `${plugin}/${value.name}@${value.version ?? 1}`).join(','),
    async derive(bundle) {
      const ext: SummaryExt = {};
      for (const { plugin, value } of sets) {
        const where = `plugin ${plugin}: summaryFields ${value.name} (replay ${bundle.meta.id})`;
        let fields: Record<string, SummaryFieldValue> | undefined;
        try {
          fields = capSummaryFields(await value.fields(bundle));
        } catch (error) {
          log(`${where} failed; its fields are left out:`, error);
          continue;
        }
        if (!fields) continue;
        const current = ext[plugin] ?? {};
        const repeated = Object.keys(fields).find((key) => key in current);
        const merged = { ...current, ...fields };
        if (repeated) log(`${where}: key ${JSON.stringify(repeated)} is already set by another of the plugin's sets; left out`);
        else if (Object.keys(merged).length > SUMMARY_FIELD_LIMITS.keys || jsonBytes(merged) > SUMMARY_FIELD_LIMITS.bytes)
          log(
            `${where}: the plugin's fields would pass ${SUMMARY_FIELD_LIMITS.keys} keys or ${SUMMARY_FIELD_LIMITS.bytes} bytes; left out`,
          );
        else ext[plugin] = merged;
      }
      return Object.keys(ext).length ? ext : undefined;
    },
  };
}

/** The value of a filter's param in a request: trimmed, at most 200 characters; undefined when absent or empty. */
export function indexFilterValue(params: URLSearchParams, param: string) {
  return params.get(param)?.trim().slice(0, 200) || undefined;
}

/** Keeps the summaries every requested plugin filter matches. A throwing `match` is a non-match, logged once per request. */
export function applyIndexFilters(
  filters: readonly Owned<IndexFilterDefinition>[],
  params: URLSearchParams,
  summaries: ReplaySummary[],
): ReplaySummary[] {
  let result = summaries;
  for (const { plugin, value: filter } of filters) {
    const value = indexFilterValue(params, filter.param);
    if (value === undefined) continue;
    let logged = false;
    result = result.filter((summary) => {
      try {
        return filter.match(summary, value) === true;
      } catch (error) {
        if (!logged) console.error(`plugin ${plugin}: indexFilter ${filter.id} failed; treated as no match:`, error);
        logged = true;
        return false;
      }
    });
  }
  return result;
}

/** The registered filters as `GET /api/config` lists them. */
export function publicIndexFilters(filters: readonly Owned<IndexFilterDefinition>[]) {
  return filters.map(({ plugin, value }) => ({ plugin, id: value.id, param: value.param }));
}
