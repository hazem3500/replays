import { CircleXIcon, TriangleAlertIcon } from 'lucide-react';
import { memo, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject, useContext, useMemo, useRef } from 'react';

import type { ReplayBundle, ReplayConsoleEntry } from '../../shared/replay.ts';
import { domain } from '../format.ts';
import { usePlayer, usePlayhead } from '../player.ts';
import { countAtOrBefore, sortByAt } from '../timeline.ts';
import { useWindowedRows } from '../windowing.ts';
import { type InspectorTab, useViewer } from './context.ts';
import { PluginContexts, PluginMount, usePluginContexts, usePluginSnapshot } from '../plugins/PluginUi.tsx';
import { usePluginContextSections } from '../plugins/PluginSlots.tsx';
import { Empty } from './Empty.tsx';
import { StepList } from './StepRail.tsx';
import { ContextPanel } from './ContextPanel.tsx';
import { activeFeatures, useFeatureBadges } from '../plugins/features.tsx';
import { useContextSchema } from './context-schema.ts';
import { readStorage, writeStorage } from '../storage.ts';
import { useFilledAfterTransition } from '../navigation.ts';
import type { EditTimeline } from '../../shared/edits.ts';
import { TrackList, SeekTime, HEADER_HEIGHT, TRACK_GAP, TRAILING_GAP } from './TrackList.tsx';
import { useRowHeight } from '../hooks/use-row-height.ts';
import { buildNetworkRows, networkBadge } from './network/model.ts';
import { type NetworkPeer, NetworkPanel, NetworkPending } from './network/NetworkPanel.tsx';
import { buildMoments, performanceBadge, vitalsOf } from './performance/model.ts';
import { type PerformancePeer, PerformancePanel, PerformancePending } from './performance/PerformancePanel.tsx';
import { resolveSlot } from '../plugins/registry.ts';
import { DockPanel, InspectorDock } from './InspectorDock.tsx';
import { inspectorTabItems } from './inspector-tabs.ts';
import { consoleBadge } from './tab-badges.ts';
export { edgeVelocity } from './TrackList.tsx';
import { buildPerformance } from './performance.ts';

export const INSPECTOR_HEIGHT_KEY = 'replays-inspector-height';
export const DEFAULT_INSPECTOR_HEIGHT = 260;
export const MIN_INSPECTOR_HEIGHT = 120;

function maxInspectorHeight() {
  return Math.max(MIN_INSPECTOR_HEIGHT, Math.round(window.innerHeight * 0.6));
}

export function clampInspectorHeight(height: number) {
  return Math.round(Math.min(Math.max(height, MIN_INSPECTOR_HEIGHT), maxInspectorHeight()));
}

export function initialInspectorHeight() {
  const saved = Number(readStorage(INSPECTOR_HEIGHT_KEY));
  return Number.isFinite(saved) && saved > 0 ? clampInspectorHeight(saved) : DEFAULT_INSPECTOR_HEIGHT;
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

/** Another recording being compared (compare mode): its letter, title and bundle as it plays. */
export interface InspectorPeer {
  id: string;
  letter: string;
  label: string;
  bundle: ReplayBundle;
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
  compare,
}: {
  bundle: ReplayBundle;
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
  const { setTab, setExpandedRequest } = useViewer();
  const features = activeFeatures().flatMap((feature) => (feature.tab ? [{ id: feature.id, featureTab: feature.tab }] : []));
  const featureBadges = useFeatureBadges();
  // Rows fill once the page transition has landed (navigation.ts); until then each panel shows its pending frame.
  const filled = useFilledAfterTransition();
  const contextSchema = useContextSchema();
  const human = bundle.meta.source === 'human';
  const consoleTrack = useMemo(() => sortByAt(bundle.console), [bundle]);

  const performanceModel = useMemo(() => buildPerformance(sourceBundle, timeline), [sourceBundle, timeline]);
  const networkRows = useMemo(() => buildNetworkRows(sourceBundle, timeline), [sourceBundle, timeline]);
  const peers = compare?.peers ?? [];
  const networkPeers: NetworkPeer[] = peers.map((peer) => ({
    id: peer.id,
    letter: peer.letter,
    label: peer.label,
    rows: buildNetworkRows(peer.bundle),
  }));
  const performancePeers: PerformancePeer[] = peers.map((peer) => ({ id: peer.id, letter: peer.letter, vitals: vitalsOf(peer.bundle) }));
  // Once playback reaches the end every entry is in view (some trail the last DOM event). At the very start nothing
  // has happened yet, not even entries stamped 0:00.0, so the now line can rest above every row.
  const horizon = (time: number) => (time >= player.duration ? Number.POSITIVE_INFINITY : time <= 0 ? -1 : time);
  const consoleCount = usePlayhead((time) => countAtOrBefore(consoleTrack.ats, horizon(time)));
  const pluginTabs = usePluginSnapshot().tabs;
  // Each plugin gets its own context (its settings); the viewer's when there is one, else made here.
  const ownContexts = usePluginContexts(bundle, player);
  const pluginContextFor = useContext(PluginContexts) ?? ownContexts;
  const contextSections = usePluginContextSections();
  const items = inspectorTabItems(
    {
      stepCount: bundle.steps.length,
      rail: !mobile,
      badges: {
        console: consoleBadge(consoleTrack.entries),
        network: networkBadge(networkRows),
        performance: performanceBadge(buildMoments(performanceModel.signals)),
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
  const stepsTab = items.some((item) => item.id === 'steps');
  const current = stepsTab && mobile?.stepsSelected ? 'steps' : tab === 'waterfall' ? 'network' : tab;

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
        <ConsolePanel entries={consoleTrack.entries} reached={consoleCount} human={human} />
      </DockPanel>
      <DockPanel value="network" pending={NetworkPending}>
        <NetworkPanel
          rows={networkRows}
          steps={bundle.steps}
          duration={player.duration}
          human={human}
          selected={expandedRequest}
          onSelect={setExpandedRequest}
          peers={networkPeers}
        />
      </DockPanel>
      <DockPanel value="performance" pending={PerformancePending}>
        <PerformancePanel
          model={performanceModel}
          requests={networkRows}
          steps={bundle.steps}
          duration={player.duration}
          peers={performancePeers}
          extra={compare?.performance}
          onOpenRequest={(id) => {
            setExpandedRequest(id);
            setTab('network');
          }}
        />
      </DockPanel>
      <DockPanel value="context">
        <ContextPanel bundle={bundle} schema={contextSchema} sections={contextSections} />
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

/**
 * The fixed gap before the first row (TRACK_GAP: none, so rows meet the header) and after the last one
 * (TRAILING_GAP: room for the now divider's grip to rest below the last row, fully visible).
 */
function GapRow({ columns, trailing = false }: { columns: number; trailing?: boolean }) {
  const height = trailing ? TRAILING_GAP : TRACK_GAP;
  if (height <= 0) return null;
  return (
    <tr className="gap-row" aria-hidden="true" style={{ height }}>
      <td colSpan={columns} />
    </tr>
  );
}

function SpacerRow({ height, columns }: { height: number; columns: number }) {
  if (height <= 0) return null;
  return (
    <tr className="spacer-row" aria-hidden="true" style={{ height }}>
      <td colSpan={columns} />
    </tr>
  );
}

/** Shown only when a track has nothing in it at all; entries the playhead has not reached are listed, faded. */
function TrackEmpty({ track, human }: { track: 'console' | 'network'; human: boolean }) {
  const noun = track === 'console' ? 'Console' : 'Network';
  if (human)
    return (
      <Empty title={`${noun} wasn’t recorded`}>This recording was imported from rrweb, so console and network weren’t captured.</Empty>
    );
  return track === 'console' ? (
    <Empty title="No console output was recorded">Nothing was logged during this session.</Empty>
  ) : (
    <Empty title="No requests were recorded">No network requests were captured during this session.</Empty>
  );
}

const ConsolePanel = memo(function ConsolePanel({
  entries,
  reached,
  human,
}: {
  entries: ReplayConsoleEntry[];
  reached: number;
  human: boolean;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLTableSectionElement>(null);
  const total = entries.length;
  const ats = useMemo(() => entries.map((entry) => entry.at), [entries]);
  const rowHeight = useRowHeight(body, 'tr.console-row', total > 0);
  const { start, end, padTop, padBottom } = useWindowedRows(scroller, { count: total, rowHeight, headerHeight: HEADER_HEIGHT + TRACK_GAP });
  return (
    <TrackList testId="console-list" reached={reached} total={total} rowHeight={rowHeight} ats={ats} scroller={scroller}>
      {total === 0 ? (
        <TrackEmpty track="console" human={human} />
      ) : (
        <table className="diagnostic-table console-table" aria-rowcount={total + 1}>
          <thead>
            <tr aria-rowindex={1}>
              <th>Time</th>
              <th>Message</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody ref={body}>
            <GapRow columns={3} />
            <SpacerRow height={padTop} columns={3} />
            {entries.slice(start, end).map((entry, offset) => {
              const index = start + offset;
              const future = index >= reached;
              return (
                <tr className={`console-row ${entry.level}`} key={index} aria-rowindex={index + 2} data-future={future || undefined}>
                  <td>
                    <SeekTime at={entry.at} future={future} />
                  </td>
                  <td>
                    <span className="console-message">
                      <LevelIcon level={entry.level} />
                      <code title={entry.message}>{entry.message}</code>
                    </span>
                  </td>
                  <td className="source" title={entry.url}>
                    {entry.url ? domain(entry.url) : 'Page'}
                  </td>
                </tr>
              );
            })}
            <SpacerRow height={padBottom} columns={3} />
            <GapRow columns={3} trailing />
          </tbody>
        </table>
      )}
    </TrackList>
  );
});

/**
 * Only warnings and errors get a small glyph before the message (amber, red: inside the row); log, info and debug
 * get none, so plain rows have no icon gutter. The level is always in the accessible text and the glyph's title.
 */
function LevelIcon({ level }: { level: ReplayConsoleEntry['level'] }) {
  const Icon = level === 'error' ? CircleXIcon : level === 'warn' ? TriangleAlertIcon : undefined;
  const name = level === 'warn' ? 'Warning' : level[0]!.toUpperCase() + level.slice(1);
  return Icon ? (
    <span className={`level-icon ${level}`} role="img" aria-label={name} title={name}>
      <Icon aria-hidden="true" />
    </span>
  ) : (
    <span className="visually-hidden">{name}: </span>
  );
}
