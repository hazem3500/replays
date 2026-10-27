import { BadgeInfoIcon, GaugeIcon, GlobeIcon, ListOrderedIcon, PuzzleIcon, SquareTerminalIcon } from 'lucide-react';
import { useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react';

import { writeStorage } from '../storage.ts';
import './inspector-navigation.css';

export type InspectorNavigationLayout = 'direct' | 'grouped';

export interface InspectorNavigationCount {
  value: number;
  total?: number;
  noun: string;
  plural?: string;
}

export interface InspectorNavigationItem {
  id: string;
  label: string;
  group: 'journey' | 'diagnostics' | 'context' | 'more';
  icon?: ReactNode;
  count?: InspectorNavigationCount;
  badge?: string;
  badgeLabel?: string;
  description?: string;
  panelId?: string;
}

export interface InspectorNavigationGroup {
  id: InspectorNavigationItem['group'];
  label: string;
  defaultPanel: string;
}

export type InspectorNavigationBuiltin = 'steps' | 'console' | 'network' | 'performance' | 'context';

export interface InspectorNavigationExtraItem {
  id: string;
  label: string;
  /** Feature tabs and plugin tabs both render real panels, so both belong under More. */
  kind: 'feature' | 'plugin';
  icon?: ReactNode;
  count?: InspectorNavigationCount;
  badge?: string;
  badgeLabel?: string;
  description?: string;
}

/** Canonical labels and section order used by the loader and ready Inspector. */
export function buildInspectorNavigationModel({
  stepCount = 0,
  counts = {},
  extraItems = [],
  descriptions = {},
}: {
  stepCount?: number;
  counts?: Partial<Record<InspectorNavigationBuiltin, InspectorNavigationCount>>;
  extraItems?: readonly InspectorNavigationExtraItem[];
  descriptions?: Partial<Record<InspectorNavigationBuiltin, string>>;
} = {}) {
  const items: InspectorNavigationItem[] = [
    ...(stepCount > 0
      ? [
          {
            id: 'steps',
            label: 'Steps',
            group: 'journey' as const,
            icon: <ListOrderedIcon />,
            ...(counts.steps ? { count: counts.steps } : {}),
            ...(descriptions.steps ? { description: descriptions.steps } : {}),
          },
        ]
      : []),
    {
      id: 'console',
      label: 'Console',
      group: 'diagnostics',
      icon: <SquareTerminalIcon />,
      ...(counts.console ? { count: counts.console } : {}),
      ...(descriptions.console ? { description: descriptions.console } : {}),
    },
    {
      id: 'network',
      label: 'Network',
      group: 'diagnostics',
      icon: <GlobeIcon />,
      ...(counts.network ? { count: counts.network } : {}),
      ...(descriptions.network ? { description: descriptions.network } : {}),
    },
    {
      id: 'performance',
      label: 'Performance',
      group: 'diagnostics',
      icon: <GaugeIcon />,
      ...(counts.performance ? { count: counts.performance } : {}),
      ...(descriptions.performance ? { description: descriptions.performance } : {}),
    },
    {
      id: 'context',
      label: 'Context',
      group: 'context',
      icon: <BadgeInfoIcon />,
      ...(descriptions.context ? { description: descriptions.context } : {}),
    },
    ...extraItems.map((item) => ({
      id: item.id,
      label: item.label,
      group: 'more' as const,
      icon: item.icon ?? <PuzzleIcon />,
      ...(item.count ? { count: item.count } : {}),
      ...(item.badge ? { badge: item.badge } : {}),
      ...(item.badgeLabel ? { badgeLabel: item.badgeLabel } : {}),
      ...(item.description ? { description: item.description } : {}),
    })),
  ];
  const candidates: InspectorNavigationGroup[] = [
    { id: 'journey', label: 'Journey', defaultPanel: 'steps' },
    { id: 'diagnostics', label: 'Diagnostics', defaultPanel: 'network' },
    { id: 'context', label: 'Context', defaultPanel: 'context' },
    { id: 'more', label: 'More', defaultPanel: extraItems[0]?.id ?? '' },
  ];
  const groups = candidates.filter((group) => items.some((item) => item.group === group.id));
  return { items, groups };
}

export const INSPECTOR_NAVIGATION_LAYOUT_KEY = 'replays-inspector-navigation-layout';

const LAYOUT_CHANGE = 'replays-inspector-layout-change';
let volatileLayout: InspectorNavigationLayout | undefined;
function storedLayout(): InspectorNavigationLayout | undefined {
  try {
    const value = localStorage.getItem(INSPECTOR_NAVIGATION_LAYOUT_KEY);
    return value === 'direct' || value === 'grouped' ? value : undefined;
  } catch {
    return volatileLayout;
  }
}
function subscribeLayout(listener: () => void) {
  window.addEventListener(LAYOUT_CHANGE, listener);
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener(LAYOUT_CHANGE, listener);
    window.removeEventListener('storage', listener);
  };
}

/** Settings, loading shell and ready Inspector share a live browser preference. */
export function useInspectorNavigationLayout(betaEnabled: boolean) {
  const savedLayout = useSyncExternalStore(subscribeLayout, storedLayout, () => undefined);
  const layout: InspectorNavigationLayout = betaEnabled ? (savedLayout ?? 'grouped') : 'direct';
  const setLayout = (next: InspectorNavigationLayout) => {
    if (!betaEnabled) return;
    volatileLayout = next;
    writeStorage(INSPECTOR_NAVIGATION_LAYOUT_KEY, next);
    window.dispatchEvent(new Event(LAYOUT_CHANGE));
  };
  return { layout, setLayout };
}

function itemCount(count: InspectorNavigationCount | undefined) {
  if (!count) return '';
  const noun = count.value === 1 ? count.noun : (count.plural ?? `${count.noun}s`);
  return count.total === undefined ? `${count.value} ${noun}` : `${count.value} of ${count.total} ${count.plural ?? count.noun}`;
}

function onNavigationKeyDown(event: KeyboardEvent<HTMLElement>, selector: string) {
  if (![' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.stopPropagation();
  if ([' ', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
  const container = event.currentTarget.matches('button') ? event.currentTarget.parentElement : event.currentTarget;
  const buttons = Array.from(container?.querySelectorAll<HTMLElement>(selector) ?? []).filter((button) => !button.hasAttribute('disabled'));
  const target = event.currentTarget.matches('button') ? event.currentTarget : (event.target as HTMLElement);
  const index = buttons.indexOf(target);
  if (index < 0 || !buttons.length) return;
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? buttons.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
  event.preventDefault();
  buttons[next]?.focus();
  buttons[next]?.click();
}

/** Lightweight, controlled navigation shared by the progressive loader and ready Inspector. */
export function InspectorNavigation({
  items,
  groups,
  activePanel,
  onPanelChange,
  layout,
  ariaLabel = 'Replay panels',
  trailing,
}: {
  items: readonly InspectorNavigationItem[];
  groups: readonly InspectorNavigationGroup[];
  activePanel: string;
  onPanelChange: (panel: string) => void;
  layout: InspectorNavigationLayout;
  onLayoutChange: (layout: InspectorNavigationLayout) => void;
  betaEnabled: boolean;
  ariaLabel?: string;
  trailing?: ReactNode;
}) {
  const navigation = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const tabs = navigation.current?.closest<HTMLElement>('.inspector-tabs');
    const shell = tabs?.closest<HTMLElement>('.app-shell');
    if (!tabs || !shell) return;
    const measure = () => {
      const style = getComputedStyle(tabs);
      const border = (Number.parseFloat(style.borderTopWidth) || 0) + (Number.parseFloat(style.borderBottomWidth) || 0);
      // scrollHeight includes grouped rows even when the previous folded height clips them.
      const height = Math.ceil(Math.max(tabs.getBoundingClientRect().height, tabs.scrollHeight + border));
      if (height > 0) shell.style.setProperty('--inspector-tabs-height', `${height}px`);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(tabs);
    return () => observer.disconnect();
  }, []);
  const activeItem = items.find((item) => item.id === activePanel) ?? items[0];
  const [activeGroup, setActiveGroup] = useState<InspectorNavigationItem['group']>(activeItem?.group ?? 'diagnostics');
  const shownGroup = activeItem?.group ?? activeGroup;
  const groupedItems = items.filter((item) => item.group === shownGroup);
  const activateGroup = (group: InspectorNavigationGroup) => {
    setActiveGroup(group.id);
    if (!items.some((item) => item.id === activePanel && item.group === group.id)) onPanelChange(group.defaultPanel);
  };

  return (
    <div ref={navigation} className="inspector-navigation" data-layout={layout} data-has-trailing={Boolean(trailing) || undefined}>
      {layout === 'direct' ? (
        <div
          className="inspector-navigation-tabs"
          role="tablist"
          aria-label={ariaLabel}
          onKeyDown={(event) => onNavigationKeyDown(event, '[role="tab"]')}
        >
          {items.map((item) => {
            const count = itemCount(item.count);
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                id={`${item.id}-tab`}
                aria-selected={item.id === activePanel}
                aria-controls={item.panelId ?? `${item.id}-panel`}
                aria-label={`${item.label}${count ? `, ${count}` : ''}${item.badgeLabel ? `, ${item.badgeLabel}` : ''}${item.description ? `, ${item.description}` : ''}`}
                title={item.description}
                tabIndex={item.id === activePanel ? 0 : -1}
                data-testid={`${item.id}-tab`}
                onClick={() => onPanelChange(item.id)}
              >
                {item.icon ? (
                  <span className="inspector-navigation-icon" aria-hidden="true">
                    {item.icon}
                  </span>
                ) : null}
                <span className="inspector-navigation-label">{item.label}</span>
                {count ? (
                  <span className="inspector-navigation-count" aria-hidden="true">
                    {count}
                  </span>
                ) : null}
                {item.badge ? (
                  <span className="inspector-navigation-badge" aria-hidden="true">
                    {item.badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : (
        <>
          <div className="inspector-navigation-groups" role="group" aria-label="Inspector sections">
            {groups.map((group) => {
              const available = items.some((item) => item.group === group.id);
              if (!available) return null;
              return (
                <button
                  key={group.id}
                  type="button"
                  aria-pressed={shownGroup === group.id}
                  data-testid={`inspector-group-${group.id}`}
                  onClick={() => activateGroup(group)}
                  onKeyDown={(event) => onNavigationKeyDown(event, 'button[aria-pressed]')}
                >
                  {group.label}
                </button>
              );
            })}
          </div>
          <div
            className="inspector-navigation-tabs inspector-navigation-subtabs"
            role="tablist"
            aria-label={`${groups.find((group) => group.id === shownGroup)?.label ?? 'Replay'} panels`}
            onKeyDown={(event) => onNavigationKeyDown(event, '[role="tab"]')}
          >
            {groupedItems.map((item) => {
              const count = itemCount(item.count);
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  id={`${item.id}-tab`}
                  aria-selected={item.id === activePanel}
                  aria-controls={item.panelId ?? `${item.id}-panel`}
                  aria-label={`${item.label}${count ? `, ${count}` : ''}${item.badgeLabel ? `, ${item.badgeLabel}` : ''}${item.description ? `, ${item.description}` : ''}`}
                  title={item.description}
                  tabIndex={item.id === activePanel ? 0 : -1}
                  data-testid={`${item.id}-tab`}
                  onClick={() => onPanelChange(item.id)}
                >
                  {item.icon ? (
                    <span className="inspector-navigation-icon" aria-hidden="true">
                      {item.icon}
                    </span>
                  ) : null}
                  <span className="inspector-navigation-label">{item.label}</span>
                  {count ? (
                    <span className="inspector-navigation-count" aria-hidden="true">
                      {count}
                    </span>
                  ) : null}
                  {item.badge ? (
                    <span className="inspector-navigation-badge" aria-hidden="true">
                      {item.badge}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </>
      )}
      {trailing}
    </div>
  );
}
