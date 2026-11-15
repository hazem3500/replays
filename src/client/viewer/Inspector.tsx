import { useResizerFeedback } from '../hooks/use-resizer-feedback.ts';
import { memo, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject, useContext, useMemo, useRef } from 'react';

import type { ReplayBundle } from '../../shared/replay.ts';
import { usePlayer } from '../player.ts';
import { sortByAt } from '../timeline.ts';
import { type InspectorTab, useViewer } from './context.ts';
import { PluginContexts, PluginMount, usePluginContexts, usePluginSnapshot } from '../plugins/PluginUi.tsx';
import { usePluginContextSections } from '../plugins/PluginSlots.tsx';
import { StepList } from './StepRail.tsx';
import { ContextPanel } from './ContextPanel.tsx';
import { activeFeatures, useFeatureBadges } from '../plugins/features.tsx';
import { useContextSchema } from './context-schema.ts';
import { readStorage, writeStorage } from '../storage.ts';
import { useFilledAfterTransition } from '../hooks/use-filled-after-transition.ts';
import type { EditTimeline } from '../../shared/edits.ts';
import { ConsoleCapture } from './console/ConsoleCapture.tsx';
import { buildNetworkRows, markFocus, networkBadge } from './network/model.ts';
import { type NetworkPeer, NetworkPanel } from './network/NetworkPanel.tsx';
import { buildMoments, performanceBadge, vitalsOf } from './performance/model.ts';
import { type PerformancePeer, PerformancePanel } from './performance/PerformancePanel.tsx';
import { resolveSlot } from '../plugins/registry.ts';
import { DockPanel, InspectorDock } from './InspectorDock.tsx';
import { inspectorTabItems } from './inspector-tabs.ts';
import { consoleBadge, withFocus } from './tab-badges.ts';
import { MIN_INSPECTOR_HEIGHT, maxInspectorHeight } from './inspector-size.ts';
import { availableTab, orderTabs } from '../views/resolve.ts';
import { STANDARD_VIEW, viewSettingKey } from '../views/settings.ts';
export { edgeVelocity } from './TrackList.tsx';
import { buildPerformance } from './performance.ts';

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
  storageKey: viewSettingKey(STANDARD_VIEW, 'dock-height'),
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
  const ref = useResizerFeedback('horizontal');
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
      ref={ref}
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
    >
      <span className="inspector-resizer-line" data-resizer-line="" aria-hidden="true" />
      <span className="inspector-resizer-grip" data-resizer-grip="" aria-hidden="true" />
    </div>
  );
}

/** Another recording being compared (compare mode): its short name, colour (1 to 9), title and bundle as it plays. */
export interface InspectorPeer {
  id: string;
  name: string;
  colour: number;
  label: string;
  bundle: ReplayBundle;
}

export interface MobilePanel {
  /** The Steps tab is showing (it sits in front of the diagnostics tabs on phones). */
  stepsSelected: boolean;
  onSelectSteps: () => void;
}

const NO_ORDER: readonly string[] = [];

/** How many of `items` a panel's focus test matches; 0 when the run marks nothing there. */
function focusCount<T>(items: readonly T[], test: ((item: T) => unknown) | undefined) {
  return test ? items.filter((item) => test(item)).length : 0;
}

export const Inspector = memo(function Inspector({
  bundle,
  sourceBundle = bundle,
  timeline,
  tab,
  expandedRequest,
  mobile,
  collapse,
  compare,
  runSummary,
}: {
  bundle: ReplayBundle;
  /** The suite run's summary, shown in the Context tab. */
  runSummary?: string | undefined;
  /** Original captured data: measured spans must be mapped, including starts inside cuts. */
  sourceBundle?: ReplayBundle;
  timeline?: EditTimeline | undefined;
  tab: InspectorTab;
  expandedRequest: string | undefined;
  mobile?: MobilePanel;
  /** The panel folds to its tab row (desktop and phones alike); any tab click unfolds it. */
  collapse?: { collapsed: boolean; onCollapsedChange: (collapsed: boolean) => void };
  /**
   * Comparing recordings (compare/CompareViewer.tsx): `scope` ends the tab row with which recording the panels
   * describe; `peers` are the other recordings as they play, so Network says how the same call went there and
   * Performance gives each vital's difference; `performance` sits under the vitals.
   */
  compare?: { scope?: ReactNode; performance?: ReactNode; peers?: readonly InspectorPeer[] | undefined } | undefined;
}) {
  const player = usePlayer();
  const { setTab, setExpandedRequest, tabOrder: order = NO_ORDER, focus } = useViewer();
  const features = activeFeatures().flatMap((feature) => (feature.tab ? [{ id: feature.id, featureTab: feature.tab }] : []));
  const featureBadges = useFeatureBadges();
  // Rows fill once the page transition has landed (hooks/use-filled-after-transition.ts); until then each panel shows its pending frame.
  const filled = useFilledAfterTransition();
  const contextSchema = useContextSchema();
  const human = bundle.meta.source === 'human';
  const consoleTrack = useMemo(() => sortByAt(bundle.console), [bundle]);

  const performanceModel = useMemo(() => buildPerformance(sourceBundle, timeline), [sourceBundle, timeline]);
  const moments = useMemo(() => buildMoments(performanceModel.signals, performanceModel.why), [performanceModel]);
  const networkRows = useMemo(() => markFocus(buildNetworkRows(sourceBundle, timeline), focus), [sourceBundle, timeline, focus]);
  const peers = compare?.peers ?? [];
  const networkPeers: NetworkPeer[] = peers.map((peer) => ({
    id: peer.id,
    name: peer.name,
    colour: peer.colour,
    label: peer.label,
    rows: buildNetworkRows(peer.bundle),
  }));
  const performancePeers: PerformancePeer[] = peers.map((peer) => ({
    id: peer.id,
    name: peer.name,
    colour: peer.colour,
    vitals: vitalsOf(peer.bundle),
  }));
  const pluginTabs = usePluginSnapshot().tabs;
  // Each plugin gets its own context (its settings); the viewer's when there is one, else made here.
  const ownContexts = usePluginContexts(bundle, player);
  const pluginContextFor = useContext(PluginContexts) ?? ownContexts;
  const contextSections = usePluginContextSections();
  const resolved = inspectorTabItems(
    {
      stepCount: bundle.steps.length,
      rail: !mobile,
      badges: {
        console: withFocus(
          consoleBadge(consoleTrack.entries),
          focusCount(consoleTrack.entries, focus?.has.console ? focus.console : undefined),
        ),
        network: networkBadge(networkRows),
        performance: withFocus(performanceBadge(moments), focusCount(moments, focus?.has.performance ? focus.performance : undefined)),
      },
      features: features.map(({ id, featureTab }) => ({
        id,
        label: featureTab.label,
        Icon: featureTab.Icon,
        ...(featureTab.shortcut ? { shortcut: featureTab.shortcut } : {}),
        ...(featureBadges[id] ? { badge: { value: featureBadges[id], label: String(featureBadges[id]) } } : {}),
      })),
      plugins: pluginTabs.map((pluginTab) => ({ key: pluginTab.key, label: pluginTab.definition.label })),
    },
    resolveSlot,
  );
  const items = orderTabs(resolved, order);
  const stepsTab = items.some((item) => item.id === 'steps');
  const current = stepsTab && mobile?.stepsSelected ? 'steps' : availableTab(items, tab === 'waterfall' ? 'network' : tab, order);

  return (
    <InspectorDock
      items={items}
      tab={current}
      onTabChange={(next) => {
        if (next === 'steps') mobile?.onSelectSteps();
        else setTab(next as InspectorTab);
      }}
      fold={collapse}
      compact={Boolean(mobile)}
      ready={filled}
      trailing={compare?.scope}
    >
      {stepsTab ? (
        <DockPanel value="steps">
          <StepList />
        </DockPanel>
      ) : null}
      <DockPanel value="console">
        <ConsoleCapture entries={consoleTrack.entries} human={human} meta={sourceBundle.meta} />
      </DockPanel>
      <DockPanel value="network">
        <NetworkPanel
          rows={networkRows}
          steps={bundle.steps}
          duration={player.duration}
          human={human}
          selected={expandedRequest}
          onSelect={setExpandedRequest}
          peers={networkPeers}
          captured={sourceBundle.meta.captured}
        />
      </DockPanel>
      <DockPanel value="performance">
        <PerformancePanel
          model={performanceModel}
          requests={networkRows}
          steps={bundle.steps}
          duration={player.duration}
          peers={performancePeers}
          meta={bundle.meta}
          extra={compare?.performance}
          onOpenRequest={(id) => {
            setExpandedRequest(id);
            setTab('network');
          }}
        />
      </DockPanel>
      <DockPanel value="context">
        <ContextPanel bundle={bundle} schema={contextSchema} sections={contextSections} summary={runSummary} />
      </DockPanel>
      {features.map(({ id, featureTab }) => (
        <DockPanel key={id} value={id}>
          <featureTab.Panel />
        </DockPanel>
      ))}
      {pluginTabs.map((pluginTab) => (
        <DockPanel key={pluginTab.key} value={pluginTab.key} pending="plugin">
          <PluginMount
            render={pluginTab.definition.render}
            context={pluginContextFor(pluginTab.plugin)}
            label={pluginTab.definition.label}
            testId={`${pluginTab.key}-panel`}
          />
        </DockPanel>
      ))}
    </InspectorDock>
  );
});
