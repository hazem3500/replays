import { useId, useSyncExternalStore } from 'react';

import { Switch } from '@/components/ui/switch.tsx';

import type { SettingDefinition } from '../plugins/api.ts';
import { viewerRegistry } from '../plugins/registry.ts';
import { readSetting, subscribeSettings, writeSetting } from '../plugins/settings.ts';
import { Segmented, SettingsGroup, SettingsRow } from './rows.tsx';
import { strings } from './strings.ts';

/** Interim view over the public plugin settings API, until the platform's PluginSettingsSection (src/client/plugins/) lands. */
function PluginSettingRow({ plugin, definition }: { plugin: string; definition: SettingDefinition }) {
  const value = useSyncExternalStore(subscribeSettings, () => readSetting(plugin, definition));
  const labelId = useId();
  return (
    <SettingsRow
      label={definition.label}
      labelId={labelId}
      control={
        definition.type === 'boolean' ? (
          <Switch
            aria-labelledby={labelId}
            checked={value === true}
            onCheckedChange={(checked) => writeSetting(plugin, definition, checked)}
          />
        ) : (
          <Segmented<string>
            labelledBy={labelId}
            value={String(value)}
            options={definition.options.map((option) => ({ value: option.value, label: option.label ?? option.value }))}
            onChange={(next) => writeSetting(plugin, definition, next)}
          />
        )
      }
    />
  );
}

export function PluginsSection() {
  const settings = useSyncExternalStore(viewerRegistry.subscribe, viewerRegistry.getSnapshot).settings;
  const plugins = [...new Set(settings.map((setting) => setting.plugin))];
  return (
    <>
      {plugins.map((plugin) => (
        <SettingsGroup key={plugin} title={plugin} footer={strings.savedInBrowser}>
          {settings
            .filter((setting) => setting.plugin === plugin)
            .toSorted((a, b) => (a.definition.order ?? 0) - (b.definition.order ?? 0) || a.seq - b.seq)
            .map((setting) => (
              <PluginSettingRow key={setting.key} plugin={plugin} definition={setting.definition} />
            ))}
        </SettingsGroup>
      ))}
    </>
  );
}
