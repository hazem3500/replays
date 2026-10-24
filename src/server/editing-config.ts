/** Host write policy. The beta editor remains the outer gate for reads, playback and exports. */
export interface EditingSettings {
  enabled: boolean;
}

const TRUE = new Set(['true', '1', 'yes', 'on']);
const FALSE = new Set(['false', '0', 'no', 'off']);

/** Environment wins over config; invalid config still fails startup even when overridden. */
export function editingFromEnv(env: Record<string, string | undefined>, file?: { enabled?: unknown }): EditingSettings {
  if (file !== undefined && (file === null || typeof file !== 'object' || Array.isArray(file)))
    throw new Error("the config file's editing must be an object");
  if (file && Object.keys(file).some((key) => key !== 'enabled')) throw new Error("the config file's editing has unknown keys");
  if (file?.enabled !== undefined && typeof file.enabled !== 'boolean')
    throw new Error("the config file's editing.enabled must be true or false");
  const raw = env.EDITING_ENABLED?.trim().toLowerCase();
  if (raw) {
    if (TRUE.has(raw)) return { enabled: true };
    if (FALSE.has(raw)) return { enabled: false };
    throw new Error(`EDITING_ENABLED must be true or false (got ${JSON.stringify(env.EDITING_ENABLED)})`);
  }
  return { enabled: file?.enabled ?? true };
}
