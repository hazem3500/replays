import { getPluginSettings, setPluginSetting } from '../malleable/api.ts';
import type { PluginScope } from '../../shared/malleable.ts';
import type { PluginSettingsRecord } from '../../shared/plugin-settings.ts';
import { readStorage, writeStorage } from '../storage.ts';
import type { SettingDefinition, SettingValue, ViewerPluginSettings } from './api.ts';
import { type ViewerRegistry, viewerRegistry } from './registry.ts';

/*
 * Plugin settings (registerSetting): one value per person, kept in this browser's localStorage under a key namespaced by
 * the plugin (`replays-plugin:<plugin>:setting:<id>`), so two plugins' `theme` settings never meet. A stored value that
 * no longer fits the definition (a removed option, a changed type) reads as the default.
 */

type Listener = (plugin: string, id: string, value: SettingValue) => void;

const listeners = new Set<Listener>();
const remote = new Map<
  string,
  { scope: PluginScope; id: string; record?: PluginSettingsRecord; loading?: Promise<void>; writing?: Promise<void> }
>();

function publish(plugin: string, record: PluginSettingsRecord) {
  const target = remote.get(plugin);
  if (!target) return;
  target.record = record;
  for (const [id, value] of Object.entries(record.values)) for (const listener of listeners) listener(plugin, id, value);
}

/** Settings uses the same contribution list and subscriptions for host and sandboxed plugins. */
export function bindUserSettings(plugin: string, scope: PluginScope, id: string) {
  let target = remote.get(plugin);
  if (!target || target.scope !== scope || target.id !== id) {
    target = { scope, id };
    remote.set(plugin, target);
  }
  const bound = target;
  bound.loading = getPluginSettings(scope, id)
    .then((record) => {
      if (remote.get(plugin) === bound) publish(plugin, record);
    })
    .catch((error: unknown) => {
      // why: an unsaved draft has no settings object to hydrate until its first approved save.
      if (!(error && typeof error === 'object' && 'status' in error && error.status === 404))
        console.warn(`plugin ${plugin}: settings could not be loaded`, error);
    });
}

export async function writeSettingValue(plugin: string, definition: SettingDefinition, value: SettingValue): Promise<void> {
  if (!fits(definition, value)) throw new TypeError('invalid setting value');
  const target = remote.get(plugin);
  if (!target) {
    writeLocalSetting(plugin, definition, value);
    return;
  }
  const previous = target.writing;
  const write = async () => {
    await previous?.catch(() => {});
    await target.loading;
    const current = target.record ?? (await getPluginSettings(target.scope, target.id));
    try {
      publish(plugin, await setPluginSetting(target.scope, target.id, { id: definition.id, value, baseVersion: current.version }));
    } catch (error) {
      await getPluginSettings(target.scope, target.id)
        .then((record) => publish(plugin, record))
        .catch(() => {});
      throw error;
    }
  };
  target.writing = write();
  await target.writing;
}

export function settingKey(plugin: string, id: string) {
  return `replays-plugin:${plugin}:setting:${id}`;
}

function fits(definition: SettingDefinition, value: unknown): value is SettingValue {
  return definition.type === 'boolean'
    ? typeof value === 'boolean'
    : typeof value === 'string' && definition.options.some((option) => option.value === value);
}

export function readSetting(plugin: string, definition: SettingDefinition): SettingValue {
  const target = remote.get(plugin);
  if (target) {
    const value = target.record?.values[definition.id];
    return fits(definition, value) ? value : definition.default;
  }
  const raw = readStorage(settingKey(plugin, definition.id));
  if (raw !== null) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (fits(definition, parsed)) return parsed;
    } catch {
      // Not ours (or corrupted): the default.
    }
  }
  return definition.default;
}

export function writeSetting(plugin: string, definition: SettingDefinition, value: SettingValue) {
  if (remote.has(plugin)) {
    void writeSettingValue(plugin, definition, value).catch((error: unknown) =>
      console.error(`plugin ${plugin}: setting was not saved`, error),
    );
    return;
  }
  writeLocalSetting(plugin, definition, value);
}

function writeLocalSetting(plugin: string, definition: SettingDefinition, value: SettingValue) {
  if (!fits(definition, value)) return;
  writeStorage(settingKey(plugin, definition.id), JSON.stringify(value));
  for (const listener of listeners) {
    try {
      listener(plugin, definition.id, value);
    } catch (error) {
      console.error(`plugin ${plugin}: a settings listener failed:`, error);
    }
  }
}

/** Every change to any plugin's setting (the More menu re-renders from this). */
export function subscribeSettings(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** `context.settings` for one plugin: reads its own definitions from the registry, hears only its own changes. */
export function pluginSettings(plugin: string, registry: ViewerRegistry = viewerRegistry): ViewerPluginSettings {
  return {
    get(id) {
      const entry = registry.getSnapshot().settings.find((setting) => setting.plugin === plugin && setting.definition.id === id);
      return entry ? readSetting(plugin, entry.definition) : undefined;
    },
    onChange(listener) {
      return subscribeSettings((from, id, value) => {
        if (from === plugin) listener(id, value);
      });
    },
  };
}
