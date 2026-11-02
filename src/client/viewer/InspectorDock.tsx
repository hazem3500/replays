import type { LucideIcon } from 'lucide-react';
import { type ReactNode, useDeferredValue, useRef } from 'react';

import { Tabs } from '@/components/ui/tabs.tsx';

import { usePanelReveal } from '../hooks/use-panel-reveal.ts';
import { shortcutLabel, type ShortcutAction } from '../shortcuts.ts';
import { InspectorCollapseButton, InspectorNavigation } from './InspectorNavigation.tsx';
import { noteTabSwitch } from './stagger.ts';
import { useInspectorTabItems } from './use-inspector-tabs.tsx';

const STRINGS = {
  label: 'Diagnostics',
  tabs: 'Replay diagnostics',
};

/** The fold's key, for aria-keyshortcuts (the tooltip shows the configured label). */
const FOLD_KEY = '\\';

export interface DockFold {
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}

/**
 * The inspector dock: one tab row (from the InspectorScope the host provides) over the host's panels, with the fold
 * control. Shared by the single-replay viewer and the meeting stage; the host owns which tab is open and passes its
 * panels as `TabsContent` children. A tab click unfolds a folded dock; a quick run of switches swaps panels instantly.
 */
export function InspectorDock({
  tab,
  onTabChange,
  rail,
  compact = false,
  fold,
  ready = true,
  featureTabs,
  featureBadges,
  pluginTabs,
  children,
}: {
  tab: string;
  onTabChange: (tab: string) => void;
  /** The steps rail is on screen, so there is no Steps tab. */
  rail: boolean;
  /** Phones: the fold control is the row's 44 px end cap. */
  compact?: boolean;
  fold?: DockFold;
  /** Rows have filled (after the page transition): the open panel's rows rise in once. */
  ready?: boolean;
  featureTabs?: readonly { id: string; featureTab: { label: string; Icon: LucideIcon; shortcut?: ShortcutAction } }[];
  featureBadges?: Record<string, number | undefined>;
  pluginTabs?: readonly { key: string; definition: { label: string } }[];
  children: ReactNode;
}) {
  const dock = useRef<HTMLElement>(null);
  const items = useInspectorTabItems({
    rail,
    ...(featureTabs ? { featureTabs } : {}),
    ...(featureBadges ? { featureBadges } : {}),
    ...(pluginTabs ? { pluginTabs } : {}),
  });
  // why: the tab row and the host's state follow a click at once; the panel it opens mounts in a deferred render behind
  // them, so the underline's glide is not blocked by the panel's work.
  const panel = useDeferredValue(tab);
  usePanelReveal(dock, { ready, panel, skip: 'steps' });

  const select = (next: string) => {
    const section = dock.current;
    const outgoing = section?.querySelector<HTMLElement>('.inspector-panel:not([data-ending-style]):not([hidden])');
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
      value={panel}
      onValueChange={select}
      className="inspector gap-0"
      data-collapsed={fold?.collapsed || undefined}
      render={<section ref={dock} aria-label={STRINGS.label} />}
    >
      <div className="inspector-tabs">
        <InspectorNavigation
          items={items}
          activePanel={tab}
          onPanelChange={select}
          ariaLabel={STRINGS.tabs}
          trailing={
            fold ? (
              <InspectorCollapseButton
                collapsed={fold.collapsed}
                onCollapsedChange={fold.onCollapsedChange}
                shortcut={{ label: shortcutLabel('switch-inspector'), keys: FOLD_KEY }}
                compact={compact}
              />
            ) : null
          }
        />
      </div>
      {children}
    </Tabs>
  );
}
