import { BadgeInfoIcon, GaugeIcon, GlobeIcon, ListOrderedIcon, type LucideIcon, PuzzleIcon, SquareTerminalIcon } from 'lucide-react';

import type { SlotDescriptor } from '../plugins/slots.ts';
import type { ShortcutAction } from '../shortcuts.ts';
import { stepsBadge, type TabBadge } from './tab-badges.ts';

export const INSPECTOR_TABS_SLOT = 'viewer.inspector.tabs';

const STRINGS = {
  steps: 'Steps',
  console: 'Console',
  network: 'Network',
  performance: 'Performance',
  performanceShort: 'Perf',
  context: 'Context',
};

/** Hairlines part the row between groups; a group never wraps to a second row. */
export type InspectorTabGroup = 'journey' | 'diagnostics' | 'context' | 'more';

export interface InspectorTabItem {
  /** The panel value and the trigger's id stem (`network`, `comments`, `plugin:<owner>:<id>`). */
  id: string;
  /** The slot item id (`core:network`, `plugin:<owner>:<id>`): `data-slot-item`. */
  slotId: string;
  label: string;
  /** Phones' label, where the full one would crowd the row. */
  shortLabel?: string;
  Icon: LucideIcon;
  group: InspectorTabGroup;
  badge?: TabBadge;
  shortcut?: ShortcutAction;
  /** The tab also answers the next-error shortcut: its hint says so. */
  errors?: boolean;
}

export interface InspectorFeatureTab {
  id: string;
  label: string;
  Icon: LucideIcon;
  shortcut?: ShortcutAction;
  badge?: TabBadge;
}

export interface InspectorTabContext {
  stepCount: number;
  /** invariant: steps have one home at a time. With the steps rail on screen there is no Steps tab. */
  rail: boolean;
  badges: Partial<Record<'console' | 'network' | 'performance', TabBadge | undefined>>;
  features?: readonly InspectorFeatureTab[];
  plugins?: readonly { key: string; label: string }[];
}

type TabDescriptor = SlotDescriptor<InspectorTabContext, InspectorTabItem>;
export type TabResolver = (name: string, builtins: readonly TabDescriptor[], context: InspectorTabContext) => readonly TabDescriptor[];

function withBadge(item: InspectorTabItem, badge: TabBadge | undefined): InspectorTabItem {
  return badge ? { ...item, badge } : item;
}

export const CORE_INSPECTOR_TABS: readonly TabDescriptor[] = [
  {
    id: 'core:steps',
    order: 100,
    when: ({ stepCount, rail }) => stepCount > 0 && !rail,
    render: ({ stepCount }) =>
      withBadge(
        { id: 'steps', slotId: 'core:steps', label: STRINGS.steps, Icon: ListOrderedIcon, group: 'journey' },
        stepsBadge(stepCount),
      ),
  },
  {
    id: 'core:console',
    order: 200,
    render: ({ badges }) =>
      withBadge(
        {
          id: 'console',
          slotId: 'core:console',
          label: STRINGS.console,
          Icon: SquareTerminalIcon,
          group: 'diagnostics',
          shortcut: 'console-tab',
          errors: true,
        },
        badges.console,
      ),
  },
  {
    id: 'core:network',
    order: 300,
    render: ({ badges }) =>
      withBadge(
        {
          id: 'network',
          slotId: 'core:network',
          label: STRINGS.network,
          Icon: GlobeIcon,
          group: 'diagnostics',
          shortcut: 'network-tab',
          errors: true,
        },
        badges.network,
      ),
  },
  {
    id: 'core:performance',
    order: 400,
    render: ({ badges }) =>
      withBadge(
        {
          id: 'performance',
          slotId: 'core:performance',
          label: STRINGS.performance,
          shortLabel: STRINGS.performanceShort,
          Icon: GaugeIcon,
          group: 'diagnostics',
          shortcut: 'performance-tab',
        },
        badges.performance,
      ),
  },
  {
    id: 'core:context',
    order: 500,
    render: () => ({ id: 'context', slotId: 'core:context', label: STRINGS.context, Icon: BadgeInfoIcon, group: 'context' }),
  },
];

function featureDescriptors(features: readonly InspectorFeatureTab[] = []): TabDescriptor[] {
  return features.map((feature, index) => ({
    id: `core:${feature.id}`,
    order: 600 + index * 10,
    render: () =>
      withBadge(
        {
          id: feature.id,
          slotId: `core:${feature.id}`,
          label: feature.label,
          Icon: feature.Icon,
          group: 'more',
          ...(feature.shortcut ? { shortcut: feature.shortcut } : {}),
        },
        feature.badge,
      ),
  }));
}

/** Without a registry (a loading shell, before plugins load): the built-ins that apply, in their own order. */
export const builtinsOnly: TabResolver = (_name, builtins, context) =>
  builtins.filter((item) => !item.when || item.when(context)).toSorted((a, b) => a.order - b.order);

/**
 * The tab row in order, as `viewer.inspector.tabs` resolves it: hosts may reorder or hide built-ins. Plugin
 * descriptors are not rendered here; a plugin tab's panel mounts through PluginMount with its registered label.
 */
export function inspectorTabItems(context: InspectorTabContext, resolve: TabResolver = builtinsOnly): InspectorTabItem[] {
  const plugins = new Map((context.plugins ?? []).map((plugin) => [plugin.key, plugin]));
  return resolve(INSPECTOR_TABS_SLOT, [...CORE_INSPECTOR_TABS, ...featureDescriptors(context.features)], context).flatMap(
    (descriptor): InspectorTabItem[] => {
      if (descriptor.id.startsWith('core:')) return [descriptor.render(context)];
      const plugin = plugins.get(descriptor.id);
      return plugin ? [{ id: plugin.key, slotId: plugin.key, label: plugin.label, Icon: PuzzleIcon, group: 'more' }] : [];
    },
  );
}
