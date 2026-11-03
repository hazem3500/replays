import { DatabaseIcon, FlaskConicalIcon, InfoIcon, KeyboardIcon, type LucideIcon, PuzzleIcon, SquareTerminalIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { viewerRegistry } from '../plugins/registry.ts';
import { isHostSurface, surfaceValue, SurfaceContentView } from '../plugins/HostSurface.tsx';
import type { HostSurfaceDefinition } from '../plugins/surface-contracts.ts';
import type { SlotDescriptor } from '../plugins/slots.ts';
import { DataStorage } from './DataStorage.tsx';
import { AboutSection } from './AboutSection.tsx';
import { CliSection } from './CliSection.tsx';
import { KeyboardSection } from './KeyboardSection.tsx';
import { LabsSection } from './LabsSection.tsx';
import { PluginsSection } from './PluginsSection.tsx';
import { strings } from './strings.ts';

export type SettingsSectionId = 'cli' | 'keyboard' | 'labs' | 'plugins' | 'about' | 'data-storage' | `plugin:${string}:${string}`;

export interface SettingsSectionContext {
  /** Phones: the section is pushed full-screen. */
  readonly stacked: boolean;
}

/**
 * One Settings section, in the platform's slot format (`settings.sections`, src/client/plugins/slots.ts): `core:<id>`
 * descriptors with an order, an optional `when`, and a render.
 */
export interface SettingsSectionDescriptor extends SlotDescriptor<SettingsSectionContext, ReactNode> {
  /** The short id: `openSettings('labs')`, `?settings=labs`. */
  section: SettingsSectionId;
  label: string;
  icon: LucideIcon;
}

export const SETTINGS_SECTIONS: readonly SettingsSectionDescriptor[] = [
  { id: 'core:cli', section: 'cli', order: 100, label: strings.sections.cli, icon: SquareTerminalIcon, render: () => <CliSection /> },
  {
    id: 'core:keyboard',
    section: 'keyboard',
    order: 200,
    label: strings.sections.keyboard,
    icon: KeyboardIcon,
    render: () => <KeyboardSection />,
  },
  {
    id: 'core:data-storage',
    section: 'data-storage',
    order: 250,
    label: strings.sections.dataStorage,
    icon: DatabaseIcon,
    render: () => <DataStorage />,
  },
  { id: 'core:labs', section: 'labs', order: 300, label: strings.sections.labs, icon: FlaskConicalIcon, render: () => <LabsSection /> },
  {
    id: 'core:plugins',
    section: 'plugins',
    order: 400,
    label: strings.sections.plugins,
    icon: PuzzleIcon,
    // why: an empty Plugins section would be noise; it appears once a plugin registers a setting.
    when: () => viewerRegistry.getSnapshot().settings.length > 0,
    render: () => <PluginsSection />,
  },
  { id: 'core:about', section: 'about', order: 500, label: strings.sections.about, icon: InfoIcon, render: () => <AboutSection /> },
];

/** Host sections and core sections share hide/order policy; registered preferences stay in the Plugins section. */
export function settingsSections(context: SettingsSectionContext) {
  const builtins = SETTINGS_SECTIONS.map((section) => ({
    id: section.id,
    order: section.order,
    when: () => !section.when || section.when(context),
    render: () => section,
  }));
  return viewerRegistry
    .resolveSlot<SettingsSectionContext, SettingsSectionDescriptor | HostSurfaceDefinition>('settings.sections', builtins, context)
    .flatMap((item): SettingsSectionDescriptor[] => {
      const value = surfaceValue(item, context);
      if (!value) return [];
      if ('section' in value) return [value];
      if (!isPluginSection(item.id) || !isHostSurface(value)) return [];
      return [
        {
          id: item.id,
          section: item.id,
          order: item.order,
          label: value.label,
          icon: PuzzleIcon,
          render: (at) => <SurfaceContentView value={value} context={at} />,
        },
      ];
    });
}

function isPluginSection(value: unknown): value is `plugin:${string}:${string}` {
  return typeof value === 'string' && /^plugin:[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/.test(value);
}

export function isSettingsSection(value: unknown): value is SettingsSectionId {
  return (
    SETTINGS_SECTIONS.some((section) => section.section === value) ||
    (isPluginSection(value) && settingsSections({ stacked: false }).some((section) => section.section === value))
  );
}
