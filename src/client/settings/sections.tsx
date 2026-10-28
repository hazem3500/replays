import {
  FlaskConicalIcon,
  InfoIcon,
  KeyboardIcon,
  type LucideIcon,
  PuzzleIcon,
  SquareTerminalIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { viewerRegistry } from '../plugins/registry.ts';
import type { SlotDescriptor } from '../plugins/slots.ts';
import { AboutSection } from './AboutSection.tsx';
import { CliSection } from './CliSection.tsx';
import { KeyboardSection } from './KeyboardSection.tsx';
import { LabsSection } from './LabsSection.tsx';
import { PluginsSection } from './PluginsSection.tsx';
import { strings } from './strings.ts';

export type SettingsSectionId = 'cli' | 'keyboard' | 'labs' | 'plugins' | 'about';

export interface SettingsSectionContext {
  /** Phones: the section is pushed full-screen. */
  readonly stacked: boolean;
}

/**
 * One Settings section, in the platform's slot format (`settings.sections`, src/client/plugins/slots.ts): `core:<id>`
 * descriptors with an order, an optional `when`, and a render. Built-ins only today; plugin sections can merge in later.
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

/** The sections to show, in order (the same filter-and-sort SlotRegistry.resolve applies). */
export function settingsSections(context: SettingsSectionContext) {
  return SETTINGS_SECTIONS.filter((section) => !section.when || section.when(context)).sort((a, b) => a.order - b.order);
}

export function isSettingsSection(value: unknown): value is SettingsSectionId {
  return SETTINGS_SECTIONS.some((section) => section.section === value);
}
