/**
 * Beta features: every one is OFF unless switched on explicitly, so a default deployment exposes none of their UI,
 * routes or code paths.
 *
 *   REPLAYS_BETA_EDITOR=true     or    { "beta": { "editor": true } } in the config file
 *
 * `editor`: edit mode in the viewer (non-destructive trims, cuts, "Remove waits", zoom, speed-ups, blur boxes and
 * captions), the `GET|PUT /api/replays/<id>/edits` API, and applying saved edits on playback and in video exports.
 * The environment variable wins over the file; `true`/`1`/`yes`/`on` and `false`/`0`/`no`/`off` are accepted.
 */
export interface BetaFlags {
  editor: boolean;
}

export const NO_BETA: BetaFlags = { editor: false };

const TRUE = new Set(['true', '1', 'yes', 'on']);
const FALSE = new Set(['false', '0', 'no', 'off', '']);

function flag(name: string, value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const lower = value.trim().toLowerCase();
  if (TRUE.has(lower)) return true;
  if (FALSE.has(lower)) return false;
  throw new Error(`${name} must be true or false (got ${JSON.stringify(value)})`);
}

export function betaFromEnv(env: Record<string, string | undefined>, file?: { editor?: unknown }): BetaFlags {
  if (file?.editor !== undefined && typeof file.editor !== 'boolean')
    throw new Error("the config file's beta.editor must be true or false");
  return { editor: flag('REPLAYS_BETA_EDITOR', env.REPLAYS_BETA_EDITOR) ?? file?.editor ?? false };
}
