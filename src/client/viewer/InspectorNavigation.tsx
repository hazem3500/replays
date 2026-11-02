import { ChevronDownIcon, PanelBottomCloseIcon, PanelBottomOpenIcon } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useRef } from 'react';

import { IconButton } from '@/components/icon-button.tsx';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu.tsx';

import { useOverflowFit } from '../hooks/use-overflow-fit.ts';
import { markScrollEdges, useTabIndicator } from '../hooks/use-tab-indicator.ts';
import { MOBILE_QUERY, useMediaQuery } from '../media.ts';
import { INSPECTOR_TABS_SLOT, type InspectorNavigationItem, type InspectorTabBadge } from './inspector-tabs.tsx';
import './inspector-navigation.css';
import './viewer-layout.css';

export type { InspectorNavigationItem } from './inspector-tabs.tsx';

const STRINGS = {
  label: 'Replay panels',
  more: 'More',
  moreLabel: (count: number) => `${count} more ${count === 1 ? 'panel' : 'panels'}`,
  hide: 'Hide panel',
  show: 'Show panel',
};

const TAB = '[role="tab"]:not([data-overflowed])';

function spoken(item: InspectorNavigationItem) {
  return [item.label, item.badge?.label, item.description].filter(Boolean).join(', ');
}

function onNavigationKeyDown(event: KeyboardEvent<HTMLElement>) {
  if (![' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  // why: the player listens for these on the document (seek, play); inside the tab row they belong to the tabs.
  event.stopPropagation();
  if ([' ', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
  const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(TAB));
  const index = tabs.indexOf(event.target as HTMLElement);
  if (index < 0) return;
  const next =
    event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  event.preventDefault();
  tabs[next]?.focus();
  tabs[next]?.click();
}

function Badge({ badge }: { badge: InspectorTabBadge | undefined }) {
  if (!badge) return null;
  return (
    <span className="inspector-navigation-count" data-tone={badge.tone} aria-hidden="true">
      {badge.value}
    </span>
  );
}

/**
 * The inspector's one tab row (loading shell, ready Inspector): the tabs in descriptor order with a hairline between
 * groups (Steps | Console · Network · Performance | Context | feature and plugin tabs), one underline that glides to
 * the active tab, and the tabs that do not fit behind "More" (measured; the active tab always stays in the row).
 * Phones scroll the row sideways instead (faded edges, the active tab kept in view).
 */
export function InspectorNavigation({
  items,
  activePanel,
  onPanelChange,
  ariaLabel = STRINGS.label,
  trailing,
}: {
  items: readonly InspectorNavigationItem[];
  activePanel: string;
  onPanelChange: (panel: string) => void;
  ariaLabel?: string;
  trailing?: ReactNode;
}) {
  const phone = useMediaQuery(MOBILE_QUERY);
  const row = useRef<HTMLDivElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const hidden = useOverflowFit(row, more, {
    selector: '[role="tab"]',
    attribute: 'data-panel',
    pinned: activePanel,
    // why: phones scroll the row instead, so every tab stays one tap away.
    enabled: !phone,
  });
  const { indicator, moveTo } = useTabIndicator(row, { selector: '[role="tab"][aria-selected="true"]', value: `${activePanel} ${hidden.join(' ')}` });
  // why: the underline and the tab's ink answer the click itself; the selection stays urgent so hosts see it at once.
  const select = (id: string, tab?: HTMLElement) => {
    if (tab) moveTo(tab);
    onPanelChange(id);
  };
  const overflowed = items.filter((item) => hidden.includes(item.id));
  const moreTone = overflowed.some((item) => item.badge?.tone === 'danger') ? 'danger' : overflowed.some((item) => item.badge?.tone) ? 'warning' : undefined;

  return (
    <div className="inspector-navigation" data-slot={INSPECTOR_TABS_SLOT}>
      <div
        ref={row}
        className="inspector-navigation-tabs"
        role="tablist"
        aria-label={ariaLabel}
        data-scroll={phone || undefined}
        onKeyDown={onNavigationKeyDown}
        onScroll={(event) => markScrollEdges(event.currentTarget)}
      >
        {items.map((item, index) => {
          const overflow = hidden.includes(item.id);
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`${item.id}-tab`}
              aria-selected={item.id === activePanel}
              aria-controls={item.panelId ?? `${item.id}-panel`}
              aria-label={spoken(item)}
              aria-hidden={overflow || undefined}
              title={item.description}
              tabIndex={item.id === activePanel && !overflow ? 0 : -1}
              data-testid={`${item.id}-tab`}
              data-panel={item.id}
              data-slot-item={item.slotId}
              data-group-start={(index > 0 && items[index - 1]!.group !== item.group) || undefined}
              data-overflowed={overflow || undefined}
              onClick={(event) => select(item.id, event.currentTarget)}
            >
              {item.icon ? (
                <span className="inspector-navigation-icon" aria-hidden="true">
                  {item.icon}
                </span>
              ) : null}
              <span className="inspector-navigation-label">{item.label}</span>
              <Badge badge={item.badge} />
            </button>
          );
        })}
        <span ref={indicator} className="inspector-navigation-indicator" aria-hidden="true" />
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger
          ref={more}
          className="inspector-navigation-more"
          data-empty={overflowed.length === 0 || undefined}
          aria-hidden={overflowed.length === 0 || undefined}
          tabIndex={overflowed.length === 0 ? -1 : 0}
          aria-label={STRINGS.moreLabel(overflowed.length)}
          data-testid="inspector-more"
        >
          {STRINGS.more}
          {moreTone ? <span className="inspector-navigation-dot" data-tone={moreTone} aria-hidden="true" /> : null}
          <ChevronDownIcon aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-44">
          {overflowed.map((item) => (
            <DropdownMenuItem key={item.id} data-slot-item={item.slotId} aria-label={spoken(item)} onClick={() => select(item.id)}>
              {item.icon ? (
                <span className="inspector-navigation-icon" aria-hidden="true">
                  {item.icon}
                </span>
              ) : null}
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              <Badge badge={item.badge} />
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {trailing}
    </div>
  );
}

/** Folds the panel to its tab row and back; says what it does (icon, tooltip, accessible name, aria-expanded). */
export function InspectorCollapseButton({
  collapsed,
  onCollapsedChange,
  shortcut,
  compact = false,
}: {
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  /** The fold shortcut: its label for the tooltip, its key for aria-keyshortcuts. */
  shortcut?: { label: string; keys: string };
  /** Phones: the 44 px end cap of the tab row. */
  compact?: boolean;
}) {
  return (
    <IconButton
      className={compact ? 'panel-expand' : 'inspector-collapse'}
      label={collapsed ? STRINGS.show : STRINGS.hide}
      {...(shortcut ? { shortcut: shortcut.label, 'aria-keyshortcuts': shortcut.keys } : {})}
      tooltipSide="top"
      tooltipAlign="end"
      aria-expanded={!collapsed}
      data-testid="inspector-collapse"
      onClick={() => onCollapsedChange(!collapsed)}
    >
      {collapsed ? <PanelBottomOpenIcon aria-hidden="true" /> : <PanelBottomCloseIcon aria-hidden="true" />}
    </IconButton>
  );
}
