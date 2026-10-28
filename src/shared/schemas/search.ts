import * as z from 'zod/mini';

/*
 * why: the app's search params as the router validates them. Values arrive as text (src/client/routing/search.ts keeps the
 * URLs' plain form) and stay text: each page reads its own (permalink.ts, compare-search.ts, ReplayIndex.tsx), so these
 * only name and type them. A value that does not fit is dropped, never an error page; keys a schema does not name pass
 * through untouched (plugin index filters, plugin pages). Server-safe.
 */

const text = z.optional(z.catch(z.string(), ''));

/** On every page: `?settings=<section>` opens Settings there; closing removes it. */
export const rootSearchSchema = z.object({ settings: text });

/** The index's filters, view and sort (ReplayIndex.tsx parses them; `x-*` plugin filters pass through). */
export const indexSearchSchema = z.object({
  q: text,
  host: text,
  errors: text,
  source: text,
  tag: text,
  purpose: text,
  kind: text,
  for: text,
  sort: text,
});

/** A replay: `?t=12.5` the playhead in seconds, `?original=1` as captured, compare state, and older `?suite=` links. */
export const viewerSearchSchema = z.object({
  t: text,
  original: text,
  with: text,
  layout: text,
  focus: text,
  suite: text,
});
export type ViewerSearch = z.output<typeof viewerSearchSchema>;

/** A suite run: the playhead, the original-version switch and the comparison's layout. */
export const runSearchSchema = z.object({ t: text, original: text, layout: text });
