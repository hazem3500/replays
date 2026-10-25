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

export function settingKey(plugin: string, id: string) {
  return `replays-plugin:${plugin}:setting:${id}`;
}

function fits(definition: SettingDefinition, value: unknown): value is SettingValue {
  return definition.type === 'boolean'
    ? typeof value === 'boolean'
    : typeof value === 'string' && definition.options.some((option) => option.value === value);
}

export function readSetting(plugin: string, definition: SettingDefinition): SettingValue {
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
