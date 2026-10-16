import { AnimatedIcon } from '@/components/animated-icon.tsx';
import {
  ArrowDownToLineIcon,
  ArrowUpToLineIcon,
  BadgeInfoIcon,
  ChevronRightIcon,
  GripHorizontalIcon,
  CircleXIcon,
  GaugeIcon,
  GlobeIcon,
  ListOrderedIcon,
  type LucideIcon,
  PuzzleIcon,
  SquareTerminalIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import {
  Fragment,
  memo,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  formatClock,
  type ReplayBundle,
  type ReplayConsoleEntry,
  type ReplayNetworkEntry,
  type ReplayPerformanceEntry,
} from '../../shared/replay.ts';
import { domain, entrySize, formatBytes, hasNoResponse, isFailedRequest } from '../format.ts';
import { usePlayer, usePlayerState, usePlayhead } from '../player.ts';
import { countAtOrBefore, sortByAt } from '../timeline.ts';
import { createSpring } from '../spring.ts';
import { type ShortcutAction, shortcutLabel } from '../shortcuts.ts';
import { useWindowedRows } from '../windowing.ts';
import { type BuiltinInspectorTab, type InspectorTab, useViewer } from './context.ts';
import { PluginMount, usePluginContext, usePluginSnapshot } from '../plugins/PluginUi.tsx';
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
import { CopyButton } from '@/components/copy-button.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Tabs, TabsContent, TabsIndicator, TabsList, TabsTrigger } from '@/components/ui/tabs.tsx';
import { readStorage, writeStorage } from '../storage.ts';
import { useFilledAfterTransition } from '../navigation.ts';

export const INSPECTOR_HEIGHT_KEY = 'replays-inspector-height';
export const DEFAULT_INSPECTOR_HEIGHT = 260;
export const MIN_INSPECTOR_HEIGHT = 120;
const NO_RESPONSE = 'No response recorded: a redirect hop, or still in flight when capture stopped';

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

export interface MobilePanel {
  /** The Steps tab is showing (it sits in front of the diagnostics tabs on phones). */
  stepsSelected: boolean;
  onSelectSteps: () => void;
}

export const Inspector = memo(function Inspector({
  bundle,
  tab,
  expandedRequest,
  mobile,
  collapse,
}: {
  bundle: ReplayBundle;
  tab: InspectorTab;
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
  const replayHost = useMemo(() => hostOf(bundle.meta.url), [bundle.meta.url]);
  const consoleTrack = useMemo(() => sortByAt(bundle.console), [bundle]);
  const networkTrack = useMemo(() => sortByAt(bundle.network), [bundle]);
  const performanceTrack = useMemo(() => sortByAt(bundle.performance?.entries ?? []), [bundle]);
  // Once playback reaches the end every entry is in view (some trail the last DOM event). At the very start nothing
  // has happened yet, not even entries stamped 0:00.0, so the now line can rest above every row.
  const horizon = (time: number) => (time >= player.duration ? Number.POSITIVE_INFINITY : time <= 0 ? -1 : time);
  const consoleCount = usePlayhead((time) => countAtOrBefore(consoleTrack.ats, horizon(time)));
  const networkCount = usePlayhead((time) => countAtOrBefore(networkTrack.ats, horizon(time)));
  const performanceCount = usePlayhead((time) => countAtOrBefore(performanceTrack.ats, horizon(time)));
  const pluginTabs = usePluginSnapshot().tabs;
  const pluginContext = usePluginContext(bundle, player);
  const stepTabs = mobile && bundle.steps.length > 0;
  const activeStep = usePlayhead((time) => (stepTabs ? activeStepIndex(bundle.steps, time, player.duration) : -1));
  const labels = mobile ? MOBILE_TAB_LABELS : TAB_LABELS;
  // Narrow panels (below ~480 px) show each tab as its icon, with the name in a tooltip and for screen readers.
  const tabsBar = useRef<HTMLDivElement>(null);
  const iconTabs = useNarrowerThan(tabsBar, ICON_TABS_BELOW);
  // Base UI's indicator measures the active tab during render. One element instance means it re-renders only
  // when the tab changes or a tab resizes (its own observer), not on every count tick of the playhead.
  const indicator = useMemo(() => <TabsIndicator className="inspector-tab-indicator" />, []);
  const current = stepTabs && mobile.stepsSelected ? 'steps' : tab;
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
            entries={networkTrack.entries}
            reached={networkCount}
            human={human}
            host={replayHost}
            expanded={expandedRequest}
            onSwitch={setExpandedRequest}
          />
        ) : null}
      </TabsContent>
      <TabsContent value="performance" className="inspector-panel">
        {filled ? (
          <PerformancePanel track={bundle.performance} entries={performanceTrack.entries} reached={performanceCount} human={human} />
        ) : null}
      </TabsContent>
      <TabsContent value="context" className="inspector-panel">
        {filled ? <ContextPanel bundle={bundle} schema={contextSchema} /> : null}
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
              context={pluginContext}
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
  performance: 'Performance',
  context: 'Context',
};

const MOBILE_TAB_LABELS: Record<BuiltinInspectorTab, string> = { ...TAB_LABELS, performance: 'Perf' };

/** Measures the rendered height of a data row (fallback until mounted), re-measuring as the body resizes. */
function useRowHeight(body: RefObject<HTMLTableSectionElement | null>, selector: string, mounted: boolean, fallback = 31) {
  const [height, setHeight] = useState(fallback);
  useLayoutEffect(() => {
    const element = body.current;
    if (!element) return;
    let watched: HTMLElement | null = null;
    const observer = new ResizeObserver(() => {
      const row = element.querySelector<HTMLElement>(selector);
      // Watch the measured row itself too: a font swap changes its height without resizing the body much.
      if (row && row !== watched) {
        watched = row;
        observer.observe(row);
      }
      const measured = row?.getBoundingClientRect().height ?? 0;
      // Any real change counts: twelve rows at 31.6 vs 32 px already put the now divider 5 px off at the end.
      if (measured > 0) setHeight((current) => (Math.abs(measured - current) > 0.05 ? measured : current));
    });
    observer.observe(element);
    return () => observer.disconnect();
    // `mounted` re-runs the effect when the table body first appears.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [body, selector, mounted]);
  return height;
}

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

const HEADER_HEIGHT = 28;

function prefersReducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
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

/** How long after a wheel, touch or key in a list the follow mode keeps its hands off the scroll position. */
const USER_SCROLL_GRACE_MS = 1500;

/**
 * The scrolling frame shared by Console, Network and Performance. Every entry is listed; the ones after the
 * playhead are faded by their rows (data-future). A "now" divider sits between the last reached and the first
 * upcoming row, as an overlay at a computed offset (never a row, so windowing maths stay simple). While
 * following, playback and seeks keep the divider in view near the bottom; scrolling away stops that and shows
 * "Back to now". Nothing here runs per frame: the divider only moves when the reached count changes.
 */
function TrackList({
  testId,
  reached,
  total,
  rowHeight,
  extraIndex = -1,
  extraHeight = 0,
  ats,
  scroller,
  children,
}: {
  testId: string;
  reached: number;
  total: number;
  rowHeight: number;
  extraIndex?: number;
  extraHeight?: number;
  /** Entry times, sorted: the divider snaps the playhead to them while dragged. */
  ats: readonly number[];
  scroller: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  const player = usePlayer();
  const { status } = usePlayerState();
  const [following, setFollowing] = useState(true);
  const [recall, setRecall] = useState(0);
  // Reading mode: a text selection in the panel or a scroll while paused (and, while paused, an expanded
  // request) means someone is reading: no auto-follow and no edge tint until playback resumes or Back to now.
  const [readingState, setReading] = useState(false);
  // An expanded request holds the list where it is, even while playing: someone is reading its detail.
  // "Back to now" overrides an open request's hold until another request opens.
  const [detailRelease, setDetailRelease] = useState<number | undefined>(undefined);
  const holdForDetail = extraIndex >= 0 && detailRelease !== extraIndex;
  const reading = holdForDetail || (status !== 'playing' && readingState);
  const [edge, setEdge] = useState<'top' | 'bottom'>();
  const statusRef = useRef(status);
  // performance.now() of the user's last wheel, touch, press or key in the list (never, to start with).
  const userAt = useRef(Number.NEGATIVE_INFINITY);
  // The scrollTop this list last scrolled itself to: a scroll event landing there is ours, not the user's.
  const ours = useRef(-1);
  // Playback resuming ends reading mode.
  useLayoutEffect(
    () =>
      player.subscribeState(() => {
        const next = player.getState().status;
        statusRef.current = next;
        if (next === 'playing') setReading(false);
      }),
    [player],
  );
  const dividerTop = nowOffset(reached, total, rowHeight, extraIndex, extraHeight);
  // Between entries the divider always shows; at either end (no entries on one side) only while the pointer is
  // over the panel (data-now-end + CSS), and never as an edge tint.
  // A drag that reaches either end keeps the divider (it is what is being dragged) until release.
  const [dragActive, setDragActive] = useState(false);
  const midway = (reached > 0 && reached < total) || dragActive;
  // A list whose rows all fit needs no divider: the faded upcoming rows already show where now is. It stays mounted
  // (follow logic unchanged) and fades out; re-checked when the list or its content resizes (panel height, tab
  // switch, rows arriving, an expanded request).
  // Until measured (a new tab, a hidden panel) the divider counts as not needed and shows nothing. Showing or hiding
  // it is instant, except when the list's own viewport is resized across the threshold (dragging the panel's
  // edge): only that fades (`animate`, for one transition). Content changes and a tab coming into view jump.
  // A list of one or two entries needs no divider: the faded upcoming rows already say where now is. From three
  // rows on it shows, scrolling or not. Decided from the row count alone, before paint, so a tab switch never
  // flashes it.
  const fit = { fits: total <= MAX_ROWS_WITHOUT_DIVIDER };
  // At either end the line is hidden until the pointer (or a finger) comes within NEAR_EDGE px of where it rests.
  const [near, setNear] = useState(false);
  const checkNear = (event: ReactPointerEvent<HTMLElement>) => {
    const line = event.currentTarget.querySelector<HTMLElement>('.now-divider');
    if (!line) return;
    const next = Math.abs(event.clientY - line.getBoundingClientRect().top) <= NEAR_EDGE;
    if (next !== near) setNear(next);
  };
  const dividerRef = useRef(dividerTop);
  useLayoutEffect(() => {
    dividerRef.current = dividerTop;
  }, [dividerTop]);

  // A seek (step click, error jump, time click) brings the list back to now.
  useLayoutEffect(
    () =>
      player.subscribeSeek(() => {
        // An explicit seek is a request to go somewhere: it also ends reading mode (a scroll while paused).
        setReading(false);
        setFollowing(true);
        setRecall((value) => value + 1);
      }),
    [player],
  );

  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const touched = () => {
      userAt.current = performance.now();
    };
    const onScroll = () => {
      if (ours.current >= 0 && Math.abs(element.scrollTop - ours.current) < 1) {
        ours.current = -1;
        return;
      }
      ours.current = -1;
      if (performance.now() - userAt.current > USER_SCROLL_GRACE_MS) return;
      if (statusRef.current !== 'playing') setReading(true);
      const top = dividerRef.current;
      const inView = top >= element.scrollTop + HEADER_HEIGHT && top <= element.scrollTop + element.clientHeight;
      setFollowing(inView);
    };
    element.addEventListener('wheel', touched, { passive: true });
    element.addEventListener('touchstart', touched, { passive: true });
    element.addEventListener('pointerdown', touched);
    element.addEventListener('keydown', touched);
    element.addEventListener('scroll', onScroll, { passive: true });
    const onSelection = () => {
      const selection = document.getSelection();
      if (selection && !selection.isCollapsed && selection.anchorNode && element.contains(selection.anchorNode)) setReading(true);
    };
    document.addEventListener('selectionchange', onSelection);
    // A list that was hidden (another tab) or resized re-checks where now is once it has a size.
    let lastHeight = element.clientHeight;
    const observer = new ResizeObserver(() => {
      if (element.clientHeight === lastHeight) return;
      lastHeight = element.clientHeight;
      setRecall((value) => value + 1);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      document.removeEventListener('selectionchange', onSelection);
      element.removeEventListener('wheel', touched);
      element.removeEventListener('touchstart', touched);
      element.removeEventListener('pointerdown', touched);
      element.removeEventListener('keydown', touched);
      element.removeEventListener('scroll', onScroll);
    };
  }, [scroller]);

  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element || !following || reading || element.clientHeight === 0) return;
    const sinceUser = performance.now() - userAt.current;
    if (sinceUser < USER_SCROLL_GRACE_MS) {
      // Hands off while the user is scrolling; look again once the grace period is over.
      const retry = window.setTimeout(() => setRecall((value) => value + 1), USER_SCROLL_GRACE_MS - sinceUser + 20);
      return () => window.clearTimeout(retry);
    }
    const top = dividerTop;
    if (top >= element.scrollTop + HEADER_HEIGHT + 8 && top <= element.scrollTop + element.clientHeight - 8) return;
    const target = Math.max(0, Math.round(top - element.clientHeight * 0.75));
    if (target === element.scrollTop) return;
    scrollListTo(element, target);
    ours.current = element.scrollTop;
    // `recall` re-runs this after a seek or "Back to now" even when the divider did not move.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [dividerTop, following, reading, recall, scroller]);

  return (
    <div
      className="track-panel"
      data-now-edge={midway ? edge : undefined}
      data-now-end={total > 0 && !midway ? '' : undefined}
      data-fits={fit.fits && !dragActive ? '' : undefined}
      data-reading={reading || undefined}
      data-playing={status === 'playing' || undefined}
      data-now-near={(total > 0 && !midway && near) || undefined}
      onPointerMove={checkNear}
      onPointerDown={checkNear}
      onPointerLeave={() => setNear(false)}
      onPointerUp={(event) => {
        if (event.pointerType !== 'mouse') setNear(false);
      }}
    >
      <div ref={scroller} data-testid={testId} className="table-scroll track-scroll">
        {children}
        {total > 0 ? (
          <NowDivider
            top={dividerTop}
            reached={reached}
            ats={ats}
            rowHeight={rowHeight}
            extraIndex={extraIndex}
            extraHeight={extraHeight}
            onInteract={() => {
              userAt.current = performance.now();
            }}
            onEdge={setEdge}
            onDragChange={setDragActive}
            onFollow={() => {
              userAt.current = Number.NEGATIVE_INFINITY;
              setReading(false);
              setFollowing(true);
              setRecall((value) => value + 1);
            }}
          />
        ) : null}
      </div>
      {/* Only when it would scroll somewhere meaningful: mid-list, with now out of view. */}
      {(following && !reading) || !(reached > 0 && reached < total && edge) ? null : (
        <Button
          variant="outline"
          size="sm"
          className="back-to-now"
          onClick={() => {
            userAt.current = Number.NEGATIVE_INFINITY;
            if (extraIndex >= 0) setDetailRelease(extraIndex);
            setReading(false);
            setFollowing(true);
            setRecall((value) => value + 1);
          }}
        >
          {/* The arrow points to where now is: up when it is above the visible rows, down when below. */}
          {edge === 'top' ? <ArrowUpToLineIcon aria-hidden="true" /> : <ArrowDownToLineIcon aria-hidden="true" />}
          Back to now
        </Button>
      )}
    </div>
  );
}

/** Rows start this far below the sticky header (and a matching gap follows the last row). Zero: the first row meets the header, so its highlight touches it. */
const TRACK_GAP = 0;
/** Lists this short show no now divider (TrackList). */
const MAX_ROWS_WITHOUT_DIVIDER = 2;
const TRAILING_GAP = 12;
/** A jump (seek, drag, a tab shown) moves the divider at once; its fit fade comes from styles.css only while resizing. */
const JUMP_TRANSITION = 'none';
/** At either end of a list the hidden now divider shows when the pointer is this close (px) to where it rests. */
const NEAR_EDGE = 32;
/** How long an expanded request takes to glide up under the header. */
const EXPAND_SCROLL_MS = 260;

/** Where "now" falls in the scroll content: in the leading gap before any entry, between rows, or in the trailing gap. */
function nowOffset(reached: number, total: number, rowHeight: number, extraIndex: number, extraHeight: number) {
  const rows = (count: number) => count * rowHeight + (extraIndex >= 0 && extraIndex < count ? extraHeight : 0);
  // At the very start the line rests just under the header's hairline (shown only while the pointer is over the panel).
  if (reached <= 0) return HEADER_HEIGHT + Math.max(1, TRACK_GAP / 2);
  if (reached >= total) return HEADER_HEIGHT + TRACK_GAP + rows(total) + TRACK_GAP / 2;
  return HEADER_HEIGHT + TRACK_GAP + rows(reached);
}

/**
 * Where to seek to land on an entry: its own time, except an entry stamped 0:00.0, which is landed on 1 ms in (the
 * very start is before every entry, so seeking there would leave it upcoming). The clock still reads 0:00.0.
 */
function seekPastStart(at: number) {
  return Math.max(at, 1);
}

function scrollListTo(element: HTMLElement, top: number) {
  element.scrollTop = top;
}

/** The current frame time (ms), for drag maths outside rAF callbacks. */
function frameTime() {
  return performance.now();
}

/** Puts the now line at `y` in its list's content. */
function placeLine(element: HTMLElement, y: number) {
  element.style.transform = `translateY(${y.toFixed(1)}px)`;
}
/** Moves of more than this many rows (a seek, a step jump) are instant; smaller ones glide while playing. */
const GLIDE_MAX_ROWS = 3;
/** Hover intent: the pointer rests this long in the line's band before the line and grip come up. */
const HOVER_REVEAL_MS = 250;
/** The grip's keyboard x (the Time column's gutter) and its width. */
const GRIP_REST_X = 6;
const GRIP_WIDTH = 28;
/** While dragging the divider within this many pixels of the list's top or bottom, the list scrolls. */
const DRAG_EDGE = 48;
/** Top auto-scroll speed while dragging the now divider into an edge zone, px/s (up to 3× beyond the panel). */
const EDGE_MAX_SPEED = 2400;
/** How quickly the auto-scroll velocity follows its target (time constant, ms): no jumps entering or leaving. */
const EDGE_SMOOTH_MS = 90;
/** After a release mid-scroll, the list coasts to a stop over this long. */
const EDGE_COAST_MS = 200;

/** After a release mid-scroll the list coasts to a stop (ease-out); the playhead stays where it was released. */
function coast(list: HTMLElement, velocity: number) {
  if (!velocity || prefersReducedMotion()) return;
  const start = performance.now();
  let last = start;
  let position = list.scrollTop;
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / EDGE_COAST_MS);
    const v = velocity * (1 - t) ** 2;
    position += (v * Math.min(64, now - last)) / 1000;
    last = now;
    list.scrollTop = position;
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/**
 * Auto-scroll speed (px/s) for a drag `depth` px into an edge zone of `zone` px: ease-in-quad up to the top speed
 * at the edge, then growing up to 3× as the pointer goes further past the panel (long lists).
 */
export function edgeVelocity(depth: number, zone = DRAG_EDGE, max = EDGE_MAX_SPEED) {
  if (depth <= 0) return 0;
  const inside = Math.min(depth / zone, 1);
  const beyond = Math.min(Math.max(depth - zone, 0) / (zone * 2), 1);
  return max * inside * inside * (1 + 2 * beyond);
}

/**
 * "Now": a 1.5 px accent line on the boundary between the last reached and the first upcoming row, fading
 * out to the right. It glides (transform, 150 ms) when playback crosses a row or three and jumps on seeks,
 * scrubs and scrolls; scrolled away it pins to the edge with a chevron. Its grip (in the Time column's gutter,
 * shown on hover and keyboard navigation) is a slider: drag the line to scrub, snapping the playhead to entry times (the list
 * scrolls near its edges), or use ↑/↓/Home/End.
 */
function NowDivider({
  top,
  reached,
  ats,
  rowHeight,
  extraIndex,
  extraHeight,
  onInteract,
  onEdge,
  onFollow,
  onDragChange,
}: {
  top: number;
  reached: number;
  ats: readonly number[];
  rowHeight: number;
  extraIndex: number;
  extraHeight: number;
  onInteract: () => void;
  /** Scrolled out of view, the divider draws nothing in the rows: the panel tints that edge instead. */
  onEdge: (edge: 'top' | 'bottom' | undefined) => void;
  /** Keyboard moves and a finished drag hand the list back to follow mode. */
  onFollow: () => void;
  onDragChange: (dragging: boolean) => void;
}) {
  const player = usePlayer();
  const { status } = usePlayerState();
  const line = useRef<HTMLDivElement>(null);
  const previous = useRef({ shown: -1, reached, viewTop: 0, viewHeight: 0 });
  const drag = useRef<
    | {
        pointerId: number;
        clientX: number;
        clientY: number;
        target: number;
        frame: number;
        /** The playhead when the drag began: Escape goes back there. */
        startTime: number;
        /** Auto-scroll: current velocity (px/s), the list's fractional scroll position, the last frame's time. */
        velocity: number;
        scroll: number;
        last: number;
        alt: boolean;
        shift: boolean;
      }
    | undefined
  >(undefined);
  // Pointer modality: a press on the grip's row must not move the grip to the keyboard spot.
  const pointerPress = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [view, setView] = useState({ top: 0, height: 0 });
  const total = ats.length;
  // Weight: the grip trails the pointer, and while dragging the line settles onto each snapped boundary,
  // on one shared spring tuning (src/client/spring.ts). Created once; they write transforms directly.
  const springs = useRef<{ x: ReturnType<typeof createSpring>; y: ReturnType<typeof createSpring> } | undefined>(undefined);
  useLayoutEffect(() => {
    const element = line.current;
    if (!element) return;
    const created = {
      x: createSpring({ onUpdate: (x) => element.style.setProperty('--grip-x', `${x.toFixed(1)}px`) }),
      y: createSpring({
        onUpdate: (y) => placeLine(element, y),
      }),
    };
    springs.current = created;
    // Hidden, the grip waits at the right end, clear of the Time column's seek buttons.
    created.x.set(Math.max(8, element.getBoundingClientRect().width - GRIP_WIDTH - 8), true);
    return () => {
      created.x.stop();
      created.y.stop();
    };
  }, []);

  // The scroll container is this line's parent (read in an effect: a parent's ref is attached after its
  // children's layout effects run).
  useLayoutEffect(() => {
    const element = line.current?.parentElement;
    if (!element) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      setView((current) =>
        current.top === element.scrollTop && current.height === element.clientHeight
          ? current
          : { top: element.scrollTop, height: element.clientHeight },
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    read();
    element.addEventListener('scroll', schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener('scroll', schedule);
      observer.disconnect();
    };
  }, []);
  // The line keeps clear of the header's hairline and the bottom edge, never landing inside the first (or last) row;
  // its grip stays centred on it, straddling the hairline at the very top (it draws above the sticky header).
  const min = view.top + HEADER_HEIGHT + 1;
  const max = view.height > 0 ? view.top + view.height - 1 : Number.POSITIVE_INFINITY;
  const shown = Math.min(Math.max(top, min), max);
  // Pinned means scrolled out of view (not merely held clear of the header at the very start or end).
  const pinned = dragging
    ? undefined
    : view.height > 0 && top > view.top + view.height
      ? 'bottom'
      : top < view.top + HEADER_HEIGHT
        ? 'top'
        : undefined;
  useLayoutEffect(() => onEdge(pinned), [onEdge, pinned]);
  // Unmounted (the playhead left the middle of the list): no edge tint either.
  useLayoutEffect(() => () => onEdge(undefined), [onEdge]);

  // Imperative, so the glide decision sees the previous position without re-rendering. Skipped while
  // dragging: the drag's spring owns the line then.
  useLayoutEffect(() => {
    const element = line.current;
    const last = previous.current;
    if (!element || drag.current) return;
    springs.current?.y.stop();
    const steps = Math.abs(reached - last.reached);
    const glide =
      last.shown >= 0 &&
      status === 'playing' &&
      steps > 0 &&
      steps <= GLIDE_MAX_ROWS &&
      view.top === last.viewTop &&
      view.height === last.viewHeight &&
      !pinned;
    element.style.transition = glide ? '' : JUMP_TRANSITION;
    placeLine(element, shown);
    springs.current?.y.set(shown, true);
    previous.current = { shown, reached, viewTop: view.top, viewHeight: view.height };
    // `dragging` re-places the line where it belongs when a drag ends.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [pinned, reached, shown, status, view.top, view.height, dragging]);

  /** The playhead for "now after `count` entries": the start, an entry's time, or the end. */
  const timeFor = (count: number) =>
    count <= 0 ? 0 : count >= total ? Math.max(ats[total - 1] ?? 0, player.duration) : seekPastStart(ats[count - 1]!);
  const seekTo = (count: number) => {
    const next = Math.min(total, Math.max(0, count));
    player.seek(timeFor(next));
    return next;
  };
  /** Which boundary a content y falls on (rounded to the nearest), allowing for an expanded request. */
  const countAt = (y: number) => {
    let offset = y - HEADER_HEIGHT - TRACK_GAP;
    if (extraIndex >= 0 && offset > (extraIndex + 1) * rowHeight) offset -= Math.min(extraHeight, offset - (extraIndex + 1) * rowHeight);
    return Math.min(total, Math.max(0, Math.round(offset / Math.max(1, rowHeight))));
  };
  /**
   * The grip appears centred under the pointer where it first meets the line and stays anchored there (no
   * horizontal following) until it has fully hidden; the next hover anchors anew. It scales in on a heavy
   * spring and fades out in place (CSS, 140 ms).
   */
  const anchored = useRef(false);
  const hideTimer = useRef(0);
  const showGrip = (x: number | 'keyboard') => {
    const element = line.current;
    if (!element) return;
    window.clearTimeout(hideTimer.current);
    if (!anchored.current) {
      const width = element.getBoundingClientRect().width;
      const left = x === 'keyboard' ? GRIP_REST_X : x - element.getBoundingClientRect().left - GRIP_WIDTH / 2;
      springs.current?.x.set(Math.min(Math.max(left, 8), width - GRIP_WIDTH - 8), true);
      anchored.current = true;
    }
    element.dataset.grip = 'shown';
  };
  // Hover intent: the reveal waits until the pointer has rested in the band for HOVER_REVEAL_MS; a quick pass shows
  // nothing. The grip then anchors at the pointer's x at that moment.
  const revealTimer = useRef(0);
  const pointerX = useRef(0);
  const intendReveal = (clientX: number) => {
    pointerX.current = clientX;
    window.clearTimeout(revealTimer.current);
    revealTimer.current = window.setTimeout(() => showGrip(pointerX.current), HOVER_REVEAL_MS);
  };
  const hideGrip = () => {
    const element = line.current;
    // Only the keyboard keeps it up; a press with a pointer does not.
    if (!element || drag.current || element.querySelector(':focus-visible')) return;
    window.clearTimeout(revealTimer.current);
    delete element.dataset.grip;
    window.clearTimeout(hideTimer.current);
    // Fully hidden after the 140 ms fade: the next hover anchors where it starts.
    hideTimer.current = window.setTimeout(() => {
      anchored.current = false;
    }, 160);
  };
  // While the grip shows, a document-level guard hides it as soon as the pointer is outside the panel: fast exits
  // and moves into the player's iframe (which swallows pointer events) never reach the band's pointerleave.
  const hideRef = useRef(hideGrip);
  useLayoutEffect(() => {
    hideRef.current = hideGrip;
  });
  useLayoutEffect(() => {
    const check = (event: PointerEvent) => {
      const element = line.current;
      if (!element || element.dataset.grip !== 'shown' || drag.current) return;
      const panel = element.closest('.track-panel');
      if (!panel) return;
      const box = panel.getBoundingClientRect();
      const leftDocument = event.type === 'pointerout' && (!event.relatedTarget || (event.relatedTarget as Element).tagName === 'IFRAME');
      const inside = event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
      if (leftDocument || !inside) hideRef.current();
    };
    document.addEventListener('pointermove', check, true);
    document.addEventListener('pointerout', check, true);
    return () => {
      document.removeEventListener('pointermove', check, true);
      document.removeEventListener('pointerout', check, true);
    };
  }, []);
  /**
   * One drag frame: auto-scroll when the pointer is in (or past) an edge zone, the playhead to the boundary under
   * the pointer, the line onto it. The scroll velocity eases toward edgeVelocity() (Alt 4× slower for precision,
   * Shift 2× faster), so speed changes smoothly as the pointer moves deeper; while it scrolls the line stays pinned
   * at the edge and time keeps following. Runs per animation frame only while something is moving.
   */
  const follow = (time?: number) => {
    const now = time ?? frameTime();
    const state = drag.current;
    const element = line.current;
    const list = element?.parentElement;
    if (!state || !element || !list) return;
    const dt = Math.min(64, Math.max(0, now - state.last)) / 1000;
    state.last = now;
    // The person scrolled the list themselves (a wheel mid-drag): pick up from there.
    if (Math.abs(list.scrollTop - state.scroll) > 2) state.scroll = list.scrollTop;
    const box = list.getBoundingClientRect();
    const above = box.top + HEADER_HEIGHT + DRAG_EDGE - state.clientY;
    const below = state.clientY - (box.bottom - DRAG_EDGE);
    let target = above > 0 ? -edgeVelocity(above) : below > 0 ? edgeVelocity(below) : 0;
    if (state.alt) target /= 4;
    else if (state.shift) target *= 2;
    const maxScroll = list.scrollHeight - list.clientHeight;
    if ((target < 0 && state.scroll <= 0) || (target > 0 && state.scroll >= maxScroll)) target = 0;
    state.velocity += (target - state.velocity) * (1 - Math.exp((-dt * 1000) / EDGE_SMOOTH_MS));
    if (target === 0 && Math.abs(state.velocity) < 4) state.velocity = 0;
    if (state.velocity) {
      state.scroll = Math.min(Math.max(state.scroll + state.velocity * dt, 0), maxScroll);
      scrollListTo(list, state.scroll);
    }
    const y = Math.min(
      Math.max(state.clientY - box.top + list.scrollTop, list.scrollTop + HEADER_HEIGHT),
      list.scrollTop + list.clientHeight,
    );
    const count = countAt(y);
    if (count !== state.target) {
      state.target = seekTo(count);
    }
    // The line settles onto the snapped boundary with weight; the grip keeps to the pointer's x.
    element.style.transition = JUMP_TRANSITION;
    springs.current?.y.set(
      Math.min(
        Math.max(nowOffset(state.target, total, rowHeight, extraIndex, extraHeight), list.scrollTop + HEADER_HEIGHT + 1),
        list.scrollTop + list.clientHeight - 1,
      ),
    );
    onInteract();
    state.frame = state.velocity || target ? requestAnimationFrame(follow) : 0;
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const list = line.current?.parentElement;
    drag.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      target: reached,
      frame: 0,
      startTime: player.getTime(),
      velocity: 0,
      scroll: list?.scrollTop ?? 0,
      last: performance.now(),
      alt: event.altKey,
      shift: event.shiftKey,
    };
    showGrip(event.clientX);
    pointerPress.current = true;
    line.current?.querySelector<HTMLElement>('.now-grip')?.focus({ preventScroll: true });
    pointerPress.current = false;
    setDragging(true);
    onDragChange(true);
    onInteract();
    player.beginScrub();
    follow();
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const state = drag.current;
    if (!state) {
      // Before the reveal, the grip will anchor wherever the pointer rests.
      if (event.pointerType === 'mouse' && !anchored.current) pointerX.current = event.clientX;
      return;
    }
    if (state.pointerId !== event.pointerId) return;
    state.clientX = event.clientX;
    state.clientY = event.clientY;
    state.alt = event.altKey;
    state.shift = event.shiftKey;
    if (!state.frame) {
      state.last = performance.now();
      state.frame = requestAnimationFrame(follow);
    }
  };
  /**
   * Ends a drag however it ends: pointer up or cancel, lost capture, Escape, or the window losing the keyboard. The grip
   * the press activated is blurred (a pointer press is not keyboard use), and the bright state follows real hover
   * again: the release point decides (elementFromPoint), not a :hover the capture left stale.
   */
  const endDrag = (release?: { pointerType: string; clientX: number; clientY: number }, cancel = false) => {
    const state = drag.current;
    if (!state) return;
    cancelAnimationFrame(state.frame);
    const list = line.current?.parentElement;
    if (list && !cancel) coast(list, state.velocity);
    drag.current = undefined;
    springs.current?.y.stop();
    setDragging(false);
    onDragChange(false);
    line.current?.querySelector<HTMLElement>('.now-grip')?.blur();
    const under = release && release.pointerType === 'mouse' ? document.elementFromPoint(release.clientX, release.clientY) : null;
    if (!under || !line.current?.contains(under)) hideGrip();
    player.endScrub();
    // Releasing keeps following. Escape puts the playhead back where the drag began.
    onFollow();
    player.seek(cancel ? state.startTime : timeFor(state.target));
  };
  const onPointerEnd = (event: ReactPointerEvent<HTMLElement>) => endDrag(event);
  const endDragRef = useRef(endDrag);
  const followRef = useRef(follow);
  useLayoutEffect(() => {
    endDragRef.current = endDrag;
    followRef.current = follow;
  });
  useEffect(() => {
    if (!dragging) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        endDragRef.current(undefined, true);
        return;
      }
      // Alt (precision) and Shift (faster) apply as soon as they are pressed, not on the next pointer move.
      const state = drag.current;
      if (state && (event.key === 'Alt' || event.key === 'Shift')) {
        state.alt = event.altKey;
        state.shift = event.shiftKey;
        if (!state.frame) {
          state.last = performance.now();
          state.frame = requestAnimationFrame((time) => followRef.current(time));
        }
      }
    };
    const onBlur = () => endDragRef.current();
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [dragging]);

  const clock = formatClock(timeFor(reached));
  const where =
    reached <= 0 ? 'before the first entry' : reached >= total ? 'after the last entry' : `between entry ${reached} and ${reached + 1}`;
  const handlers = {
    onPointerDown,
    onPointerMove,
    onPointerUp: onPointerEnd,
    onPointerCancel: onPointerEnd,
    onLostPointerCapture: onPointerEnd,
  };
  return (
    <div
      ref={line}
      className="now-divider"
      data-testid="now-divider"
      data-reached={reached}
      data-pinned={pinned}
      data-dragging={dragging || undefined}
    >
      <span
        className="now-hit"
        aria-hidden="true"
        onPointerEnter={(event) => {
          if (event.pointerType === 'mouse') intendReveal(event.clientX);
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse' && !(event.relatedTarget instanceof Element && event.relatedTarget.closest('.now-grip')))
            hideGrip();
        }}
        {...handlers}
      />
      <span
        className="now-grip"
        role="slider"
        tabIndex={0}
        aria-label="Now"
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={reached}
        aria-valuetext={`Now ${clock}, ${where}`}
        data-testid="now-grip"
        onFocus={() => {
          // The keyboard has no pointer: the grip shows in the Time column's gutter.
          if (!pointerPress.current && !drag.current) {
            anchored.current = false;
            showGrip('keyboard');
          }
        }}
        onBlur={() => {
          if (!line.current?.matches(':hover')) hideGrip();
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse' && !(event.relatedTarget instanceof Element && event.relatedTarget.closest('.now-hit')))
            hideGrip();
        }}
        onKeyDown={(event) => {
          const next =
            event.key === 'ArrowDown'
              ? reached + 1
              : event.key === 'ArrowUp'
                ? reached - 1
                : event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? total
                    : undefined;
          if (next === undefined) return;
          event.preventDefault();
          event.stopPropagation();
          onFollow();
          seekTo(next);
        }}
        {...handlers}
      >
        <GripHorizontalIcon aria-hidden="true" />
      </span>
    </div>
  );
}

/** The time cell: a button that seeks the replay to the entry. Upcoming entries say so in their name. */
function SeekTime({ at, future }: { at: number; future: boolean }) {
  const player = usePlayer();
  const clock = formatClock(at);
  return (
    <button
      type="button"
      className="seek-time"
      aria-label={`Seek to ${clock}${future ? ', upcoming' : ''}`}
      onClick={() => player.seek(seekPastStart(at))}
    >
      <time>{clock}</time>
    </button>
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
                    {entry.url ? domain(entry.url) : '—'}
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

const NetworkPanel = memo(function NetworkPanel({
  entries,
  reached,
  human,
  host,
  expanded,
  onSwitch,
}: {
  entries: ReplayNetworkEntry[];
  reached: number;
  human: boolean;
  /** The replay's own host: requests to it show just their path. */
  host: string | undefined;
  expanded: string | undefined;
  onSwitch: (id: string | undefined) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLTableSectionElement>(null);
  const total = entries.length;
  const ats = useMemo(() => entries.map((entry) => entry.at), [entries]);
  const rowHeight = useRowHeight(body, 'tr.network-row', total > 0);
  const expandedIndex = useMemo(() => (expanded ? entries.findIndex((entry) => entry.id === expanded) : -1), [entries, expanded]);
  const firstAt = entries[0]?.at ?? 0;
  const [detailHeight, setDetailHeight] = useState(0);
  // A request opened in place of another (a click on another row, ↑ / ↓) swaps the detail without the accordion.
  const [instantId, setInstantId] = useState<string | undefined>(undefined);
  // ↑ / ↓ move the open request: the next one lands under the header at once (no glide on a key repeat).
  const instantScroll = useRef(false);
  // The switch to move to once the request it belongs to has rendered (↑ / ↓).
  const pendingSwitch = useRef<string | undefined>(undefined);
  // Stable across playhead ticks, so memoised rows skip re-rendering unless they cross the playhead.
  const flip = useCallback(
    (id: string) => {
      if (expanded === id) {
        // Closing a request whose row is pinned over its own detail: bring the row back to where it pinned, so
        // the list does not jump to wherever the detail had been scrolled to.
        const element = scroller.current;
        const row = element?.querySelector<HTMLElement>('tr.network-row.expanded[data-pinned]');
        const index = entries.findIndex((entry) => entry.id === id);
        if (element && row && index >= 0) scrollListTo(element, TRACK_GAP + index * rowHeight);
        onSwitch(undefined);
        return;
      }
      setInstantId(expanded === undefined ? undefined : id);
      onSwitch(id);
    },
    [entries, expanded, onSwitch, rowHeight],
  );
  const move = useCallback(
    (id: string, delta: 1 | -1) => {
      const index = entries.findIndex((entry) => entry.id === id);
      const next = entries[index + delta];
      if (index < 0 || !next) return;
      pendingSwitch.current = next.id;
      if (expanded === undefined) {
        document.getElementById(`request-switch-${next.id}`)?.focus();
        pendingSwitch.current = undefined;
        return;
      }
      instantScroll.current = true;
      setInstantId(next.id);
      onSwitch(next.id);
    },
    [entries, expanded, onSwitch],
  );
  useLayoutEffect(() => {
    const id = pendingSwitch.current;
    if (!id) return;
    pendingSwitch.current = undefined;
    document.getElementById(`request-switch-${id}`)?.focus({ preventScroll: true });
  }, [expanded]);

  const { start, end, padTop, padBottom } = useWindowedRows(scroller, {
    count: total,
    rowHeight,
    headerHeight: HEADER_HEIGHT + TRACK_GAP,
    extraIndex: expandedIndex,
    extraHeight: detailHeight,
  });

  // The open request's row sticks under the header while its detail scrolls under it (CSS: position sticky at
  // --pin-top), and is pushed up by the detail's end. A table cell's sticky range is the whole table, so the
  // push-up is set here: the pin rises with the detail's bottom edge. data-pinned draws its hairline.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element || expandedIndex < 0) return;
    const place = () => {
      const row = element.querySelector<HTMLElement>('tr.network-row.expanded');
      const detail = row?.nextElementSibling;
      if (!row || !(detail instanceof HTMLElement) || !detail.classList.contains('request-detail-row')) return;
      const top = element.getBoundingClientRect().top + element.clientTop;
      const box = detail.getBoundingClientRect();
      // Under the sticky header's cells, 1 px up: a collapsed border does not travel with a sticky cell, so the
      // header's hairline would be a see-through gap; the pinned row draws that hairline itself (styles.css).
      const head = element.querySelector('thead th')?.getBoundingClientRect().bottom ?? top + HEADER_HEIGHT;
      const pin = Math.min(head - top - 1, box.bottom - top - row.offsetHeight);
      row.style.setProperty('--pin-top', `${pin}px`);
      const pinned = box.top < head + row.offsetHeight - 1 && box.bottom > head;
      if (pinned) row.setAttribute('data-pinned', '');
      else row.removeAttribute('data-pinned');
    };
    place();
    element.addEventListener('scroll', place, { passive: true });
    const observer = new ResizeObserver(place);
    observer.observe(element);
    const detail = element.querySelector('tr.request-detail-row');
    if (detail) observer.observe(detail);
    return () => {
      element.removeEventListener('scroll', place);
      observer.disconnect();
      for (const row of element.querySelectorAll<HTMLElement>('tr.network-row[data-pinned]')) row.removeAttribute('data-pinned');
    };
  }, [expandedIndex, start, end]);

  // Keep the expanded detail's measured height so offsets stay right after it scrolls out of the window.
  useLayoutEffect(() => {
    const detail = body.current?.querySelector<HTMLElement>('tr.request-detail-row');
    if (!detail) return;
    const observer = new ResizeObserver(() => setDetailHeight(detail.getBoundingClientRect().height));
    observer.observe(detail);
    return () => observer.disconnect();
  }, [expandedIndex, start, end]);

  // An expanded request (a click, Enter, an error jump) glides to just under the sticky header, so its detail gets
  // the room below (the viewer also grows a short panel meanwhile). 260 ms ease-out, recomputing the target each
  // frame while the detail opens; instant under reduced motion; a wheel, touch or press in the list cancels it.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element || expandedIndex < 0) return;
    const target = () => Math.max(0, Math.min(TRACK_GAP + expandedIndex * rowHeight, element.scrollHeight - element.clientHeight));
    const instant = instantScroll.current;
    instantScroll.current = false;
    if (instant || prefersReducedMotion()) {
      scrollListTo(element, target());
      // Once the detail has opened there is room for the row to reach the header.
      const timer = window.setTimeout(() => scrollListTo(element, target()), 0);
      return () => window.clearTimeout(timer);
    }
    // Far away (not even rendered): start next to it.
    if (Math.abs(target() - element.scrollTop) > element.clientHeight * 2) scrollListTo(element, target() - element.clientHeight);
    let frame = 0;
    const from = element.scrollTop;
    const began = performance.now();
    const cancel = () => cancelAnimationFrame(frame);
    let placed = from;
    const step = (now: number) => {
      // Something else moved the list meanwhile (Back to now, a seek, a wheel): hand over.
      if (Math.abs(element.scrollTop - placed) > 1) return;
      const t = Math.min(1, (now - began) / EXPAND_SCROLL_MS);
      element.scrollTop = from + (target() - from) * (1 - (1 - t) ** 3);
      placed = element.scrollTop;
      // Keep landing on the target a little longer: the detail and the panel finish opening just after.
      if (now - began < EXPAND_SCROLL_MS + 300) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    element.addEventListener('wheel', cancel, { passive: true });
    element.addEventListener('touchstart', cancel, { passive: true });
    element.addEventListener('pointerdown', cancel);
    return () => {
      cancel();
      element.removeEventListener('wheel', cancel);
      element.removeEventListener('touchstart', cancel);
      element.removeEventListener('pointerdown', cancel);
    };
    // Only when the expanded request changes, not on every resize.
    // oxlint-disable-next-line react/exhaustive-deps
  }, [expandedIndex]);

  return (
    <TrackList
      testId="network-list"
      reached={reached}
      total={total}
      rowHeight={rowHeight}
      extraIndex={expandedIndex}
      extraHeight={detailHeight}
      ats={ats}
      scroller={scroller}
    >
      {total === 0 ? (
        <TrackEmpty track="network" human={human} />
      ) : (
        <table className="diagnostic-table network-table" aria-rowcount={total + 1}>
          <thead>
            <tr aria-rowindex={1}>
              <th>Time</th>
              <th>Request</th>
              <th>Status</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody ref={body}>
            <GapRow columns={4} />
            <SpacerRow height={padTop} columns={4} />
            {entries.slice(start, end).map((entry, offset) => (
              <NetworkRow
                key={entry.id}
                entry={entry}
                rowIndex={start + offset + 2}
                future={start + offset >= reached}
                host={host}
                firstAt={firstAt}
                expanded={expanded === entry.id}
                instant={instantId === entry.id}
                replaced={expanded !== undefined && expanded !== entry.id}
                onSwitch={flip}
                onStep={move}
              />
            ))}
            <SpacerRow height={padBottom} columns={4} />
            <GapRow columns={4} trailing />
          </tbody>
        </table>
      )}
    </TrackList>
  );
});

const PerformancePanel = memo(function PerformancePanel({
  track,
  entries,
  reached,
  human,
}: {
  track: ReplayBundle['performance'];
  entries: ReplayPerformanceEntry[];
  reached: number;
  human: boolean;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLTableSectionElement>(null);
  const total = entries.length;
  const ats = useMemo(() => entries.map((entry) => entry.at), [entries]);
  const rowHeight = useRowHeight(body, 'tr.performance-row', total > 0);
  const { start, end, padTop, padBottom } = useWindowedRows(scroller, { count: total, rowHeight, headerHeight: HEADER_HEIGHT + TRACK_GAP });
  const supported = track?.supported ?? [];
  return (
    <TrackList testId="performance-list" reached={reached} total={total} rowHeight={rowHeight} ats={ats} scroller={scroller}>
      {total === 0 ? (
        !track ? (
          <Empty title="Performance wasn’t recorded">
            {human
              ? 'This recording was imported from rrweb, so browser timing wasn’t captured.'
              : 'This older replay has no Performance track.'}
          </Empty>
        ) : supported.length === 0 ? (
          <Empty title="Performance APIs unavailable">This browser did not expose the timing entries used by this capture.</Empty>
        ) : (
          <Empty title="No slow work captured">
            No long tasks (50 ms or more) or slow interactions (40 ms or more) were observed. Available paint timings are included when
            present.
          </Empty>
        )
      ) : (
        <table className="diagnostic-table performance-table" aria-rowcount={total + 1}>
          <thead>
            <tr aria-rowindex={1}>
              <th>Time</th>
              <th>Signal</th>
              <th>Duration</th>
              <th>Event</th>
            </tr>
          </thead>
          <tbody ref={body}>
            <GapRow columns={4} />
            <SpacerRow height={padTop} columns={4} />
            {entries.slice(start, end).map((entry, offset) => {
              const index = start + offset;
              const future = index >= reached;
              return (
                <tr
                  className={`performance-row ${entry.kind}`}
                  key={`${entry.at}-${index}`}
                  aria-rowindex={index + 2}
                  data-future={future || undefined}
                >
                  <td>
                    <SeekTime at={entry.at} future={future} />
                  </td>
                  <td>{performanceLabel(entry.kind)}</td>
                  <td className="number-cell">{Math.round(entry.value)} ms</td>
                  <td className="performance-detail">{entry.eventType ?? '—'}</td>
                </tr>
              );
            })}
            <SpacerRow height={padBottom} columns={4} />
            <GapRow columns={4} trailing />
          </tbody>
        </table>
      )}
    </TrackList>
  );
});

function performanceLabel(kind: ReplayPerformanceEntry['kind']) {
  switch (kind) {
    case 'first-contentful-paint':
      return 'First contentful paint';
    case 'largest-contentful-paint':
      return 'Largest contentful paint candidate';
    case 'long-task':
      return 'Main-thread task';
    case 'slow-interaction':
      return 'Slow interaction';
  }
}

const NetworkRow = memo(function NetworkRow({
  entry,
  rowIndex,
  future,
  host,
  firstAt,
  expanded,
  instant,
  replaced,
  onSwitch,
  onStep,
}: {
  entry: ReplayNetworkEntry;
  rowIndex: number;
  /** After the playhead: listed, faded. */
  future: boolean;
  host: string | undefined;
  /** When the first request started: the detail gives this one's start relative to it. */
  firstAt: number;
  expanded: boolean;
  /** Opened in place of another request (a switch): the detail appears without the accordion. */
  instant: boolean;
  /** Another request is open now: a closing detail goes at once instead of collapsing. */
  replaced: boolean;
  onSwitch: (id: string) => void;
  /** ↑ / ↓ on the row's switch: the previous or next request. */
  onStep: (id: string, delta: 1 | -1) => void;
}) {
  const failed = isFailedRequest(entry);
  const unanswered = hasNoResponse(entry);
  const size = entrySize(entry);
  const request = useMemo(() => splitRequest(entry.url, host), [entry.url, host]);
  const detailId = `request-detail-${entry.id}`;
  // Accordion: the detail stays mounted while it collapses (data-closing), then unmounts on transitionend.
  // Under reduced motion there is no transition, so it unmounts at once.
  const [open, setOpen] = useState(expanded);
  if (expanded && !open) setOpen(true);
  if (!expanded && open && (replaced || prefersReducedMotion())) setOpen(false);
  const closing = open && !expanded;
  return (
    <Fragment>
      <tr
        className={`network-row ${failed ? 'failed' : ''} ${expanded ? 'expanded' : ''}`}
        aria-rowindex={rowIndex}
        data-future={future || undefined}
      >
        <td>
          <SeekTime at={entry.at} future={future} />
        </td>
        <td className="request-cell">
          <button
            type="button"
            id={`request-switch-${entry.id}`}
            data-request-id={entry.id}
            aria-expanded={expanded}
            aria-controls={detailId}
            onClick={() => onSwitch(entry.id)}
            onKeyDown={(event) => {
              // Escape on an open request's switch closes it (the keyboard stays here).
              if (event.key === 'Escape' && expanded) {
                event.stopPropagation();
                onSwitch(entry.id);
              } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !event.altKey && !event.metaKey && !event.ctrlKey) {
                // Arrows move between requests (and move the open detail along with them).
                event.preventDefault();
                event.stopPropagation();
                onStep(entry.id, event.key === 'ArrowDown' ? 1 : -1);
              }
            }}
          >
            <ChevronRightIcon aria-hidden="true" />
            <span className="method">{entry.method}</span>
            <span className="request-url" title={entry.url}>
              {request.origin ? <span className="request-origin">{request.origin}</span> : null}
              <span className="request-path">{request.path}</span>
            </span>
          </button>
        </td>
        <td>
          {unanswered ? (
            <span className="status-code none" title={NO_RESPONSE}>
              —
            </span>
          ) : (
            // Neutral for 1xx–3xx; colour only for a failure (4xx, 5xx, a network error), inside the row.
            <span className={`status-code ${failed ? 'bad' : ''}`}>{entry.status || 'ERR'}</span>
          )}
        </td>
        <td className="duration-cell">
          {/* No colour: slow requests just carry more ink (≥ 500 ms, ≥ 2 s). */}
          <span className="duration-value" data-slow={entry.duration >= 2000 ? 'very' : entry.duration >= 500 ? '' : undefined}>
            {formatDuration(entry.duration)}
          </span>
        </td>
      </tr>
      {open ? (
        <tr className="request-detail-row" data-closing={closing || undefined} data-instant={instant || undefined}>
          <td colSpan={4}>
            <div
              className="request-detail-reveal"
              onTransitionEnd={(event) => {
                if (closing && event.target === event.currentTarget && event.propertyName === 'grid-template-rows') setOpen(false);
              }}
            >
              {/* Escape anywhere in the open detail closes it and returns the keyboard to its row's switch. */}
              {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
              <section
                className="request-detail"
                id={detailId}
                aria-labelledby={`request-switch-${entry.id}`}
                data-testid="request-detail"
                // Reachable by click (not by Tab), so Escape works after selecting or clicking in the detail.
                tabIndex={-1}
                inert={closing || undefined}
                onKeyDown={(event) => {
                  if (event.key !== 'Escape') return;
                  event.stopPropagation();
                  onSwitch(entry.id);
                  document.getElementById(`request-switch-${entry.id}`)?.focus();
                }}
              >
                <RequestDetail entry={entry} firstAt={firstAt} unanswered={unanswered} size={size} />
              </section>
            </div>
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
});

/** "82 ms", "1.24 s": milliseconds under a second, seconds (two decimals) above. */
function formatDuration(ms: number) {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

/** The host of a URL, or undefined when it does not parse. */
function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

/**
 * A request as the list shows it: its path (with the query), and its origin only when that is not the replay's own
 * host ("/api/projects" vs "does-not-exist.invalid" + "/pixel.gif"). The full URL stays in the title and the detail.
 */
export function splitRequest(url: string, host: string | undefined): { origin?: string; path: string } {
  try {
    const parsed = new URL(url);
    const path = `${parsed.pathname}${parsed.search}` || '/';
    return parsed.host === host ? { path } : { origin: parsed.host, path };
  } catch {
    return { path: url };
  }
}

/**
 * The open request: one four-column grid for everything (two on phones), so the facts' dividers and the headers'
 * split fall on the same column lines. Labels are quiet sans; only data is mono.
 */
function RequestDetail({
  entry,
  firstAt,
  unanswered,
  size,
}: {
  entry: ReplayNetworkEntry;
  firstAt: number;
  unanswered: boolean;
  size: number | undefined;
}) {
  const url = useMemo(() => splitUrl(entry.url), [entry.url]);
  return (
    <div className="rd-grid">
      <div className="rd-url">
        <div className="rd-heading">
          <h2>URL</h2>
          <CopyButton value={entry.url} label="Copy URL" className="rd-copy" />
        </div>
        <code className="rd-url-value">
          {url.origin ? <span className="rd-dim">{url.origin}</span> : null}
          {url.rest}
        </code>
      </div>
      <dl className="rd-facts">
        <Fact label="Status" title={unanswered ? NO_RESPONSE : undefined}>
          {unanswered ? 'No response (redirect hop)' : `${entry.status || 'Error'} ${entry.statusText}`.trim()}
        </Fact>
        <Fact label="Method">{entry.method}</Fact>
        <Fact label="Content type">{entry.mimeType ?? '—'}</Fact>
        <Fact label="Size">{size === undefined ? '—' : formatBytes(size)}</Fact>
        <Fact label="Started">{formatClock(entry.at)}</Fact>
        <Fact label="Duration">{entry.duration.toFixed(1)} ms</Fact>
        <Fact label="Finished">{formatClock(entry.at + entry.duration)}</Fact>
        <Fact label="After first request">{entry.at > firstAt ? `+${formatDuration(entry.at - firstAt)}` : '—'}</Fact>
      </dl>
      <div className="rd-headers">
        <HeaderList title="Request headers" rows={entry.requestHeaders} />
        <HeaderList title="Response headers" rows={entry.responseHeaders} />
      </div>
      <p className="rd-note">Request and response bodies are not retained.</p>
    </div>
  );
}

function Fact({ label, title, children }: { label: string; title?: string | undefined; children: ReactNode }) {
  return (
    <div className="rd-fact">
      <dt>{label}</dt>
      <dd title={title}>{children}</dd>
    </div>
  );
}

/** "https://127.0.0.1:4100" + "/api/time-entries?x=1": the origin is dimmed so the path reads first. */
function splitUrl(url: string): { origin?: string; rest: string } {
  try {
    const parsed = new URL(url);
    return { origin: parsed.origin, rest: url.slice(parsed.origin.length) || '/' };
  } catch {
    return { rest: url };
  }
}

function HeaderList({ title, rows }: { title: string; rows: Array<{ name: string; value: string }> }) {
  const text = useMemo(() => rows.map((row) => `${row.name}: ${row.value}`).join('\n'), [rows]);
  return (
    <section className="rd-section">
      <div className="rd-heading">
        <h2>
          {title}
          {rows.length ? <span className="rd-count">{rows.length}</span> : null}
        </h2>
        {rows.length ? <CopyButton value={text} label={`Copy ${title.toLowerCase()}`} className="rd-copy" /> : null}
      </div>
      {rows.length ? (
        <dl className="rd-headers-list">
          {rows.map((row) => (
            <div key={`${row.name}-${row.value}`}>
              <dt>{row.name}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="rd-empty">None retained</p>
      )}
    </section>
  );
}
