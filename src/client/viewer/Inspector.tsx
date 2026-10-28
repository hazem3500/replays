import { ChevronRightIcon, CircleXIcon, ChartNoAxesGanttIcon, FilterIcon, XIcon, SearchIcon, TriangleAlertIcon } from 'lucide-react';
import {
  Fragment,
  memo,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { formatClock, type ReplayBundle, type ReplayConsoleEntry, type ReplayNetworkEntry } from '../../shared/replay.ts';
import { domain, entrySize, formatBytes, hasNoResponse, isFailedRequest } from '../format.ts';
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
import { CopyButton } from '@/components/copy-button.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover.tsx';
import { readStorage, writeStorage } from '../storage.ts';
import { useFilledAfterTransition } from '../navigation.ts';
import type { EditTimeline } from '../../shared/edits.ts';
import { TimingBar } from './TimingBar.tsx';
import './diagnostic-timing.css';
import { validDuration, type WaterfallRow } from './waterfall.ts';
import { TrackList, SeekTime, HEADER_HEIGHT, TRACK_GAP, TRAILING_GAP, prefersReducedMotion, scrollListTo } from './TrackList.tsx';
import { resolveSlot } from '../plugins/registry.ts';
import { DockPanel, InspectorDock } from './InspectorDock.tsx';
import { inspectorTabItems } from './inspector-tabs.ts';
import { consoleBadge, networkBadge, performanceBadge } from './tab-badges.ts';
export { edgeVelocity } from './TrackList.tsx';
import { PerformanceDiagnostics } from './Performance.tsx';
import { buildPerformance } from './performance.ts';
import { INSPECTOR_HEIGHT_KEY, MIN_INSPECTOR_HEIGHT, maxInspectorHeight } from './inspector-size.ts';

const NO_RESPONSE = 'No response recorded: a redirect hop, or still in flight when capture stopped';
const stopPlayerKeyboard = (event: ReactKeyboardEvent<HTMLElement>) => {
  if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) event.stopPropagation();
};

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
   * describe; `performance` sits above the performance events with how the recordings differ.
   */
  compare?: { scope?: ReactNode; performance?: ReactNode } | undefined;
}) {
  const player = usePlayer();
  const { setTab, setExpandedRequest } = useViewer();
  const features = activeFeatures().flatMap((feature) => (feature.tab ? [{ id: feature.id, featureTab: feature.tab }] : []));
  const featureBadges = useFeatureBadges();
  // Rows fill once the page transition has landed (navigation.ts); until then each panel shows its pending frame.
  const filled = useFilledAfterTransition();
  const contextSchema = useContextSchema();
  const human = bundle.meta.source === 'human';
  const replayHost = useMemo(() => hostOf(bundle.meta.url), [bundle.meta.url]);
  const consoleTrack = useMemo(() => sortByAt(bundle.console), [bundle]);

  const firstNetworkAt = useMemo(
    () => sourceBundle.network.reduce((first, entry) => (Number.isFinite(entry.at) ? Math.min(first, entry.at) : first), Infinity),
    [sourceBundle],
  );
  const performanceModel = useMemo(() => buildPerformance(sourceBundle, timeline), [sourceBundle, timeline]);
  const networkRows = useMemo(
    () => performanceModel.rows.filter((row): row is Extract<WaterfallRow, { kind: 'network' }> => row.kind === 'network'),
    [performanceModel],
  );
  const networkTiming = useMemo(() => new Map(networkRows.map((row) => [row.entry.id, row])), [networkRows]);
  const networkTrack = useMemo(() => sortByAt(networkRows.map((row) => ({ ...row.entry, at: row.at }))), [networkRows]);
  // Once playback reaches the end every entry is in view (some trail the last DOM event). At the very start nothing
  // has happened yet, not even entries stamped 0:00.0, so the now line can rest above every row.
  const horizon = (time: number) => (time >= player.duration ? Number.POSITIVE_INFINITY : time <= 0 ? -1 : time);
  const consoleCount = usePlayhead((time) => countAtOrBefore(consoleTrack.ats, horizon(time)));
  const networkCount = usePlayhead((time) => countAtOrBefore(networkTrack.ats, horizon(time)));
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
        network: networkBadge(networkTrack.entries),
        performance: performanceBadge(performanceModel.signals.map((signal) => signal.entry)),
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
      <DockPanel value="network">
        <NetworkPanel
          entries={networkTrack.entries}
          timing={networkTiming}
          duration={player.duration}
          reached={networkCount}
          human={human}
          host={replayHost}
          expanded={expandedRequest}
          onSwitch={setExpandedRequest}
        />
      </DockPanel>
      <DockPanel value="performance">
        {compare?.performance}
        <PerformanceDiagnostics
          model={performanceModel}
          renderRequestDetail={(entry) => (
            <RequestDetail entry={entry} firstAt={firstNetworkAt} unanswered={hasNoResponse(entry)} size={entrySize(entry)} />
          )}
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

const EXPAND_SCROLL_MS = 260;

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
  entries: allEntries,
  reached: allReached,
  timing,
  duration,
  human,
  host,
  expanded,
  onSwitch,
}: {
  entries: ReplayNetworkEntry[];
  reached: number;
  timing: ReadonlyMap<string, WaterfallRow>;
  duration: number;
  human: boolean;
  /** The replay's own host: requests to it show just their path. */
  host: string | undefined;
  expanded: string | undefined;
  onSwitch: (id: string | undefined) => void;
}) {
  const player = usePlayer();
  const [query, setQuery] = useState('');
  const [state, setState] = useState('all');
  const [searchOpen, setSearchOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const searchTrigger = useRef<HTMLButtonElement>(null);
  const entries = useMemo(() => {
    const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    return allEntries.filter(
      (entry) =>
        words.every((word) => `${entry.method} ${entry.url} ${entry.status}`.toLocaleLowerCase().includes(word)) &&
        (state === 'all' ||
          (state === 'failed' && isFailedRequest(entry)) ||
          (state === 'slow' && entry.duration >= 500) ||
          (state === 'incomplete' && hasNoResponse(entry))),
    );
  }, [allEntries, query, state]);
  const filteredAts = useMemo(() => entries.map((entry) => entry.at), [entries]);
  const filteredReached = usePlayhead((time) => countAtOrBefore(filteredAts, time >= player.duration ? Infinity : time <= 0 ? -1 : time));
  const reached = query || state !== 'all' ? filteredReached : allReached;
  const [showTiming, setShowTiming] = useState(true);
  const columns = showTiming ? 5 : 4;
  const scroller = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLTableSectionElement>(null);
  const total = entries.length;
  const activeFilters = Number(query.trim().length > 0) + Number(state !== 'all');
  const filtered = activeFilters > 0;
  const ats = useMemo(() => entries.map((entry) => entry.at), [entries]);
  const rowHeight = useRowHeight(body, 'tr.network-row', total > 0);
  const expandedIndex = useMemo(() => (expanded ? entries.findIndex((entry) => entry.id === expanded) : -1), [entries, expanded]);
  const firstAt = allEntries.reduce((first, entry) => Math.min(first, timing.get(entry.id)?.sourceAt ?? entry.at), Infinity);
  const [detailHeight, setDetailHeight] = useState(0);
  // A request opened in place of another (a click on another row, ↑ / ↓) swaps the detail without the accordion.
  const [instantId, setInstantId] = useState<string | undefined>(undefined);
  // ↑ / ↓ move the open request: the next one lands under the header at once (no glide on a key repeat).
  const instantScroll = useRef(false);
  // The switch to move to once the request it belongs to has rendered (↑ / ↓).
  const pendingSwitch = useRef<string | undefined>(undefined);
  const openSearch = () => {
    setSearchOpen(true);
    requestAnimationFrame(() => searchInput.current?.focus());
  };
  const closeSearch = (restoreFocus = true) => {
    setQuery('');
    setSearchOpen(false);
    if (restoreFocus) requestAnimationFrame(() => searchTrigger.current?.focus());
  };
  const clearFilters = () => {
    setQuery('');
    setState('all');
  };
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
    <div className="network-workspace">
      <div className="diagnostic-toolbar network-toolbar">
        <div className="network-toolbar-main">
          <div className="network-toolbar-controls">
            <Button
              ref={searchTrigger}
              className="network-toolbar-button network-search-trigger"
              variant="ghost"
              size="icon-lg"
              aria-label={searchOpen ? 'Close network search' : 'Search network requests'}
              aria-expanded={searchOpen}
              aria-controls="network-search-panel"
              data-testid="network-search-toggle"
              onClick={() => (searchOpen ? closeSearch() : openSearch())}
              onKeyDown={stopPlayerKeyboard}
            >
              <SearchIcon aria-hidden="true" />
            </Button>
            <Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
              <PopoverTrigger
                className="network-toolbar-button network-filter-trigger"
                aria-label={activeFilters ? `Request filters, ${activeFilters} active` : 'Request filters'}
                aria-haspopup="dialog"
                data-testid="network-filter-toggle"
                onKeyDown={stopPlayerKeyboard}
              >
                <FilterIcon aria-hidden="true" />
                <span>Filter</span>
                {activeFilters ? (
                  <span className="network-filter-count" aria-hidden="true">
                    {activeFilters}
                  </span>
                ) : null}
              </PopoverTrigger>
              <PopoverContent
                align="start"
                side="bottom"
                sideOffset={6}
                className="network-filter-popover"
                aria-label="Request filters"
                onKeyDown={(event) => {
                  if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) event.stopPropagation();
                }}
              >
                <PopoverTitle className="network-filter-title">Request status</PopoverTitle>
                <div className="network-filter-options" role="group" aria-label="Request status">
                  {(
                    [
                      ['all', 'All requests'],
                      ['failed', 'Failed'],
                      ['slow', 'Slow · 500 ms+'],
                      ['incomplete', 'Incomplete'],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className="network-filter-option"
                      aria-pressed={state === value}
                      onClick={() => setState(value)}
                    >
                      <span>{label}</span>
                      {state === value ? <span aria-hidden="true">Selected</span> : null}
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            {activeFilters ? (
              <Button
                className="network-clear-filters"
                variant="ghost"
                size="sm"
                aria-label="Clear active network filters"
                onClick={clearFilters}
                onKeyDown={stopPlayerKeyboard}
              >
                <XIcon aria-hidden="true" />
                Clear
              </Button>
            ) : null}
          </div>
          <span className="network-result-count" aria-live="polite">
            {filtered ? `${total} of ${allEntries.length} requests` : `${total} ${total === 1 ? 'request' : 'requests'}`}
          </span>
        </div>
        <Button
          className="network-toolbar-button network-timing-toggle"
          variant="ghost"
          size="sm"
          aria-pressed={showTiming}
          aria-label="Show or hide request waterfall"
          onClick={() => setShowTiming((shown) => !shown)}
          onKeyDown={stopPlayerKeyboard}
        >
          <ChartNoAxesGanttIcon aria-hidden="true" />
          <span>Waterfall</span>
        </Button>
      </div>
      <div
        id="network-search-panel"
        className="network-search-panel"
        data-open={searchOpen || undefined}
        aria-hidden={!searchOpen}
        inert={!searchOpen}
      >
        <label className="network-search-field">
          <SearchIcon aria-hidden="true" />
          <span className="visually-hidden">Search network requests</span>
          <input
            ref={searchInput}
            type="search"
            placeholder="URL, method, or status"
            value={query}
            disabled={!searchOpen}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key !== 'Escape') return;
              event.preventDefault();
              if (query) setQuery('');
              else closeSearch();
            }}
          />
          {query ? (
            <button
              type="button"
              className="network-search-clear"
              aria-label="Clear network search"
              onKeyDown={stopPlayerKeyboard}
              onClick={() => {
                setQuery('');
                searchInput.current?.focus();
              }}
            >
              <XIcon aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            className="network-search-close"
            aria-label="Close network search"
            onKeyDown={stopPlayerKeyboard}
            onClick={() => closeSearch()}
          >
            <XIcon aria-hidden="true" />
          </button>
        </label>
      </div>
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
          allEntries.length ? (
            <Empty title="No matching requests">Try another URL, method or status.</Empty>
          ) : (
            <TrackEmpty track="network" human={human} />
          )
        ) : (
          <table className="diagnostic-table network-table" aria-rowcount={total + 1}>
            <thead>
              <tr aria-rowindex={1}>
                <th>Time</th>
                <th>Request</th>
                <th>Status</th>
                <th>Duration</th>
                {showTiming ? (
                  <th className="network-timing-heading">
                    Waterfall <span>0 — {formatClock(duration)}</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody ref={body}>
              <GapRow columns={columns} />
              <SpacerRow height={padTop} columns={columns} />
              {entries.slice(start, end).map((entry, offset) => (
                <NetworkRow
                  key={entry.id}
                  entry={entry}
                  rowIndex={start + offset + 2}
                  future={start + offset >= reached}
                  host={host}
                  firstAt={firstAt}
                  timing={timing.get(entry.id)}
                  duration={duration}
                  showTiming={showTiming}
                  expanded={expanded === entry.id}
                  instant={instantId === entry.id}
                  replaced={expanded !== undefined && expanded !== entry.id}
                  onSwitch={flip}
                  onStep={move}
                />
              ))}
              <SpacerRow height={padBottom} columns={columns} />
              <GapRow columns={columns} trailing />
            </tbody>
          </table>
        )}
      </TrackList>
    </div>
  );
});

const NetworkRow = memo(function NetworkRow({
  entry,
  rowIndex,
  future,
  host,
  firstAt,
  timing,
  duration,
  showTiming,
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
  timing: WaterfallRow | undefined;
  duration: number;
  showTiming: boolean;
  expanded: boolean;
  /** Opened in place of another request (a switch): the detail appears without the accordion. */
  instant: boolean;
  /** Another request is open now: a closing detail goes at once instead of collapsing. */
  replaced: boolean;
  onSwitch: (id: string) => void;
  /** ↑ / ↓ on the row's switch: the previous or next request. */
  onStep: (id: string, delta: 1 | -1) => void;
}) {
  const player = usePlayer();
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
            {unanswered || !validDuration(entry.duration) ? '—' : formatDuration(entry.duration)}
          </span>
        </td>
        {showTiming ? (
          <td className="network-timing-cell">
            <button
              type="button"
              aria-label={`Inspect timing for ${entry.method} ${entry.url}`}
              aria-expanded={expanded}
              onClick={() => {
                if (timing) player.seek(timing.at);
                onSwitch(entry.id);
              }}
            >
              {timing ? <TimingBar row={timing} duration={duration} /> : null}
            </button>
          </td>
        ) : null}
      </tr>
      {open ? (
        <tr className="request-detail-row" data-closing={closing || undefined} data-instant={instant || undefined}>
          <td colSpan={showTiming ? 5 : 4}>
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
                {timing ? (
                  <p className="request-clock-note">
                    Replay position {formatClock(timing.at)} · Source start {formatClock(timing.sourceAt)}
                    {timing.visible !== undefined ? ` · ${formatDuration(timing.visible)} visible in replay` : ''}
                  </p>
                ) : null}
                <RequestDetail
                  entry={timing?.kind === 'network' ? timing.entry : entry}
                  firstAt={firstAt}
                  unanswered={unanswered}
                  size={size}
                />
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
  const measured = !unanswered && validDuration(entry.duration) && Number.isFinite(entry.at + entry.duration);
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
          {unanswered ? 'No response recorded' : `${entry.status || 'Error'} ${entry.statusText}`.trim()}
        </Fact>
        <Fact label="Method">{entry.method}</Fact>
        <Fact label="Content type">{entry.mimeType ?? '—'}</Fact>
        <Fact label="Size">{size === undefined ? '—' : formatBytes(size)}</Fact>
        <Fact label="Started">{formatClock(entry.at)}</Fact>
        <Fact label="Duration">
          {measured ? `${entry.duration.toFixed(1)} ms` : unanswered ? 'Unknown / incomplete' : 'Invalid / unknown'}
        </Fact>
        <Fact label="Finished">{measured ? formatClock(entry.at + entry.duration) : 'Unknown'}</Fact>
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
