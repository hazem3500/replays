/** Portable settings contract shared by manifests, the broker and the versioned store. */
export type PluginSettingValue = boolean | string;
export type PluginSettingDefinition =
  | { id: string; label: string; order?: number; type: 'boolean'; default: boolean }
  | { id: string; label: string; order?: number; type: 'choice'; default: string; options: readonly { value: string; label?: string }[] };

export function settingAccepts(definition: PluginSettingDefinition, value: unknown): value is PluginSettingValue {
  return definition.type === 'boolean'
    ? typeof value === 'boolean'
    : typeof value === 'string' && definition.options.some((option) => option.value === value);
}

export function parsePluginSettings(input: unknown): PluginSettingDefinition[] {
  if (!Array.isArray(input) || input.length > 32) throw new TypeError('settings must be a list of at most 32 definitions');
  const seen = new Set<string>();
  return input.map((value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('each setting must be an object');
    const d = value as Record<string, unknown>;
    if (typeof d.id !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(d.id) || seen.has(d.id))
      throw new TypeError('setting ids must be unique lowercase ids');
    if (typeof d.label !== 'string' || !d.label.trim() || d.label.length > 80) throw new TypeError('setting label must be 1-80 characters');
    if (d.order !== undefined && (typeof d.order !== 'number' || !Number.isFinite(d.order)))
      throw new TypeError('setting order must be finite');
    if (
      Object.keys(d).some((key) => !['id', 'label', 'order', 'type', 'default', ...(d.type === 'choice' ? ['options'] : [])].includes(key))
    )
      throw new TypeError('unknown setting field');
    const base = { id: d.id, label: d.label.trim(), ...(typeof d.order === 'number' ? { order: d.order } : {}) };
    seen.add(d.id);
    if (d.type === 'boolean' && typeof d.default === 'boolean') return { ...base, type: 'boolean', default: d.default };
    if (d.type === 'choice' && Array.isArray(d.options) && d.options.length >= 2 && d.options.length <= 32) {
      const options = d.options.map((option: unknown) => {
        if (!option || typeof option !== 'object' || Array.isArray(option)) throw new TypeError('invalid setting option');
        const o = option as Record<string, unknown>;
        if (
          typeof o.value !== 'string' ||
          !o.value ||
          o.value.length > 200 ||
          (o.label !== undefined && (typeof o.label !== 'string' || o.label.length > 80)) ||
          Object.keys(o).some((key) => key !== 'value' && key !== 'label')
        )
          throw new TypeError('invalid setting option');
        return { value: o.value, ...(typeof o.label === 'string' ? { label: o.label } : {}) };
      });
      if (new Set(options.map((option) => option.value)).size !== options.length || !options.some((option) => option.value === d.default))
        throw new TypeError('setting choices need unique values and a matching default');
      return { ...base, type: 'choice', default: d.default as string, options };
    }
    throw new TypeError('setting needs a boolean default or choice options and matching default');
  });
}

export interface PluginSettingsRecord {
  version: number;
  values: Record<string, PluginSettingValue>;
}
