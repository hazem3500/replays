import { createContext, type ReactNode, Suspense, use, useRef } from 'react';

import { AnimatedIcon } from '@/components/animated-icon.tsx';
import { HoverGlide } from '@/components/sliding-highlight.tsx';
import { Hint, IconButton } from '@/components/icon-button.tsx';
import { Tabs, TabsContent, TabsIndicator, TabsList, TabsTrigger } from '@/components/ui/tabs.tsx';

import { useNarrowerThan } from '../hooks/use-narrower-than.ts';
import { usePanelReveal } from '../hooks/use-panel-reveal.ts';
import { shortcutLabel } from '../shortcuts.ts';
import type { InspectorTabItem } from './inspector-tabs.ts';
import { badgeText } from './tab-badges.ts';
import { PanelPending } from './PanelPending.tsx';
import { noteTabSwitch } from './stagger.ts';
// oxlint-disable-next-line import/no-unassigned-import -- why: the dock's styles load with the lazy inspector chunk, not with every page.
import './inspector-dock.css';

const STRINGS = {
  region: 'Diagnostics',
  tabs: 'Replay diagnostics',
  expand: 'Expand panel',
  collapse: 'Collapse panel',
  nextError: (label: string) => `${label} · next error ${shortcutLabel('next-error')}`,
};

/** The fold's key, for aria-keyshortcuts (the tooltip shows the configured label). */
const FOLD_KEY = '\\';
/** Below this width the tabs show their icons alone; the name stays in a tooltip and for screen readers. */
const ICON_TABS_BELOW = 480;
const OPEN_PANEL = '.inspector-panel:not([data-ending-style]):not([hidden])';

export interface DockFold {
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}

/** False while the page transition that mounted the dock runs: panels show their pending frame until it lands. */
const DockReady = createContext(true);

/**
 * One inspector panel. Before the dock is ready, or while its code loads, it shows its pending frame: the panel's own
 * (`pending` as a node), or a PanelPending frame by name, with the panel's toolbar, header and row height. Never empty.
 */
export function DockPanel({ value, pending = value, children }: { value: string; pending?: ReactNode; children: ReactNode }) {
  const ready = use(DockReady);
  // why: a panel may bring its own pending frame (its exact loaded geometry); a name picks one of the generic frames.
  const frame = typeof pending === 'string' ? <PanelPending panel={pending} /> : pending;
  return (
    <TabsContent value={value} className="inspector-panel">
      {ready ? <Suspense fallback={frame}>{children}</Suspense> : frame}
    </TabsContent>
  );
}

function TabBadge({ item }: { item: InspectorTabItem }) {
  const text = item.badge ? badgeText(item.badge.value) : undefined;
  if (!text) return null;
  return (
    <span className="count count-pill tab-badge" data-tone={item.badge?.tone} aria-hidden="true">
      {text}
    </span>
  );
}

function TabTrigger({
  item,
  iconOnly,
  short,
  groupStart,
}: {
  item: InspectorTabItem;
  iconOnly: boolean;
  short: boolean;
  groupStart: boolean;
}) {
  const shortcut = item.shortcut ? shortcutLabel(item.shortcut) : undefined;
  const label = short && item.shortLabel ? item.shortLabel : item.label;
  return (
    <Hint
      label={item.errors ? STRINGS.nextError(item.label) : item.label}
      side="top"
      {...(shortcut ? { shortcut } : {})}
      disabled={!iconOnly && !shortcut}
    >
      <TabsTrigger
        value={item.id}
        id={`${item.id}-tab`}
        data-testid={`${item.id}-tab`}
        data-slot-item={item.slotId}
        data-group-start={groupStart || undefined}
        className="inspector-tab"
        aria-label={item.badge ? `${item.label}, ${item.badge.label}` : item.label}
      >
        {iconOnly ? (
          <>
            <item.Icon className="inspector-tab-icon" aria-hidden="true" />
            <span className="visually-hidden">{item.label}</span>
          </>
        ) : (
          label
        )}
        <TabBadge item={item} />
      </TabsTrigger>
    </Hint>
  );
}

function FoldControl({ fold, compact }: { fold: DockFold; compact: boolean }) {
  const toggle = () => fold.onCollapsedChange(!fold.collapsed);
  const label = fold.collapsed ? STRINGS.expand : STRINGS.collapse;
  if (compact)
    return (
      // why: phones fold with a 44 px end cap on the tab row, the same fold as desktop's backslash control.
      <button
        type="button"
        className="panel-expand"
        aria-expanded={!fold.collapsed}
        aria-label={label}
        aria-keyshortcuts={FOLD_KEY}
        data-testid="inspector-collapse"
        onClick={toggle}
      >
        <span className="icon-swap" data-state={fold.collapsed ? 'a' : 'b'} aria-hidden="true">
          <AnimatedIcon name="chevron-up" className="icon-a" trigger="state" play={fold.collapsed ? 'up' : false} />
          <AnimatedIcon name="chevron-down" className="icon-b" trigger="state" play={fold.collapsed ? false : 'down'} />
        </span>
      </button>
    );
  return (
    <IconButton
      className="inspector-collapse"
      label={label}
      shortcut={shortcutLabel('switch-inspector')}
      tooltipSide="top"
      tooltipAlign="end"
      aria-expanded={!fold.collapsed}
      aria-keyshortcuts={FOLD_KEY}
      onClick={toggle}
      data-testid="inspector-collapse"
    >
      {fold.collapsed ? <AnimatedIcon name="chevron-up" /> : <AnimatedIcon name="chevron-down" />}
    </IconButton>
  );
}

/**
 * The inspector dock: one flat tab row over the host's panels (`DockPanel` children), with the fold control at its
 * end. The host owns which tab is open. A tab click unfolds a folded dock; a quick run of switches swaps panels at
 * once instead of fading. `trailing` sits between the tabs and the fold (a comparison's scope switch).
 */
export function InspectorDock({
  items,
  tab,
  onTabChange,
  fold,
  compact = false,
  ready = true,
  trailing,
  children,
}: {
  items: readonly InspectorTabItem[];
  tab: string;
  onTabChange: (tab: string) => void;
  fold?: DockFold | undefined;
  /** Phones: short labels, and the fold is the row's 44 px end cap. */
  compact?: boolean;
  /** Rows may render (the page transition has landed): the open panel's rows rise in once. */
  ready?: boolean;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  const dock = useRef<HTMLElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const iconOnly = useNarrowerThan(row, ICON_TABS_BELOW);
  usePanelReveal(dock, { ready, panel: tab, skip: 'steps' });

  const select = (next: string) => {
    const section = dock.current;
    const outgoing = section?.querySelector<HTMLElement>(OPEN_PANEL);
    if (section && outgoing) {
      section.style.setProperty('--outgoing-top', `${outgoing.offsetTop}px`);
      section.style.setProperty('--outgoing-height', `${outgoing.offsetHeight}px`);
    }
    section?.toggleAttribute('data-instant-switch', noteTabSwitch());
    if (fold?.collapsed) fold.onCollapsedChange(false);
    onTabChange(next);
  };

  return (
    <Tabs
      value={tab}
      onValueChange={(next) => select(String(next))}
      className="inspector gap-0"
      data-collapsed={fold?.collapsed ? '' : undefined}
      render={<section ref={dock} aria-label={STRINGS.region} />}
    >
      <div ref={row} className="inspector-tabs" data-slot="viewer.inspector.tabs" data-icon-tabs={iconOnly || undefined}>
        <HoverGlide container={row} itemSelector=".inspector-tab" />
        <TabsList
          // why: Base UI keeps its keyboard order from first registration, so the list remounts when tabs come or go.
          key={items.map((item) => item.id).join(' ')}
          variant="line"
          activateOnFocus
          aria-label={STRINGS.tabs}
          className="inspector-tablist"
          // why: a click on the already-active tab changes no value, yet still unfolds a folded panel.
          onClick={() => {
            if (fold?.collapsed) fold.onCollapsedChange(false);
          }}
          onKeyDown={(event) => {
            // why: Base UI moves the keyboard cursor; arrows, Home and End must not also seek the replay.
            if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) event.stopPropagation();
          }}
        >
          {items.map((item, index) => (
            <TabTrigger
              key={item.id}
              item={item}
              iconOnly={iconOnly}
              short={compact}
              groupStart={index > 0 && items[index - 1]?.group !== item.group}
            />
          ))}
          <TabsIndicator className="inspector-tab-indicator" />
        </TabsList>
        {trailing}
        {fold ? <FoldControl fold={fold} compact={compact} /> : null}
      </div>
      <DockReady value={ready}>{children}</DockReady>
    </Tabs>
  );
}
