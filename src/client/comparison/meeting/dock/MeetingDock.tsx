import { type CSSProperties, useRef, useState } from 'react';

import { Splitter, readSplitterSize } from '@/components/ui/splitter.tsx';
import { TabsContent } from '@/components/ui/tabs.tsx';
import { EmptyState } from '@/components/ui/empty-state.tsx';

import type { EvidenceRef } from '../../../../shared/diagnostics/types.ts';
import { PlayerContext } from '../../../player.ts';
import { activeFeatures, FeatureProviders, useFeatureBadges } from '../../../plugins/features.tsx';
import { usePluginContextSections } from '../../../plugins/PluginSlots.tsx';
import { ContextPanel } from '../../../viewer/ContextPanel.tsx';
import { useContextSchema } from '../../../viewer/context-schema.ts';
import { IssuesTab, NetworkTab, PerformanceTab } from '../../../viewer/inspector-panels.tsx';
import { InspectorDock } from '../../../viewer/InspectorDock.tsx';
import {
  type InspectorRowRef,
  type InspectorScope,
  type InspectorSource,
  InspectorScopeProvider,
} from '../../../viewer/inspector-scope.ts';
import type { MeetingClock } from '../clock.ts';
import { DockSources } from './DockSources.tsx';
import { meetingInspectorClock, scopePlayer } from './scope-player.ts';
import './dock.css';

export const DOCK_STRINGS = {
  resize: 'Resize diagnostics panel',
  console: 'Console opens in the viewer for now',
  consoleBody: 'Use “Open in viewer” on the tile to read its console at this moment.',
} as const;

const STORAGE_KEY = 'inspector:meeting';
const MIN_HEIGHT = 160;
const DEFAULT_HEIGHT = 280;
const maxHeight = () => Math.max(MIN_HEIGHT, Math.round((typeof innerHeight === 'number' ? innerHeight : 800) * 0.6));
const noStartAction = () => {};

/** A tile the dock can show, with its colour index on the shared scrubber. */
export interface DockSource extends InspectorSource {
  colourIndex: number;
  letter: string;
}

/**
 * The viewer's inspector dock under the meeting stage (spec: .review-artifacts/design-hillclimb/spec-inspector-scope.md):
 * the same tab row and panels, scoped to one recording at a time (the spotlight, else the last tile clicked) on the
 * shared clock. Opening a row seeks every tile there and focuses its recording; resizing and folding match the viewer.
 */
export function MeetingDock({
  sources,
  focusedId,
  clock,
  mobile,
  onFocus,
  onHover,
}: {
  sources: readonly DockSource[];
  focusedId: string;
  clock: MeetingClock;
  mobile: boolean;
  onFocus(id: string): void;
  onHover(ref: InspectorRowRef | undefined): void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [inspectorClock] = useState(() => meetingInspectorClock(clock));
  const [tab, setTab] = useState('issues');
  const [collapsed, setCollapsed] = useState(mobile);
  const [height, setHeight] = useState(() => readSplitterSize(STORAGE_KEY, DEFAULT_HEIGHT, MIN_HEIGHT, maxHeight()));
  const [expandedRequest, setExpandedRequest] = useState<string>();
  const [performanceSelection, setPerformanceSelection] = useState<string>();
  const contextSchema = useContextSchema();
  const contextSections = usePluginContextSections();
  const featureTabs = activeFeatures().flatMap((feature) => (feature.tab ? [{ id: feature.id, featureTab: feature.tab }] : []));

  const focused = sources.find((source) => source.id === focusedId) ?? sources[0];
  const [bridge, setBridge] = useState<{ key: string; player: ReturnType<typeof scopePlayer> }>();
  const bridgeKey = focused ? `${focused.id}:${focused.offset}` : '';
  let player = bridge?.player;
  if (focused && bridge?.key !== bridgeKey) {
    player = scopePlayer({ ...inspectorClock, pause: clock.pause }, focused, () => onFocus(focused.id));
    setBridge({ key: bridgeKey, player });
  }
  if (!focused || !player) return null;

  const scope: InspectorScope = {
    sources,
    focusedId: focused.id,
    mode: 'single',
    clock: inspectorClock,
    onFocus,
    onHover,
  };
  const human = focused.bundle.meta.source === 'human';
  const openEvidence = (ref: EvidenceRef) => {
    if (ref.kind === 'request') {
      setExpandedRequest(ref.id);
      setTab('network');
    } else if (ref.kind === 'performance') {
      setPerformanceSelection(`performance-${ref.index}`);
      setTab('performance');
    } else if (ref.kind === 'console') setTab('console');
  };
  const fold = { collapsed, onCollapsedChange: setCollapsed };

  return (
    <div
      ref={host}
      className="mt-dock"
      data-collapsed={collapsed || undefined}
      data-mobile={mobile || undefined}
      style={{ '--mt-dock-height': `${height}px` } as CSSProperties}
    >
      {mobile ? null : (
        <Splitter
          orientation="horizontal"
          side="end"
          value={height}
          min={MIN_HEIGHT}
          max={maxHeight()}
          defaultValue={DEFAULT_HEIGHT}
          snapPoints={[DEFAULT_HEIGHT]}
          collapsible
          collapsed={collapsed}
          onChange={setHeight}
          onCollapsedChange={setCollapsed}
          onPreview={(size, folded) => host.current?.style.setProperty('--mt-dock-height', folded ? 'var(--mt-dock-folded)' : `${size}px`)}
          storageKey={STORAGE_KEY}
          settleTarget={host}
          label={DOCK_STRINGS.resize}
          className="mt-dock-split"
          testId="meeting-dock-resizer"
        />
      )}
      {mobile ? null : <DockSources sources={sources} focusedId={focused.id} onFocus={onFocus} />}
      <PlayerContext.Provider value={player}>
        <FeatureProviders
          key={focused.id}
          replayId={focused.id}
          timeline={focused.timeline}
          openPanel={setTab}
          registerStartAction={noStartAction}
        >
          <InspectorScopeProvider value={scope}>
            <DockTabs tab={tab} onTabChange={setTab} compact={mobile} fold={fold} featureTabs={featureTabs}>
              <TabsContent id="mt-issues-panel" value="issues" className="inspector-panel">
                <IssuesTab sourceBundle={focused.bundle} timeline={focused.timeline} human={human} onOpen={openEvidence} />
              </TabsContent>
              <TabsContent id="mt-console-panel" value="console" className="inspector-panel">
                <EmptyState icon="inbox" title={DOCK_STRINGS.console} body={DOCK_STRINGS.consoleBody} />
              </TabsContent>
              <TabsContent id="mt-network-panel" value="network" className="inspector-panel">
                <NetworkTab
                  sourceBundle={focused.bundle}
                  timeline={focused.timeline}
                  human={human}
                  selected={expandedRequest}
                  onSelect={setExpandedRequest}
                />
              </TabsContent>
              <TabsContent id="mt-performance-panel" value="performance" className="inspector-panel">
                <PerformanceTab
                  sourceBundle={focused.bundle}
                  timeline={focused.timeline}
                  selected={performanceSelection}
                  onSelect={setPerformanceSelection}
                  onOpen={openEvidence}
                />
              </TabsContent>
              <TabsContent id="mt-context-panel" value="context" className="inspector-panel">
                <ContextPanel bundle={focused.bundle} schema={contextSchema} sections={contextSections} />
              </TabsContent>
              {featureTabs.map(({ id, featureTab }) => (
                <TabsContent key={id} id={`mt-${id}-panel`} value={id} className="inspector-panel">
                  <featureTab.Panel />
                </TabsContent>
              ))}
            </DockTabs>
          </InspectorScopeProvider>
        </FeatureProviders>
      </PlayerContext.Provider>
    </div>
  );
}

/** The dock's tab row; feature badges (comment counts) need the feature providers above, so they are read here. */
function DockTabs(props: Omit<Parameters<typeof InspectorDock>[0], 'rail' | 'featureBadges'>) {
  const featureBadges = useFeatureBadges();
  return <InspectorDock {...props} rail featureBadges={featureBadges} />;
}
