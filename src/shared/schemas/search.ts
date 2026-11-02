import * as z from 'zod/mini';

/*
 * The app's search params, as the router validates them. Values arrive as text (src/client/routing/search.ts keeps
 * the URLs' plain form); a value that does not fit is dropped, never an error page. Server-safe, and zod/mini because
 * these run in the index's entry chunk.
 */

const text = z.catch(z.optional(z.string().check(z.trim(), z.minLength(1))), undefined);
/** `?errors=1`: `true` in the app, `1` in the URL. */
const flag = z.catch(
  z.optional(
    z.pipe(
      z.union([z.literal('1'), z.literal(true)]),
      z.transform(() => true as const),
    ),
  ),
  undefined,
);

/** A plugin index filter's query parameter (`api.indexFilter`): the server's rule. */
export const pluginFilterParam = /^x-[a-z0-9][a-z0-9-]{0,38}$/;

function defined<T extends Record<string, unknown>>(record: T) {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as {
    [K in keyof T as undefined extends T[K] ? never : K]: T[K];
  } & { [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined> };
}

/** The index's address: its filters (purpose is one of the deployment's; the page checks it), view and sort. */
export const indexSearchSchema = z.pipe(
  z.looseObject({
    q: text,
    host: text,
    errors: flag,
    source: z.catch(z.optional(z.enum(['agent', 'human'])), undefined),
    tag: text,
    purpose: text,
    kind: z.catch(z.optional(z.enum(['suites', 'sessions'])), undefined),
    for: z.catch(z.optional(z.literal('me')), undefined),
    /** `title` (ascending) or `-errors` (descending); the page checks the column. */
    sort: text,
  }),
  z.transform(({ q, host, errors, source, tag, purpose, kind, for: forMe, sort, ...rest }) => {
    const plugin = Object.fromEntries(
      Object.keys(rest)
        .filter((key) => pluginFilterParam.test(key) && typeof rest[key] === 'string' && rest[key].trim())
        .sort()
        .map((key) => [key, String(rest[key]).trim().slice(0, 200)]),
    ) as Record<`x-${string}`, string>;
    return defined({ q, host, errors, source, tag, ...plugin, purpose, kind, for: forMe, sort });
  }),
);
export type IndexSearch = z.output<typeof indexSearchSchema>;

/** On every page: `?settings=<section>` opens Settings there (an unknown section opens General); closing removes it. */
export const rootSearchSchema = z.object({
  settings: z.catch(z.optional(z.enum(['general', 'keyboard', 'cli', 'labs', 'plugins', 'about'])), 'general'),
});

export const viewerSearchSchema = z.object({
  /** `?t=12.5` or `?t=12.5s`: the playhead in seconds, kept as written (permalink.ts reads it). */
  t: text,
  /** `?original=1`: the recording as captured, without its saved edits. */
  original: flag,
  /** Older suite links (`/r/<id>?suite=<suite>`), redirected to `/s/<suite>/r/<id>`. */
  suite: text,
});
export type ViewerSearch = z.output<typeof viewerSearchSchema>;

/** A suite run: the playhead and the original-version switch, like a replay. */
export const runSearchSchema = z.object({ t: text, original: flag });

/** Plugin pages own their query string: every text value passes through. */
export const pluginPageSearchSchema = z.pipe(
  z.record(z.string(), z.unknown()),
  z.transform((raw) => Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))),
);
