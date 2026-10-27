/**
 * Beta features: every one is OFF unless switched on explicitly, so a default deployment exposes none of their UI,
 * routes or code paths.
 *
 *   REPLAYS_BETA_EDITOR=true     or    { "beta": { "editor": true } } in the config file
 *   REPLAYS_BETA_MALLEABLE=true  or    { "beta": { "malleable": true } }
 *
 * `editor`: edit mode in the viewer (non-destructive trims, cuts, "Remove waits", zoom, speed-ups, blur boxes and
 * captions), the `GET|PUT /api/replays/<id>/edits` API, and applying saved edits on playback and in video exports.
 * `malleable`: user plugins (a sandboxed, hot-loading plugin workshop in the viewer, versioned per user or workspace), the
 * `/api/malleable/*` routes, the plugin sandbox page and the agent bridge (WebMCP tools in the page, an MCP server for
 * agents outside it): docs/malleability.md. Off means none of those exist: no UI, 404s, nothing exposed to agents.
 * The environment variables win over the file; `true`/`1`/`yes`/`on` and `false`/`0`/`no`/`off` are accepted.
 */
export interface BetaFlags {
  editor: boolean;
  malleable: boolean;
  groupedInspector: boolean;
}

export const NO_BETA: BetaFlags = { editor: false, malleable: false, groupedInspector: false };

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

export function betaFromEnv(
  env: Record<string, string | undefined>,
  file?: { editor?: unknown; malleable?: unknown; groupedInspector?: unknown },
): BetaFlags {
  for (const key of ['editor', 'malleable', 'groupedInspector'] as const)
    if (file?.[key] !== undefined && typeof file[key] !== 'boolean') throw new Error(`the config file's beta.${key} must be true or false`);
  return {
    editor: parseFlag('REPLAYS_BETA_EDITOR', env.REPLAYS_BETA_EDITOR) ?? (file?.editor as boolean | undefined) ?? false,
    malleable: parseFlag('REPLAYS_BETA_MALLEABLE', env.REPLAYS_BETA_MALLEABLE) ?? (file?.malleable as boolean | undefined) ?? false,
    groupedInspector:
      parseFlag('REPLAYS_BETA_GROUPED_INSPECTOR', env.REPLAYS_BETA_GROUPED_INSPECTOR) ??
      (file?.groupedInspector as boolean | undefined) ??
      false,
  };
}
