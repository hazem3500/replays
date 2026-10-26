import { SearchIcon, XIcon } from 'lucide-react';
import { IconButton } from '@/components/icon-button.tsx';
import { TrackList, HEADER_HEIGHT, TRAILING_GAP } from './TrackList.tsx';
import { type ReactNode, type RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { formatClock, type ReplayNetworkEntry } from '../../shared/replay.ts';
import { usePlayer, usePlayhead } from '../player.ts';
import { countAtOrBefore } from '../timeline.ts';
import { windowRange } from '../windowing.ts';
import { Empty } from './Empty.tsx';
import { relatedPerformanceActivity, type PerformanceModel } from './performance.ts';
import { TimingBar } from './TimingBar.tsx';
import './diagnostic-timing.css';
import { durationLabel, rowDuration, type WaterfallRow } from './waterfall.ts';
import './performance.css';

const DESKTOP_EVENT_HEIGHT = 32;
const TOUCH_EVENT_HEIGHT = 44;
const TOUCH_ROWS_QUERY = '(max-width: 600px), (pointer: coarse)';
interface PerformanceResizeAnchor {
  token: number;
  id?: string;
  index: number;
  scrollTop: number;
  focusedElement?: HTMLButtonElement;
}
const EVENT_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'long-task', label: 'Long tasks' },
  { id: 'slow-interaction', label: 'Interactions' },
  { id: 'paint', label: 'Paints' },
] as const;
type EventFilter = (typeof EVENT_FILTERS)[number]['id'];

export function PerformanceDiagnostics({
  model,
  renderRequestDetail,
}: {
  model: PerformanceModel;
  renderRequestDetail: (entry: ReplayNetworkEntry) => ReactNode;
}) {
  const player = usePlayer();
  const [touchRows, setTouchRows] = useState(() => matchMedia(TOUCH_ROWS_QUERY).matches);
  const rowHeight = touchRows ? TOUCH_EVENT_HEIGHT : DESKTOP_EVENT_HEIGHT;
  const panel = useRef<HTMLElement>(null);
  const eventsScroller = useRef<HTMLDivElement>(null);
  const resizeToken = useRef(0);
  const [resizeAnchor, setResizeAnchor] = useState<PerformanceResizeAnchor>();
  const previousTouchRows = useRef(touchRows);
  const onResizeAnchorApplied = useCallback(
    (token: number) => setResizeAnchor((current) => (current?.token === token ? undefined : current)),
    [],
  );
  const opener = useRef<HTMLElement | null>(null);
  const detail = useRef<HTMLElement>(null);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [filter, setFilter] = useState<EventFilter>('all');
  const search = useRef<HTMLInputElement>(null);
  const [selection, setSelection] = useState<string>();
  const [relatedLimit, setRelatedLimit] = useState(8);
  const selected = model.rows.find((row) => row.id === selection);
  const selectedId = selected?.id;
  const activity = useMemo(() => (selected ? relatedPerformanceActivity(selected, model.rows) : undefined), [model, selected]);
  const events = useMemo(() => {
    const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    return model.signals.filter((row) => {
      const text = `${row.label} ${row.entry.eventType ?? ''} ${rowDuration(row)}`.toLocaleLowerCase();
      const matchesKind = filter === 'all' || (filter === 'paint' ? row.entry.kind.includes('paint') : row.entry.kind === filter);
      return matchesKind && words.every((word) => text.includes(word));
    });
  }, [model, query, filter]);
  useEffect(() => {
    const media = matchMedia(TOUCH_ROWS_QUERY);
    const captureResizeAnchor = () => {
      if (media.matches === previousTouchRows.current) return;
      const element = eventsScroller.current;
      if (element) {
        const scrollerBox = element.getBoundingClientRect();
        const active = element.ownerDocument.activeElement;
        const focused = active instanceof HTMLButtonElement ? active.closest<HTMLButtonElement>('[data-performance-id]') : null;
        const focusedId = focused && element.contains(focused) ? focused.dataset.performanceId : undefined;
        let id = focusedId;
        let screenTop = focused ? focused.getBoundingClientRect().top - scrollerBox.top : Number.NaN;
        if (!id) {
          const visible = [...element.querySelectorAll<HTMLButtonElement>('[data-performance-id]')].find((row) => {
            const box = row.getBoundingClientRect();
            return box.bottom > scrollerBox.top + HEADER_HEIGHT && box.top < scrollerBox.bottom;
          });
          id = visible?.dataset.performanceId;
          if (visible) screenTop = visible.getBoundingClientRect().top - scrollerBox.top;
        }
        let index = events.findIndex((row) => row.id === id);
        const oldHeight = previousTouchRows.current ? TOUCH_EVENT_HEIGHT : DESKTOP_EVENT_HEIGHT;
        if (index < 0 && events.length) {
          const contentTop = Math.max(0, element.scrollTop - HEADER_HEIGHT);
          index = Math.min(events.length - 1, Math.floor(contentTop / oldHeight));
          id = events[index]?.id;
          screenTop = HEADER_HEIGHT + index * oldHeight - element.scrollTop;
        }
        const nextHeight = media.matches ? TOUCH_EVENT_HEIGHT : DESKTOP_EVENT_HEIGHT;
        if (index >= 0 && Number.isFinite(screenTop)) {
          setResizeAnchor({
            token: ++resizeToken.current,
            ...(id ? { id } : {}),
            index,
            scrollTop: Math.max(0, HEADER_HEIGHT + index * nextHeight - screenTop),
            ...(focusedId ? { focusedElement: focused! } : {}),
          });
        }
      }
      previousTouchRows.current = media.matches;
      setTouchRows(media.matches);
    };
    media.addEventListener('change', captureResizeAnchor);
    // Catch a breakpoint change between the initial render and effect setup.
    captureResizeAnchor();
    return () => media.removeEventListener('change', captureResizeAnchor);
  }, [events]);
  const choose = (row: WaterfallRow, element?: HTMLElement) => {
    if (element) opener.current = element;
    if (row.id !== selectedId) {
      setRelatedLimit(8);
      if (detail.current) detail.current.scrollTop = 0;
    }
    setSelection(row.id);
    player.seek(row.at);
  };
  const close = () => {
    setSelection(undefined);
    if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
    else panel.current?.querySelector<HTMLElement>('input, .perf-filter')?.focus();
  };

  if (!model.track) return <Empty title="Performance wasn’t recorded">This replay has no captured browser timing track.</Empty>;
  if (!model.signals.length)
    return (
      <Empty title={model.track.supported.length ? 'No performance signals on this timeline' : 'Performance APIs unavailable'}>
        {model.track.entries.length
          ? 'Captured signals are outside the kept recording or have unusable timestamps.'
          : 'No timing signals were captured. Missing observations do not establish that the page was fast.'}
      </Empty>
    );

  return (
    // Handles Escape and shields diagnostic controls from the viewer's global playback shortcuts.
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <section
      ref={panel}
      className="performance-diagnostics"
      data-row-height={rowHeight}
      aria-label="Performance diagnosis"
      data-testid="performance-diagnostics"
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape' && selected) {
          event.preventDefault();
          close();
        }
      }}
    >
      <div className="perf-toolbar">
        {searchOpen ? (
          <label className="perf-search">
            <SearchIcon aria-hidden="true" />
            <span className="visually-hidden">Search performance events</span>
            <input
              ref={search}
              type="search"
              placeholder="Search events…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        ) : (
          <div className="perf-filters" role="group" aria-label="Performance event types">
            {EVENT_FILTERS.map(({ id, label }) => (
              <button key={id} type="button" className="perf-filter" aria-pressed={filter === id} onClick={() => setFilter(id)}>
                {label}
              </button>
            ))}
          </div>
        )}
        <IconButton
          className="perf-search-toggle"
          label={searchOpen ? 'Close event search' : 'Search performance events'}
          aria-expanded={searchOpen}
          onClick={() => {
            setSearchOpen((open) => !open);
            if (searchOpen) setQuery('');
            else requestAnimationFrame(() => search.current?.focus());
          }}
        >
          {searchOpen ? <XIcon aria-hidden="true" /> : <SearchIcon aria-hidden="true" />}
        </IconButton>
      </div>
      <div className="perf-workspace" data-detail-open={selected ? '' : undefined}>
        <div className="perf-main" data-testid="performance-main">
          <PerformanceEvents
            key={`${query}:${filter}`}
            rows={events}
            rowHeight={rowHeight}
            scroller={eventsScroller}
            resizeAnchor={resizeAnchor}
            onResizeAnchorApplied={onResizeAnchorApplied}
            selected={selectedId}
            onChoose={choose}
            onFocus={(element) => {
              opener.current = element;
            }}
          />
        </div>
        {selected ? (
          // Keyboard focus makes the independently scrollable evidence pane accessible.
          // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          <section className="perf-detail" ref={detail} aria-label="Selected performance evidence" tabIndex={0}>
            <div className="perf-detail-heading">
              <h2 title={eventName(selected)}>{eventName(selected)}</h2>
              <IconButton label="Close details" onClick={close}>
                <XIcon aria-hidden="true" />
              </IconButton>
            </div>
            <dl className="perf-facts">
              <div>
                <dt>
                  {selected.kind === 'action' ? 'Event timing' : selected.timing === 'point' ? 'Since navigation' : 'Captured duration'}
                </dt>
                <dd>{eventValue(selected)}</dd>
              </div>
              <div>
                <dt>Replay time</dt>
                <dd title={`${selected.at} ms`}>{formatClock(selected.at)}</dd>
              </div>
            </dl>
            {selected.sourceAt !== selected.at || (selected.visible !== undefined && selected.visible !== selected.measured) ? (
              <p className="perf-edit-note">
                Source time <time title={`${selected.sourceAt} ms`}>{formatClock(selected.sourceAt)}</time>
                {selected.visible !== undefined ? ` · ${durationLabel(selected.visible)} kept in replay` : ''}
              </p>
            ) : null}
            {selected.kind === 'performance' ? (
              <p className="perf-note">
                {selected.entry.kind === 'long-task'
                  ? 'Script and stack attribution were not recorded.'
                  : selected.entry.kind === 'slow-interaction'
                    ? 'Time from input to the next paint. A phase breakdown was not recorded.'
                    : 'Paint milestone since navigation, not a task duration. The painted element was not recorded.'}
              </p>
            ) : selected.kind === 'network' ? (
              renderRequestDetail(selected.entry)
            ) : (
              <p className="perf-note">Action point event; no action duration was captured.</p>
            )}
            {activity?.overlapping.length ? (
              <h3>
                At the same time <span>{activity.overlapping.length}</span>
              </h3>
            ) : null}
            {activity?.overlapping.slice(0, relatedLimit).map((row) => (
              <EventButton key={row.id} row={row} onChoose={choose} />
            ))}
            {(activity?.overlapping.length ?? 0) > relatedLimit ? (
              <button type="button" className="perf-more" onClick={() => setRelatedLimit((limit) => limit + 8)}>
                Show more related events ({activity!.overlapping.length - relatedLimit})
              </button>
            ) : null}
            {activity?.nearbyActions.length ? (
              <>
                <h3>
                  Nearby actions <span>{activity.nearbyActions.length}</span>
                </h3>
                {activity.nearbyActions.slice(0, relatedLimit).map((row) => (
                  <EventButton key={row.id} row={row} onChoose={choose} />
                ))}
                {activity.nearbyActions.length > relatedLimit ? (
                  <button type="button" className="perf-more" onClick={() => setRelatedLimit((limit) => limit + 8)}>
                    Show more nearby actions ({activity.nearbyActions.length - relatedLimit})
                  </button>
                ) : null}
              </>
            ) : null}
            {activity && !activity.overlapping.length && !activity.nearbyActions.length ? (
              <p className="perf-note perf-no-related">No related events captured here.</p>
            ) : null}
            <details className="perf-raw">
              <summary>Recording details</summary>
              <p className="perf-note">
                Source time {formatClock(selected.sourceAt)}
                {selected.visible !== undefined ? ` · ${durationLabel(selected.visible)} kept in replay` : ''}. Concurrent events are
                context, not proof of a cause.
              </p>
              <p className="perf-note">
                Interaction observations are not an INP score; paint candidates are not final Web Vitals scores. Nearby actions are within
                500 ms of the source start.
              </p>
              <pre>{JSON.stringify(selected.entry, null, 2)}</pre>
            </details>
          </section>
        ) : null}
      </div>
    </section>
  );
}

function eventName(row: WaterfallRow) {
  return `${row.label}${row.kind === 'performance' && row.entry.eventType ? ` · ${row.entry.eventType}` : ''}`;
}

function eventValue(row: WaterfallRow) {
  if (row.kind === 'action') return 'Point event';
  if (row.timing === 'incomplete') return 'Unknown';
  if (row.measured !== undefined) return durationLabel(row.measured);
  if (row.kind === 'performance' && row.timing === 'point' && Number.isFinite(row.entry.value) && row.entry.value >= 0)
    return durationLabel(row.entry.value);
  return 'Unknown';
}

function EventButton({
  row,
  selected,
  onChoose,
}: {
  row: WaterfallRow;
  selected?: string | undefined;
  onChoose: (row: WaterfallRow, element?: HTMLElement) => void;
}) {
  return (
    <button
      type="button"
      className="perf-event perf-related"
      data-performance-id={row.id}
      aria-expanded={selected === row.id}
      onClick={(event) => onChoose(row, event.currentTarget)}
    >
      <span>
        <strong title={eventName(row)}>{eventName(row)}</strong>
        <small>
          {formatClock(row.at)} · {rowDuration(row)}
        </small>
      </span>
    </button>
  );
}

function PerformanceEvents({
  rows,
  rowHeight,
  scroller,
  resizeAnchor,
  onResizeAnchorApplied,
  selected,
  onChoose,
  onFocus,
}: {
  rows: readonly WaterfallRow[];
  rowHeight: number;
  scroller: RefObject<HTMLDivElement | null>;
  resizeAnchor: PerformanceResizeAnchor | undefined;
  onResizeAnchorApplied: (token: number) => void;
  selected: string | undefined;
  onChoose: (row: WaterfallRow, element?: HTMLElement) => void;
  onFocus: (element: HTMLElement) => void;
}) {
  const player = usePlayer();
  const ats = useMemo(() => rows.map((row) => row.at), [rows]);
  const reached = usePlayhead((time) => countAtOrBefore(ats, time >= player.duration ? Infinity : time <= 0 ? -1 : time));
  const pending = useRef<string | undefined>(undefined);
  const window = usePerformanceWindowedRows(scroller, rows.length, rowHeight, resizeAnchor, onResizeAnchorApplied);
  useLayoutEffect(() => {
    if (!pending.current) return;
    const row = scroller.current?.querySelector<HTMLElement>(`[data-performance-id="${pending.current}"]`);
    if (row) {
      row.focus({ preventScroll: true });
      pending.current = undefined;
    }
  });
  return (
    <TrackList
      testId="performance-events"
      scrollClassName="perf-events"
      reached={reached}
      total={rows.length}
      rowHeight={rowHeight}
      ats={ats}
      scroller={scroller}
    >
      {!rows.length ? <p className="perf-note">No matching performance events.</p> : null}
      <div className="perf-event-columns" aria-hidden="true">
        <span>Event</span>
        <span className="perf-replay-heading">
          <span className="perf-replay-wide">Replay time</span>
          <span className="perf-replay-compact">Time</span>
        </span>
        <span className="perf-value-heading">Timing</span>
        <span className="perf-timing-heading">
          Recording <span>{formatClock(player.duration)}</span>
        </span>
      </div>
      <div style={{ height: window.padTop }} aria-hidden="true" />
      {rows.slice(window.start, window.end).map((row, offset) => (
        <button
          type="button"
          key={row.id}
          className="perf-event"
          data-performance-id={row.id}
          data-future={window.start + offset >= reached || undefined}
          aria-expanded={selected === row.id}
          onClick={(event) => onChoose(row, event.currentTarget)}
          onFocus={(event) => onFocus(event.currentTarget)}
          onKeyDown={(event) => {
            const index = window.start + offset;
            const next =
              event.key === 'ArrowDown'
                ? index + 1
                : event.key === 'ArrowUp'
                  ? index - 1
                  : event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? rows.length - 1
                      : undefined;
            if (next === undefined) return;
            event.preventDefault();
            const target = rows[Math.max(0, Math.min(rows.length - 1, next))];
            if (!target) return;
            pending.current = target.id;
            if (scroller.current) scroller.current.scrollTop = Math.max(0, next) * rowHeight;
            onChoose(target);
          }}
        >
          <span className="perf-event-name" data-kind={row.kind === 'performance' ? row.entry.kind : undefined}>
            <span className="perf-kind-dot" aria-hidden="true" />
            <strong title={eventName(row)}>{eventName(row)}</strong>
          </span>
          <span className="perf-event-time">
            {formatClock(row.at)}
            {window.start + offset >= reached ? <span className="visually-hidden"> · Upcoming</span> : null}
          </span>
          <span className="perf-event-value" title={rowDuration(row)}>
            {eventValue(row)}
            {row.timing === 'point' ? <span className="perf-nav-label"> nav.</span> : null}
          </span>
          <TimingBar row={row} duration={player.duration} />
        </button>
      ))}
      <div style={{ height: window.padBottom + TRAILING_GAP }} aria-hidden="true" />
    </TrackList>
  );
}

/** Keep Performance's logical row and any focused row mounted while its responsive height changes. */
function usePerformanceWindowedRows(
  container: RefObject<HTMLDivElement | null>,
  count: number,
  rowHeight: number,
  anchor: PerformanceResizeAnchor | undefined,
  onAnchorApplied: (token: number) => void,
) {
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 600 });
  const scrollTop = anchor?.scrollTop ?? viewport.scrollTop;

  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      setViewport((current) =>
        current.scrollTop === element.scrollTop && current.height === element.clientHeight
          ? current
          : { scrollTop: element.scrollTop, height: element.clientHeight },
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
  }, [container]);

  useLayoutEffect(() => {
    if (!anchor) return;
    const element = container.current;
    if (!element) return;
    // The corrected range is already rendered from anchor.scrollTop, so this sync keeps the DOM scroller in
    // step before paint without unmounting its focused row. This ref owns the list's scroll position.
    // oxlint-disable-next-line react/immutability
    element.scrollTop = anchor.scrollTop;
    const frame = requestAnimationFrame(() => {
      setViewport({ scrollTop: element.scrollTop, height: element.clientHeight });
      const document = element.ownerDocument;
      if (anchor.focusedElement && !anchor.focusedElement.isConnected && document.activeElement === document.body && anchor.id) {
        [...element.querySelectorAll<HTMLElement>('[data-performance-id]')]
          .find((row) => row.dataset.performanceId === anchor.id)
          ?.focus({ preventScroll: true });
      }
      onAnchorApplied(anchor.token);
    });
    return () => cancelAnimationFrame(frame);
  }, [anchor, container, onAnchorApplied]);

  return windowRange({
    scrollTop: scrollTop - HEADER_HEIGHT,
    viewportHeight: viewport.height,
    count,
    rowHeight,
  });
}
