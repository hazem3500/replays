import type { LucideIcon } from 'lucide-react';

import { resolveSlot } from '../plugins/registry.ts';
import { shortcutLabel, type ShortcutAction } from '../shortcuts.ts';
import { focusedSource, type InspectorSource, useInspectorScope } from './inspector-scope.ts';
import { inspectorTabItems, type InspectorTabContext } from './inspector-tabs.tsx';
import { type SummaryTab, tabSummary, type TabSummary } from './tab-summary.ts';

const STRINGS = {
  shortcut: (key: string) => `Shortcut ${key}`,
  withNextError: (key: string, next: string) => `Shortcut ${key}; next error ${next}`,
};

const SUMMARY_TABS = ['console', 'network', 'performance', 'issues'] as const satisfies readonly SummaryTab[];

/** One badge over several sources: totals add up; a failure anywhere makes the merged kind a failure. */
function merged(summaries: readonly TabSummary[]): TabSummary {
  const total = summaries.reduce((sum, summary) => sum + summary.total, 0);
  const problems = summaries.reduce((sum, summary) => sum + summary.problems, 0);
  const worst = summaries.find((summary) => summary.problems > 0 && summary.problemKind !== 'warning') ?? summaries.find((summary) => summary.problems > 0);
  const kind = worst?.problemKind ?? summaries[0]?.problemKind ?? 'warning';
  return { total, problems, problemKind: kind, problemLabel: worst && summaries.length === 1 ? worst.problemLabel : '' };
}

function summariesFor(sources: readonly InspectorSource[]) {
  return Object.fromEntries(
    SUMMARY_TABS.map((tab) => [tab, merged(sources.map((source) => tabSummary(source.bundle, tab, source.timeline)))]),
  ) as Record<(typeof SUMMARY_TABS)[number], TabSummary>;
}

/** Steps the edits keep (a cut removes the steps inside it). */
function keptSteps(source: InspectorSource) {
  const { timeline } = source;
  return timeline ? source.bundle.steps.filter((step) => !timeline.isRemoved(step.at)).length : source.bundle.steps.length;
}

/**
 * The dock's tab items from its InspectorScope: badge totals from each source's captured data (tabSummary: the
 * source bundle minus what its edits cut; summed over every source in `all` mode), built-in feature tabs and plugin
 * tabs, all resolved through `viewer.inspector.tabs`.
 */
export function useInspectorTabItems({
  rail,
  featureTabs = [],
  featureBadges = {},
  pluginTabs = [],
}: {
  /** The steps rail is on screen, so there is no Steps tab. */
  rail: boolean;
  featureTabs?: readonly { id: string; featureTab: { label: string; Icon: LucideIcon; shortcut?: ShortcutAction } }[];
  featureBadges?: Record<string, number | undefined>;
  pluginTabs?: readonly { key: string; definition: { label: string } }[];
}) {
  const scope = useInspectorScope();
  const shown = scope.mode === 'all' ? scope.sources : [focusedSource(scope)];
  const summaries = summariesFor(shown);
  const context: InspectorTabContext = {
    stepCount: keptSteps(focusedSource(scope)),
    rail,
    summaries,
    issues: summaries.issues,
    descriptions: {
      console: STRINGS.withNextError(shortcutLabel('console-tab'), shortcutLabel('next-error')),
      network: STRINGS.withNextError(shortcutLabel('network-tab'), shortcutLabel('next-error')),
      performance: STRINGS.shortcut(shortcutLabel('performance-tab')),
    },
    features: featureTabs.map(({ id, featureTab }) => ({
      id,
      label: featureTab.label,
      icon: <featureTab.Icon />,
      ...(featureBadges[id] ? { unread: featureBadges[id] } : {}),
      ...(featureTab.shortcut ? { description: STRINGS.shortcut(shortcutLabel(featureTab.shortcut)) } : {}),
    })),
    plugins: pluginTabs.map((tab) => ({ key: tab.key, label: tab.definition.label })),
  };
  return inspectorTabItems(context, resolveSlot);
}
