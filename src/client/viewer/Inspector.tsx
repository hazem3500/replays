import { memo, type PointerEvent as ReactPointerEvent, type RefObject, useContext, useMemo, useRef, useState } from 'react';

import type { ReplayBundle } from '../../shared/replay.ts';
import { usePlayer, usePlayhead } from '../player.ts';
import { countAtOrBefore, sortByAt } from '../timeline.ts';
import { type InspectorTab, useViewer } from './context.ts';
import { PluginContexts, PluginMount, usePluginContexts, usePluginSnapshot } from '../plugins/PluginUi.tsx';
import { usePluginContextSections } from '../plugins/PluginSlots.tsx';
import { StepList } from './StepRail.tsx';
import { ContextPanel } from './ContextPanel.tsx';
import { activeFeatures, useFeatureBadges } from '../plugins/features.tsx';
import { useContextSchema } from './context-schema.ts';
import { TabsContent } from '@/components/ui/tabs.tsx';
import { readStorage, writeStorage } from '../storage.ts';
import { useFilledAfterTransition } from '../navigation.ts';
import type { EditTimeline } from '../../shared/edits.ts';
import { ConsolePanel } from './console/ConsolePanel.tsx';
export { edgeVelocity } from './TrackList.tsx';
import { IssuesTab, NetworkTab, PerformanceTab } from './inspector-panels.tsx';
import { PanelPending } from './PanelPending.tsx';
import type { EvidenceRef } from '../../shared/diagnostics/types.ts';
import { InspectorDock } from './InspectorDock.tsx';
import { InspectorScopeProvider, singleScope, usePlayerClock } from './inspector-scope.ts';
import { defaultInspectorHeight, maxInspectorHeight, MIN_INSPECTOR_HEIGHT } from './inspector-size.ts';

export const INSPECTOR_HEIGHT_KEY = 'replays-inspector-height';
export { MIN_INSPECTOR_HEIGHT } from './inspector-size.ts';

export function clampInspectorHeight(height: number) {
  return Math.round(Math.min(Math.max(height, MIN_INSPECTOR_HEIGHT), maxInspectorHeight()));
}

export function initialInspectorHeight() {
  const saved = Number(readStorage(INSPECTOR_HEIGHT_KEY));
  return Number.isFinite(saved) && saved > 0 ? clampInspectorHeight(saved) : defaultInspectorHeight();
}

/** What a bottom-panel splitter resizes: the diagnostics panel by default, or another panel (the editor's dock). */
export interface PanelSize {
  /** localStorage key the committed height is kept under. */
  storageKey: string;
  /** CSS custom property on `shell` that sizes the panel's grid row while dragging. */
  variable: string;
  min: number;
  max: () => number;
  label: string;
}

const INSPECTOR_SIZE: PanelSize = {
  storageKey: INSPECTOR_HEIGHT_KEY,
  variable: '--inspector-height',
  min: MIN_INSPECTOR_HEIGHT,
  max: maxInspectorHeight,
  label: 'Resize diagnostics panel',
};

/** A height clamped to `size`'s limits, whole px. */
export function clampPanelHeight(height: number, size: PanelSize) {
  return Math.round(Math.min(Math.max(height, size.min), Math.max(size.min, size.max())));
}

/** The saved height for `size`, else `fallback`, clamped. */
export function initialPanelHeight(size: PanelSize, fallback: number) {
  const saved = Number(readStorage(size.storageKey));
  return clampPanelHeight(Number.isFinite(saved) && saved > 0 ? saved : fallback, size);
}

/**
 * The split-view grabber on a bottom panel's top edge (the diagnostics panel's, and the editor's timeline dock):
 * drag it, or select it and use ↑/↓ (Home/End: smallest/largest). The height is kept per panel (`size`).
 */
export function InspectorResizer({
  shell,
  height,
  onCommit,
  size = INSPECTOR_SIZE,
}: {
  shell: RefObject<HTMLElement | null>;
  height: number;
  onCommit: (height: number) => void;
  size?: PanelSize;
}) {
  const drag = useRef<{ startY: number; startHeight: number; current: number } | undefined>(undefined);
  const commit = (next: number) => {
    const value = clampPanelHeight(next, size);
    writeStorage(size.storageKey, String(value));
    onCommit(value);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current.current = clampPanelHeight(drag.current.startHeight + drag.current.startY - event.clientY, size);
    shell.current?.style.setProperty(size.variable, `${drag.current.current}px`);
  };
  const onPointerEnd = () => {
    if (!drag.current) return;
    commit(drag.current.current);
    drag.current = undefined;
  };
  return (
    // A tabbable separator is the ARIA pattern for a keyboard-resizable splitter.
    <div
      className="inspector-resizer"
      role="separator"
      aria-orientation="horizontal"
      aria-label={size.label}
      aria-valuemin={size.min}
      aria-valuemax={size.max()}
      aria-valuenow={height}
      tabIndex={0}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { startY: event.clientY, startHeight: height, current: height };
      }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onKeyDown={(event) => {
        const delta = event.key === 'ArrowUp' ? 24 : event.key === 'ArrowDown' ? -24 : 0;
        if (event.key === 'Home') commit(size.min);
        else if (event.key === 'End') commit(size.max());
        else if (delta) commit(height + delta);
        else return;
        event.preventDefault();
        event.stopPropagation();
      }}
    />
  );
}

export interface MobilePanel {
  /** The Steps tab is showing (it sits in front of the diagnostics tabs on phones). */
  stepsSelected: boolean;
  onSelectSteps: () => void;
}

export const Inspector = memo(function Inspector({
  bundle,
  sourceBundle = bundle,
  timeline,
  tab,
  expandedRequest,
  mobile,
  collapse,
}: {
  bundle: ReplayBundle;
  /** Original captured data: measured spans must be mapped, including starts inside cuts. */
  sourceBundle?: ReplayBundle;
  timeline?: EditTimeline | undefined;
  /** `steps` is the Steps tab where there is no rail (phones); elsewhere it falls back to Console. */
  tab: InspectorTab | 'steps';
  expandedRequest: string | undefined;
  mobile?: MobilePanel;
  /** The panel folds to its tab row (desktop and phones alike); any tab click unfolds it. */
  collapse?: { collapsed: boolean; onCollapsedChange: (collapsed: boolean) => void };
}) {
  const player = usePlayer();
  const { setTab, setExpandedRequest } = useViewer();
  // Built-in features with a tab (comments): after the diagnostics tabs, in registration order.
  const featureTabs = activeFeatures().flatMap((feature) => (feature.tab ? [{ id: feature.id, featureTab: feature.tab }] : []));
  const featureBadges = useFeatureBadges();
  // Rows fill once the page transition has landed (navigation.ts); the tab row is there from the start.
  const filled = useFilledAfterTransition();
  const contextSchema = useContextSchema();
  const human = bundle.meta.source === 'human';
  const consoleTrack = useMemo(() => sortByAt(bundle.console), [bundle]);

  // why: the performance drill-down's selection lives here so Issues can open an event in it.
  const [performanceSelection, setPerformanceSelection] = useState<string | undefined>(undefined);
  // Once playback reaches the end every entry is in view (some trail the last DOM event). At the very start nothing
  // has happened yet, not even entries stamped 0:00.0, so the now line can rest above every row.
  const horizon = (time: number) => (time >= player.duration ? Number.POSITIVE_INFINITY : time <= 0 ? -1 : time);
  const consoleCount = usePlayhead((time) => countAtOrBefore(consoleTrack.ats, horizon(time)));
  const pluginTabs = usePluginSnapshot().tabs;
  // Each plugin gets its own context (its settings); the viewer's when there is one, else made here.
  const ownContexts = usePluginContexts(bundle, player);
  const pluginContextFor = useContext(PluginContexts) ?? ownContexts;
  const contextSections = usePluginContextSections();
  // why: steps have one home, the rail on desktop and the first tab where there is no rail (phones).
  const stepTabs = bundle.steps.length > 0 && Boolean(mobile);
  const current =
    stepTabs && (tab === 'steps' || mobile?.stepsSelected) ? 'steps' : tab === 'waterfall' ? 'network' : tab === 'steps' ? 'console' : tab;
  const clock = usePlayerClock();

  const selectPanel = (next: string) => {
    if (next === 'steps') {
      setTab('steps');
      mobile?.onSelectSteps();
    } else {
      setTab(next as InspectorTab);
    }
  };

  const openEvidence = (ref: EvidenceRef) => {
    if (ref.kind === 'request') {
      setExpandedRequest(ref.id);
      selectPanel('network');
    } else if (ref.kind === 'performance') {
      setPerformanceSelection(`performance-${ref.index}`);
      selectPanel('performance');
    } else if (ref.kind === 'console') selectPanel('console');
  };

  return (
    <InspectorScopeProvider value={singleScope(sourceBundle, timeline, clock)}>
      <InspectorDock
        tab={current}
        onTabChange={selectPanel}
        rail={!mobile}
        compact={Boolean(mobile)}
        {...(collapse ? { fold: collapse } : {})}
        ready={filled}
        featureTabs={featureTabs}
        featureBadges={featureBadges}
        pluginTabs={pluginTabs}
      >
        <TabsContent id="issues-panel" aria-labelledby="issues-tab" value="issues" className="inspector-panel">
          {filled ? (
            <IssuesTab sourceBundle={sourceBundle} timeline={timeline} human={human} onOpen={openEvidence} />
          ) : (
            <PanelPending panel="issues" />
          )}
        </TabsContent>
        {stepTabs ? (
          <TabsContent id="steps-panel" aria-labelledby="steps-tab" value="steps" className="inspector-panel">
            {filled ? <StepList /> : <PanelPending panel="steps" />}
          </TabsContent>
        ) : null}

        <TabsContent id="console-panel" aria-labelledby="console-tab" value="console" className="inspector-panel">
          {filled ? <ConsolePanel entries={consoleTrack.entries} reached={consoleCount} human={human} /> : <PanelPending panel="console" />}
        </TabsContent>
        <TabsContent id="network-panel" aria-labelledby="network-tab" value="network" className="inspector-panel">
          {filled ? (
            <NetworkTab
              sourceBundle={sourceBundle}
              timeline={timeline}
              human={human}
              selected={expandedRequest}
              onSelect={setExpandedRequest}
            />
          ) : (
            <PanelPending panel="network" />
          )}
        </TabsContent>
        <TabsContent id="performance-panel" aria-labelledby="performance-tab" value="performance" className="inspector-panel">
          {filled ? (
            <PerformanceTab
              sourceBundle={sourceBundle}
              timeline={timeline}
              selected={performanceSelection}
              onSelect={setPerformanceSelection}
              onOpen={openEvidence}
            />
          ) : (
            <PanelPending panel="performance" />
          )}
        </TabsContent>
        <TabsContent id="context-panel" aria-labelledby="context-tab" value="context" className="inspector-panel">
          {filled ? <ContextPanel bundle={bundle} schema={contextSchema} sections={contextSections} /> : <PanelPending panel="context" />}
        </TabsContent>
        {featureTabs.map(({ id, featureTab }) => (
          <TabsContent key={id} id={`${id}-panel`} aria-labelledby={`${id}-tab`} value={id} className="inspector-panel">
            <featureTab.Panel />
          </TabsContent>
        ))}
        {pluginTabs.map((pluginTab) => (
          <TabsContent
            key={pluginTab.key}
            id={`${pluginTab.key}-panel`}
            aria-labelledby={`${pluginTab.key}-tab`}
            value={pluginTab.key}
            className="inspector-panel"
          >
            {filled ? (
              <PluginMount
                render={pluginTab.definition.render}
                context={pluginContextFor(pluginTab.plugin)}
                label={pluginTab.definition.label}
                testId={`${pluginTab.key}-panel`}
              />
            ) : (
              <PanelPending panel={pluginTab.key} />
            )}
          </TabsContent>
        ))}
      </InspectorDock>
    </InspectorScopeProvider>
  );
});
