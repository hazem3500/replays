import { SearchIcon, XIcon } from 'lucide-react';
import { IconButton } from '@/components/icon-button.tsx';
import { TrackList, HEADER_HEIGHT, TRAILING_GAP } from './TrackList.tsx';
import { type ReactNode, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { formatClock, type ReplayNetworkEntry } from '../../shared/replay.ts';
import { usePlayer, usePlayhead } from '../player.ts';
import { useMediaQuery } from '../media.ts';
import { countAtOrBefore } from '../timeline.ts';
import { useWindowedRows } from '../windowing.ts';
import { Empty } from './Empty.tsx';
import { relatedPerformanceActivity, type PerformanceModel } from './performance.ts';
import { TimingBar } from './TimingBar.tsx';
import './diagnostic-timing.css';
import { durationLabel, rowDuration, type WaterfallRow } from './waterfall.ts';
import './performance.css';

const DESKTOP_EVENT_HEIGHT = 32;
const TOUCH_EVENT_HEIGHT = 44;
const TOUCH_ROWS_QUERY = '(max-width: 600px), (pointer: coarse)';
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
  const rowHeight = useMediaQuery(TOUCH_ROWS_QUERY) ? TOUCH_EVENT_HEIGHT : DESKTOP_EVENT_HEIGHT;
  const panel = useRef<HTMLElement>(null);
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
  selected,
  onChoose,
  onFocus,
}: {
  rows: readonly WaterfallRow[];
  rowHeight: number;
  selected: string | undefined;
  onChoose: (row: WaterfallRow, element?: HTMLElement) => void;
  onFocus: (element: HTMLElement) => void;
}) {
  const player = usePlayer();
  const ats = useMemo(() => rows.map((row) => row.at), [rows]);
  const reached = usePlayhead((time) => countAtOrBefore(ats, time >= player.duration ? Infinity : time <= 0 ? -1 : time));
  const scroll = useRef<HTMLDivElement>(null);
  const pending = useRef<string | undefined>(undefined);
  const window = useWindowedRows(scroll, { count: rows.length, rowHeight, headerHeight: HEADER_HEIGHT });
  useLayoutEffect(() => {
    if (!pending.current) return;
    const row = scroll.current?.querySelector<HTMLElement>(`[data-performance-id="${pending.current}"]`);
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
      scroller={scroll}
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
            if (scroll.current) scroll.current.scrollTop = Math.max(0, next) * rowHeight;
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
