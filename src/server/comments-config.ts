/**
 * Comments on replays: ON by default.
 *
 *   REPLAYS_COMMENTS=false     or    { "comments": { "enabled": false } } in the config file
 *
 * Off means no comment UI in the viewer and no `/api/replays/<id>/comments` routes (plain 404s); comments already
 * stored stay on disk until retention removes their replay. The environment variable wins over the file;
 * `true`/`1`/`yes`/`on` and `false`/`0`/`no`/`off` are accepted.
 */
export interface CommentsSettings {
  enabled: boolean;
}

export const NO_COMMENTS: CommentsSettings = { enabled: false };

const TRUE = new Set(['true', '1', 'yes', 'on']);
const FALSE = new Set(['false', '0', 'no', 'off']);

export function commentsFromEnv(env: Record<string, string | undefined>, file?: { enabled?: unknown }): CommentsSettings {
  if (file !== undefined && (file === null || typeof file !== 'object' || Array.isArray(file)))
    throw new Error("the config file's comments must be an object");
  if (file?.enabled !== undefined && typeof file.enabled !== 'boolean')
    throw new Error("the config file's comments.enabled must be true or false");
  const raw = env.REPLAYS_COMMENTS?.trim().toLowerCase();
  if (raw) {
    if (TRUE.has(raw)) return { enabled: true };
    if (FALSE.has(raw)) return { enabled: false };
    throw new Error(`REPLAYS_COMMENTS must be true or false (got ${JSON.stringify(env.REPLAYS_COMMENTS)})`);
  }
  return { enabled: file?.enabled ?? true };
}
