import { isRecord } from './plugin-validation.ts';

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
    if (!isRecord(value)) throw new TypeError('each setting must be an object');
    const d = value;
    if (typeof d.id !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(d.id) || seen.has(d.id))
      throw new TypeError('setting ids must be unique lowercase ids');
    const base = settingBase(d, d.id);
    seen.add(d.id);
    if (d.type === 'boolean' && typeof d.default === 'boolean') return { ...base, type: 'boolean', default: d.default };
    if (d.type === 'choice') return parseChoices(d, base);
    throw new TypeError('setting needs a boolean default or choice options and matching default');
  });
}

export interface PluginSettingsRecord {
  version: number;
  values: Record<string, PluginSettingValue>;
}

function parseOption(option: unknown): { value: string; label?: string } {
  if (!isRecord(option)) throw new TypeError('invalid setting option');
  if (
    typeof option.value !== 'string' ||
    !option.value ||
    option.value.length > 200 ||
    (option.label !== undefined && (typeof option.label !== 'string' || option.label.length > 80)) ||
    Object.keys(option).some((key) => key !== 'value' && key !== 'label')
  )
    throw new TypeError('invalid setting option');
  return { value: option.value, ...(typeof option.label === 'string' ? { label: option.label } : {}) };
}

function parseChoices(d: Record<string, unknown>, base: { id: string; label: string; order?: number }): PluginSettingDefinition {
  if (!Array.isArray(d.options) || d.options.length < 2 || d.options.length > 32)
    throw new TypeError('setting needs a boolean default or choice options and matching default');
  const options = d.options.map(parseOption);
  if (
    typeof d.default !== 'string' ||
    new Set(options.map((option) => option.value)).size !== options.length ||
    !options.some((option) => option.value === d.default)
  )
    throw new TypeError('setting choices need unique values and a matching default');
  return { ...base, type: 'choice', default: d.default, options };
}

function settingBase(d: Record<string, unknown>, id: string): { id: string; label: string; order?: number } {
  if (typeof d.label !== 'string' || !d.label.trim() || d.label.length > 80) throw new TypeError('setting label must be 1-80 characters');
  if (d.order !== undefined && (typeof d.order !== 'number' || !Number.isFinite(d.order)))
    throw new TypeError('setting order must be finite');
  if (Object.keys(d).some((key) => !['id', 'label', 'order', 'type', 'default', ...(d.type === 'choice' ? ['options'] : [])].includes(key)))
    throw new TypeError('unknown setting field');
  const base = { id, label: d.label.trim(), ...(typeof d.order === 'number' ? { order: d.order } : {}) };
  return base;
}
