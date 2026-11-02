import { BETA_FLAGS, type BetaFlagId, type BetaFlags, NO_BETA, REMOVED_BETA_FLAGS } from '../shared/beta-flags.ts';

/**
 * Beta features: every one is OFF unless switched on explicitly, so a default deployment exposes none of their UI,
 * routes or code paths. The flags themselves are listed once, in src/shared/beta-flags.ts.
 *
 *   REPLAYS_BETA_EDITOR=true     or    { "beta": { "editor": true } } in the config file
 *   REPLAYS_BETA_MALLEABLE=true  or    { "beta": { "malleable": true } }
 *
 * Removed flags (REMOVED_BETA_FLAGS: `REPLAYS_BETA_GROUPED_INSPECTOR` / `beta.groupedInspector`) are still accepted so an
 * existing deployment keeps starting; they do nothing and log one warning.
 *
 * What this returns is the server's *ceiling*: the flags this deployment allows. Routes gated by a flag exist only when it
 * is allowed. The page receives the allowed set and lets each person opt out under Settings › Labs.
 *
 * `editor`: edit mode in the viewer (non-destructive trims, cuts, "Remove waits", zoom, speed-ups, blur boxes and
 * captions), the `GET|PUT /api/replays/<id>/edits` API, and applying saved edits on playback and in video exports.
 * `malleable`: user plugins (a sandboxed, hot-loading plugin workshop in the viewer, versioned per user or workspace), the
 * `/api/malleable/*` routes, the plugin sandbox page and the agent bridge (WebMCP tools in the page, an MCP server for
 * agents outside it): docs/malleability.md. Off means none of those exist: no UI, 404s, nothing exposed to agents.
 * The environment variables win over the file; `true`/`1`/`yes`/`on` and `false`/`0`/`no`/`off` are accepted.
 */
export type { BetaFlags } from '../shared/beta-flags.ts';
export { NO_BETA };

const TRUE = new Set(['true', '1', 'yes', 'on']);
const FALSE = new Set(['false', '0', 'no', 'off', '']);

/** A boolean environment variable: undefined when unset, else true/false (or a readable error). */
export function parseFlag(name: string, value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const lower = value.trim().toLowerCase();
  if (TRUE.has(lower)) return true;
  if (FALSE.has(lower)) return false;
  throw new Error(`${name} must be true or false (got ${JSON.stringify(value)})`);
}

let warnedRemoved = false;
function warnRemoved(env: Record<string, string | undefined>, file: Record<string, unknown> | undefined) {
  const used = REMOVED_BETA_FLAGS.filter((flag) => env[flag.env] !== undefined || file?.[flag.configKey] !== undefined);
  if (!used.length || warnedRemoved) return;
  warnedRemoved = true;
  for (const flag of used)
    console.warn(`${flag.env} / beta.${flag.configKey} was removed and is ignored: ${flag.note}. You can delete it.`);
}

export function betaFromEnv(
  env: Record<string, string | undefined>,
  file?: { [key in BetaFlagId | 'groupedInspector']?: unknown },
): BetaFlags {
  warnRemoved(env, file);
  for (const flag of BETA_FLAGS) {
    const value = (file as Record<string, unknown> | undefined)?.[flag.configKey];
    if (value !== undefined && typeof value !== 'boolean')
      throw new Error(`the config file's beta.${flag.configKey} must be true or false`);
  }
  const allowed: BetaFlags = { ...NO_BETA, groupedInspector: false };
  for (const flag of BETA_FLAGS)
    allowed[flag.id] =
      parseFlag(flag.env, env[flag.env]) ??
      ((file as Record<string, unknown> | undefined)?.[flag.configKey] as boolean | undefined) ??
      false;
  return allowed;
}
