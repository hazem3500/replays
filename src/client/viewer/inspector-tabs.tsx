import { BadgeInfoIcon, CircleAlertIcon, GaugeIcon, GlobeIcon, ListOrderedIcon, PuzzleIcon, SquareTerminalIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import type { SlotDescriptor } from '../plugins/slots.ts';
import type { SummaryTab, TabSummary } from './tab-summary.ts';

/*
 * The inspector's tab row as one ordered list of `viewer.inspector.tabs` descriptors: built-ins `core:steps` (40, only
 * without the steps rail: steps have one home at a time), `core:issues` (50),
 * `core:console` (200), `core:network` (300), `core:performance` (400), `core:context` (500), built-in feature tabs
 * (`core:comments`, 600+), then plugin tabs (`plugin:<owner>:<id>`, which the registry ranks after the built-ins).
 * Pure: the loading shell resolves the built-ins alone, the ready Inspector resolves them through the plugin registry.
 */

export const INSPECTOR_TABS_SLOT = 'viewer.inspector.tabs';
/** The Issues panel is in (Inspector.tsx): its tab shows, and it opens by default when a replay has issues. */
export const ISSUES_TAB = true;

const STRINGS = {
  issues: 'Issues',
  steps: 'Steps',
  console: 'Console',
  network: 'Network',
  performance: 'Performance',
  context: 'Context',
  nouns: {
    issues: ['problem', 'problems'],
    steps: ['step', 'steps'],
    console: ['entry', 'entries'],
    network: ['request', 'requests'],
    performance: ['signal', 'signals'],
  },
  unread: (count: number) => `${count} unread`,
} as const;

export type InspectorTabGroup = 'issues' | 'journey' | 'diagnostics' | 'context' | 'more';

/** One compact count on a tab: the total, tinted when some of it is a problem. `label` is its spoken form. */
export interface InspectorTabBadge {
  value: number;
  tone?: 'danger' | 'warning';
  label: string;
}

export interface InspectorNavigationItem {
  /** The panel value (`steps`, `network`, `comments`, `plugin:<owner>:<id>`). */
  id: string;
  /** The slot item id (`core:network`, `plugin:<owner>:<id>`). */
  slotId: string;
  label: string;
  group: InspectorTabGroup;
  icon?: ReactNode;
  badge?: InspectorTabBadge;
  description?: string;
  panelId?: string;
}

export interface InspectorFeatureTab {
  id: string;
  label: string;
  icon: ReactNode;
  unread?: number;
  description?: string;
}

export interface InspectorTabContext {
  stepCount: number;
  /** The steps rail is on screen (desktop): steps live there, not in a tab. */
  rail?: boolean;
  /** The Issues tab shows (always, once its panel exists, so the row never shifts between replays). */
  issuesTab?: boolean;
  /** Issues found in the replay; a failure among them tints the badge red, slow ones amber. */
  issues?: TabSummary;
  /** Totals and problems per diagnostics tab (tab-summary.ts); a tab without one shows no badge. */
  summaries?: Partial<Record<SummaryTab, TabSummary>>;
  descriptions?: Partial<Record<SummaryTab, string>>;
  features?: readonly InspectorFeatureTab[];
  plugins?: readonly { key: string; label: string }[];
}

type TabDescriptor = SlotDescriptor<InspectorTabContext, InspectorNavigationItem>;
export type TabResolver = (name: string, builtins: readonly TabDescriptor[], context: InspectorTabContext) => readonly TabDescriptor[];

function counted(total: number, [one, many]: readonly string[]) {
  return `${total} ${total === 1 ? one : many}`;
}

function summaryBadge(tab: SummaryTab | 'issues', summary: TabSummary | undefined): InspectorTabBadge | undefined {
  if (!summary || summary.total === 0) return undefined;
  // why: every issue is a problem, so failures among them make the badge red and slow ones amber.
  if (tab === 'issues') return { value: summary.total, tone: summary.problemKind === 'failed' ? 'danger' : 'warning', label: counted(summary.total, STRINGS.nouns.issues) };
  const label = [counted(summary.total, STRINGS.nouns[tab]), summary.problemLabel].filter(Boolean).join(', ');
  if (!summary.problems) return { value: summary.total, label };
  return { value: summary.total, tone: summary.problemKind === 'warning' ? 'warning' : 'danger', label };
}

function diagnostics(tab: SummaryTab, order: number, icon: ReactNode): TabDescriptor {
  return {
    id: `core:${tab}`,
    order,
    render: ({ summaries, descriptions }) => {
      const badge = summaryBadge(tab, summaries?.[tab]);
      const description = descriptions?.[tab];
      return {
        id: tab,
        slotId: `core:${tab}`,
        label: STRINGS[tab],
        group: 'diagnostics',
        icon,
        ...(badge ? { badge } : {}),
        ...(description ? { description } : {}),
      };
    },
  };
}

export const CORE_INSPECTOR_TABS: readonly TabDescriptor[] = [
  {
    id: 'core:issues',
    order: 50,
    when: ({ issuesTab = ISSUES_TAB }) => issuesTab,
    render: ({ issues }) => {
      const badge = summaryBadge('issues', issues);
      return { id: 'issues', slotId: 'core:issues', label: STRINGS.issues, group: 'issues', icon: <CircleAlertIcon />, ...(badge ? { badge } : {}) };
    },
  },
  {
    id: 'core:steps',
    order: 40,
    when: ({ stepCount, rail }) => stepCount > 0 && !rail,
    render: ({ stepCount }) => ({
      id: 'steps',
      slotId: 'core:steps',
      label: STRINGS.steps,
      group: 'journey',
      icon: <ListOrderedIcon />,
      badge: { value: stepCount, label: counted(stepCount, STRINGS.nouns.steps) },
    }),
  },
  diagnostics('console', 200, <SquareTerminalIcon />),
  diagnostics('network', 300, <GlobeIcon />),
  diagnostics('performance', 400, <GaugeIcon />),
  {
    id: 'core:context',
    order: 500,
    render: () => ({ id: 'context', slotId: 'core:context', label: STRINGS.context, group: 'context', icon: <BadgeInfoIcon /> }),
  },
];

function featureTabs(features: readonly InspectorFeatureTab[] = []): TabDescriptor[] {
  return features.map((feature, index) => ({
    id: `core:${feature.id}`,
    order: 600 + index * 10,
    render: () => ({
      id: feature.id,
      slotId: `core:${feature.id}`,
      label: feature.label,
      group: 'more',
      icon: feature.icon,
      ...(feature.unread ? { badge: { value: feature.unread, label: STRINGS.unread(feature.unread) } } : {}),
      ...(feature.description ? { description: feature.description } : {}),
    }),
  }));
}

/** Without a registry (the loading shell, before plugins load): the built-ins that apply, in their own order. */
const builtinsOnly: TabResolver = (_name, builtins, context) =>
  builtins.filter((item) => !item.when || item.when(context)).toSorted((a, b) => a.order - b.order);

/** The tab row's items in order. Plugin descriptors are never rendered here: their panels mount through PluginMount. */
export function inspectorTabItems(context: InspectorTabContext, resolve: TabResolver = builtinsOnly): InspectorNavigationItem[] {
  const plugins = new Map((context.plugins ?? []).map((plugin) => [plugin.key, plugin]));
  return resolve(INSPECTOR_TABS_SLOT, [...CORE_INSPECTOR_TABS, ...featureTabs(context.features)], context).flatMap((descriptor) => {
    if (descriptor.id.startsWith('core:')) return [descriptor.render(context)];
    const plugin = plugins.get(descriptor.id);
    return plugin ? [{ id: plugin.key, slotId: plugin.key, label: plugin.label, group: 'more' as const, icon: <PuzzleIcon /> }] : [];
  });
}
