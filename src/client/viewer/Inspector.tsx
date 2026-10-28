import { AnimatedIcon } from '@/components/animated-icon.tsx';
import {
  BadgeInfoIcon,
  CircleXIcon,
  GaugeIcon,
  ChartNoAxesGanttIcon,
  GlobeIcon,
  ListOrderedIcon,
  type LucideIcon,
  PuzzleIcon,
  SquareTerminalIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import {
  memo,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type { ReplayBundle, ReplayConsoleEntry } from '../../shared/replay.ts';
import { domain } from '../format.ts';
import { usePlayer, usePlayhead } from '../player.ts';
import { countAtOrBefore, sortByAt } from '../timeline.ts';
import { type ShortcutAction, shortcutLabel } from '../shortcuts.ts';
import { useWindowedRows } from '../windowing.ts';
import { type BuiltinInspectorTab, type InspectorTab, useViewer } from './context.ts';
import { PluginContexts, PluginMount, usePluginContexts, usePluginSnapshot } from '../plugins/PluginUi.tsx';
import { usePluginContextSections } from '../plugins/PluginSlots.tsx';
import { Empty } from './Empty.tsx';
import { noteTabSwitch, queueReveal, staggerIn } from './stagger.ts';
import { StepList } from './StepRail.tsx';
import { activeStepIndex } from './Transport.tsx';
import { ContextPanel } from './ContextPanel.tsx';
import { activeFeatures, useFeatureBadges } from '../plugins/features.tsx';
import { useContextSchema } from './context-schema.ts';
import { Count, countLabel } from '@/components/count.tsx';
import { HoverGlide } from '@/components/sliding-highlight.tsx';
import { Hint, IconButton } from '@/components/icon-button.tsx';
import { Tabs, TabsContent, TabsIndicator, TabsList, TabsTrigger } from '@/components/ui/tabs.tsx';
import { readStorage, writeStorage } from '../storage.ts';
import { useFilledAfterTransition } from '../navigation.ts';
import type { EditTimeline } from '../../shared/edits.ts';
import { TrackList, SeekTime, HEADER_HEIGHT, TRACK_GAP, TRAILING_GAP } from './TrackList.tsx';
import { useRowHeight } from '../hooks/use-row-height.ts';
import { buildNetworkRows } from './network/model.ts';
import { type NetworkPeer, NetworkPanel } from './network/NetworkPanel.tsx';
import { vitalsOf } from './performance/model.ts';
import { type PerformancePeer, PerformancePanel } from './performance/PerformancePanel.tsx';
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

/** The panel's collapse shortcut. */
const BACKSLASH = '\\';

/** Tabs with a key: their tooltip shows it (single source: shortcuts.ts). */
const TAB_SHORTCUTS: Partial<Record<BuiltinInspectorTab, ShortcutAction>> = {
  console: 'console-tab',
  network: 'network-tab',
  performance: 'performance-tab',
};

const TABS: BuiltinInspectorTab[] = ['console', 'network', 'performance', 'context'];

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
  // Built-in features with a tab (comments): after the diagnostics tabs, in registration order.
  const featureTabs = activeFeatures().flatMap((feature) => (feature.tab ? [{ id: feature.id, featureTab: feature.tab }] : []));
  const featureBadges = useFeatureBadges();
  // Rows fill once the page transition has landed (navigation.ts); the tab row is there from the start.
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
  const networkTrack = useMemo(() => sortByAt(networkRows.map((row) => ({ ...row.entry, at: row.at }))), [networkRows]);
  const performanceTrack = useMemo(() => sortByAt(performanceModel.signals), [performanceModel]);
  // Once playback reaches the end every entry is in view (some trail the last DOM event). At the very start nothing
  // has happened yet, not even entries stamped 0:00.0, so the now line can rest above every row.
  const horizon = (time: number) => (time >= player.duration ? Number.POSITIVE_INFINITY : time <= 0 ? -1 : time);
  const consoleCount = usePlayhead((time) => countAtOrBefore(consoleTrack.ats, horizon(time)));
  const networkCount = usePlayhead((time) => countAtOrBefore(networkTrack.ats, horizon(time)));
  const performanceCount = usePlayhead((time) => countAtOrBefore(performanceTrack.ats, horizon(time)));
  const pluginTabs = usePluginSnapshot().tabs;
  // Each plugin gets its own context (its settings); the viewer's when there is one, else made here.
  const ownContexts = usePluginContexts(bundle, player);
  const pluginContextFor = useContext(PluginContexts) ?? ownContexts;
  const contextSections = usePluginContextSections();
  const stepTabs = mobile && bundle.steps.length > 0;
  const activeStep = usePlayhead((time) => (stepTabs ? activeStepIndex(bundle.steps, time, player.duration) : -1));
  const labels = mobile ? MOBILE_TAB_LABELS : TAB_LABELS;
  // Narrow panels (below ~480 px) show each tab as its icon, with the name in a tooltip and for screen readers.
  const tabsBar = useRef<HTMLDivElement>(null);
  const iconTabs = useNarrowerThan(tabsBar, ICON_TABS_BELOW);
  // Base UI's indicator measures the active tab during render. One element instance means it re-renders only
  // when the tab changes or a tab resizes (its own observer), not on every count tick of the playhead.
  const indicator = useMemo(() => <TabsIndicator className="inspector-tab-indicator" />, []);
  const current = stepTabs && mobile.stepsSelected ? 'steps' : tab === 'waterfall' ? 'network' : tab;
  // The chosen panel's visible rows rise in (stagger.ts): with the step rail, on one clock, when the page is revealed
  // (filled after the page transition); alone on each later tab switch. The rows' own layout effects (initial scroll,
  // divider placement) have run by now. The step list staggers itself.
  const revealed = useRef(false);
  useLayoutEffect(() => {
    const section = tabsBar.current?.parentElement;
    if (!filled || !section) return;
    const reveal = !revealed.current;
    revealed.current = true;
    if (current === 'steps' || section.hasAttribute('data-collapsed')) return;
    const panel = section.querySelector<HTMLElement>('.inspector-panel:not([data-ending-style]):not([hidden])');
    if (!panel) return;
    if (reveal) queueReveal(panel, INSPECTOR_ROWS);
    else staggerIn(panel, INSPECTOR_ROWS);
  }, [filled, current]);

  return (
    <Tabs
      value={current}
      onValueChange={(next) => {
        // The outgoing panel fades out where it stood (styles.css), or goes at once when switches come quickly.
        const section = tabsBar.current?.parentElement;
        const outgoing = section?.querySelector<HTMLElement>('.inspector-panel:not([data-ending-style]):not([hidden])');
        const rapid = noteTabSwitch();
        if (section && outgoing) {
          section.style.setProperty('--outgoing-top', `${outgoing.offsetTop}px`);
          section.style.setProperty('--outgoing-height', `${outgoing.offsetHeight}px`);
        }
        if (rapid) section?.setAttribute('data-instant-switch', '');
        else section?.removeAttribute('data-instant-switch');
        if (collapse?.collapsed) collapse.onCollapsedChange(false);
        if (next === 'steps') mobile?.onSelectSteps();
        else setTab(next as InspectorTab);
      }}
      className="inspector gap-0"
      data-collapsed={collapse?.collapsed || undefined}
      render={<section aria-label="Diagnostics" />}
    >
      <div ref={tabsBar} className="inspector-tabs" data-icon-tabs={iconTabs || undefined}>
        <HoverGlide container={tabsBar} itemSelector=".inspector-tab" />
        <TabsList
          // Remount when the Steps tab comes or goes: Base UI keeps its keyboard order from first registration.
          key={stepTabs ? 'with-steps' : 'diagnostics'}
          variant="line"
          activateOnFocus
          aria-label="Replay diagnostics"
          className="inspector-tablist"
          // The already-active tab does not change value: a click on it still unfolds a folded panel.
          onClick={() => {
            if (collapse?.collapsed) collapse.onCollapsedChange(false);
          }}
          onKeyDown={(event) => {
            // Base UI moves the keyboard cursor; keep arrows/Home/End from also seeking the replay.
            if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) event.stopPropagation();
          }}
        >
          {stepTabs ? (
            <Hint label="Steps" side="top" disabled={!iconTabs}>
              <TabsTrigger value="steps" id="steps-tab" data-testid="steps-tab" className="inspector-tab">
                <TabLabel icon={ListOrderedIcon} label="Steps" iconOnly={iconTabs} />
                <span className="count">
                  {activeStep + 1}/{bundle.steps.length}
                </span>
              </TabsTrigger>
            </Hint>
          ) : null}
          {TABS.map((value) => (
            <Hint
              key={value}
              // Console and Network also say how to jump to the next error.
              label={
                value === 'console' || value === 'network'
                  ? `${TAB_LABELS[value]} · next error ${shortcutLabel('next-error')}`
                  : TAB_LABELS[value]
              }
              side="top"
              {...(TAB_SHORTCUTS[value] ? { shortcut: shortcutLabel(TAB_SHORTCUTS[value]) } : {})}
              disabled={!iconTabs && !TAB_SHORTCUTS[value]}
            >
              <TabsTrigger
                value={value}
                id={`${value}-tab`}
                data-testid={`${value}-tab`}
                className="inspector-tab"
                aria-label={`${TAB_LABELS[value]}${
                  value === 'console'
                    ? countLabel(consoleCount, consoleTrack.entries.length, 'entry', 'entries')
                    : value === 'network'
                      ? countLabel(networkCount, networkTrack.entries.length, 'request')
                      : value === 'performance'
                        ? countLabel(performanceCount, performanceTrack.entries.length, 'signal')
                        : ''
                }`}
              >
                <TabLabel icon={TAB_ICONS[value]} label={labels[value]} iconOnly={iconTabs} />
                {value === 'console' ? (
                  <Count value={consoleCount} total={consoleTrack.entries.length} hideZero />
                ) : value === 'network' ? (
                  <Count value={networkCount} total={networkTrack.entries.length} hideZero />
                ) : value === 'performance' ? (
                  <Count value={performanceCount} total={performanceTrack.entries.length} hideZero />
                ) : null}
              </TabsTrigger>
            </Hint>
          ))}
          {featureTabs.map(({ id, featureTab }) => (
            <Hint
              key={id}
              label={featureTab.label}
              side="top"
              {...(featureTab.shortcut ? { shortcut: shortcutLabel(featureTab.shortcut) } : {})}
              disabled={!iconTabs && !featureTab.shortcut}
            >
              <TabsTrigger
                value={id}
                id={`${id}-tab`}
                data-testid={`${id}-tab`}
                className="inspector-tab"
                aria-label={`${featureTab.label}${featureBadges[id] ? ` (${featureBadges[id]})` : ''}`}
              >
                <TabLabel icon={featureTab.Icon} label={featureTab.label} iconOnly={iconTabs} />
                {featureBadges[id] ? <span className="count">{featureBadges[id]}</span> : null}
              </TabsTrigger>
            </Hint>
          ))}
          {pluginTabs.map((pluginTab) => (
            <TabsTrigger
              key={pluginTab.key}
              value={pluginTab.key}
              id={`${pluginTab.key}-tab`}
              data-testid={`${pluginTab.key}-tab`}
              className="inspector-tab"
            >
              <TabLabel icon={PuzzleIcon} label={pluginTab.definition.label} iconOnly={iconTabs} />
            </TabsTrigger>
          ))}
          {indicator}
        </TabsList>
        {compare?.scope}
        {collapse && mobile ? (
          // Phones: the same fold as desktop's backslash control, as a 44 px end cap on the tab row. Folded, the player
          // and transport take the space; a tab tap (or this chevron) brings the panel back.
          <button
            type="button"
            className="panel-expand"
            aria-expanded={!collapse.collapsed}
            aria-label={collapse.collapsed ? 'Expand panel' : 'Collapse panel'}
            aria-keyshortcuts={BACKSLASH}
            data-testid="inspector-collapse"
            onClick={() => collapse.onCollapsedChange(!collapse.collapsed)}
          >
            <span className="icon-swap" data-state={collapse.collapsed ? 'a' : 'b'} aria-hidden="true">
              <AnimatedIcon name="chevron-up" className="icon-a" trigger="state" play={collapse.collapsed ? 'up' : false} />
              <AnimatedIcon name="chevron-down" className="icon-b" trigger="state" play={collapse.collapsed ? false : 'down'} />
            </span>
          </button>
        ) : collapse ? (
          <IconButton
            className="inspector-collapse"
            label={collapse.collapsed ? 'Expand panel' : 'Collapse panel'}
            shortcut={shortcutLabel('switch-inspector')}
            tooltipSide="top"
            tooltipAlign="end"
            aria-expanded={!collapse.collapsed}
            aria-keyshortcuts={BACKSLASH}
            onClick={() => collapse.onCollapsedChange(!collapse.collapsed)}
            data-testid="inspector-collapse"
          >
            {collapse.collapsed ? <AnimatedIcon name="chevron-up" /> : <AnimatedIcon name="chevron-down" />}
          </IconButton>
        ) : null}
      </div>

      {stepTabs ? (
        <TabsContent value="steps" className="inspector-panel">
          {filled ? <StepList /> : null}
        </TabsContent>
      ) : null}

      <TabsContent value="console" className="inspector-panel">
        {filled ? <ConsolePanel entries={consoleTrack.entries} reached={consoleCount} human={human} /> : null}
      </TabsContent>
      <TabsContent value="network" className="inspector-panel">
        {filled ? (
          <NetworkPanel
            rows={networkRows}
            steps={bundle.steps}
            duration={player.duration}
            human={human}
            selected={expandedRequest}
            onSelect={setExpandedRequest}
            peers={networkPeers}
          />
        ) : null}
      </TabsContent>
      <TabsContent value="performance" className="inspector-panel">
        {filled ? (
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
        ) : null}
      </TabsContent>
      <TabsContent value="context" className="inspector-panel">
        {filled ? <ContextPanel bundle={bundle} schema={contextSchema} sections={contextSections} /> : null}
      </TabsContent>
      {featureTabs.map(({ id, featureTab }) => (
        <TabsContent key={id} value={id} className="inspector-panel">
          <featureTab.Panel />
        </TabsContent>
      ))}
      {pluginTabs.map((pluginTab) => (
        <TabsContent key={pluginTab.key} value={pluginTab.key} className="inspector-panel">
          {filled ? (
            <PluginMount
              render={pluginTab.definition.render}
              context={pluginContextFor(pluginTab.plugin)}
              label={pluginTab.definition.label}
              testId={`${pluginTab.key}-panel`}
            />
          ) : null}
        </TabsContent>
      ))}
    </Tabs>
  );
});

const ICON_TABS_BELOW = 480;
/** The rows of the inspector's panels that stagger in (never the windowing spacers). */
const INSPECTOR_ROWS = 'tbody > tr:not(.spacer-row):not(.gap-row), .ctx-summary, .ctx-heading, .ctx-source, .ctx-row, .empty';

const TAB_ICONS: Record<BuiltinInspectorTab, LucideIcon> = {
  console: SquareTerminalIcon,
  network: GlobeIcon,
  waterfall: ChartNoAxesGanttIcon,
  performance: GaugeIcon,
  context: BadgeInfoIcon,
};

function TabLabel({ icon: Icon, label, iconOnly }: { icon: LucideIcon; label: string; iconOnly: boolean }) {
  return iconOnly ? (
    <>
      <Icon className="inspector-tab-icon" aria-hidden="true" />
      <span className="visually-hidden">{label}</span>
    </>
  ) : (
    <>{label}</>
  );
}

/** True while the element is narrower than `width`; re-renders only when it crosses the threshold. */
function useNarrowerThan(element: RefObject<HTMLElement | null>, width: number) {
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    const target = element.current;
    if (!target) return;
    const observer = new ResizeObserver(([entry]) => setNarrow((entry?.contentRect.width ?? width) < width));
    observer.observe(target);
    return () => observer.disconnect();
  }, [element, width]);
  return narrow;
}

const TAB_LABELS: Record<BuiltinInspectorTab, string> = {
  console: 'Console',
  network: 'Network',
  waterfall: 'Waterfall',
  performance: 'Performance',
  context: 'Context',
};

const MOBILE_TAB_LABELS: Record<BuiltinInspectorTab, string> = { ...TAB_LABELS, performance: 'Perf' };

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
