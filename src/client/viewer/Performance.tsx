import { SearchIcon, XIcon } from 'lucide-react';
import { IconButton } from '@/components/icon-button.tsx';
import { TrackList, HEADER_HEIGHT, TRAILING_GAP } from './TrackList.tsx';
import { type ReactNode, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { formatClock, type ReplayNetworkEntry } from '../../shared/replay.ts';
import { usePlayer, usePlayhead } from '../player.ts';
import { countAtOrBefore } from '../timeline.ts';
import { useWindowedRows } from '../windowing.ts';
import { Empty } from './Empty.tsx';
import { relatedPerformanceActivity, type PerformanceModel } from './performance.ts';
import { TimingBar } from './TimingBar.tsx';
import './diagnostic-timing.css';
import { durationLabel, rowDuration, type WaterfallRow } from './waterfall.ts';
import './performance.css';

const EVENT_HEIGHT = 44;
const EVENT_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'long-task', label: 'Tasks' },
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
              <h2 title={selected.label}>{selected.label}</h2>
              <IconButton label="Close details" onClick={close}>
                <XIcon aria-hidden="true" />
              </IconButton>
            </div>
            <p className="perf-note">
              Replay position {formatClock(selected.at)} · Source start {formatClock(selected.sourceAt)}
            </p>
            <p>
              {rowDuration(selected)}
              {selected.visible !== undefined ? ` · ${durationLabel(selected.visible)} visible in this replay` : ''}
            </p>
            <TimingBar row={selected} duration={player.duration} />
            {selected.kind === 'performance' ? (
              <p className="perf-note">
                {selected.entry.kind === 'long-task'
                  ? 'A recorded main-thread task. No JavaScript stack or script attribution was captured.'
                  : selected.entry.kind === 'slow-interaction'
                    ? `Recorded ${selected.entry.eventType ?? 'interaction'} duration. Input, processing and presentation phases were not captured; this is not an INP score.`
                    : 'A captured paint milestone measured from navigation, not a task duration or final Web Vitals score. No element/resource attribution was captured.'}
              </p>
            ) : selected.kind === 'network' ? (
              renderRequestDetail(selected.entry)
            ) : (
              <p className="perf-note">Action point event; no action duration was captured.</p>
            )}
            <details className="perf-raw">
              <summary>Captured event data</summary>
              <pre>{JSON.stringify(selected.entry, null, 2)}</pre>
            </details>
            <h3>Observed during this event</h3>
            <p className="perf-note">
              Overlapping recorded spans or event starts. These observations do not establish the cause of a delay.
            </p>
            {activity?.overlapping.slice(0, relatedLimit).map((row) => (
              <EventButton key={row.id} row={row} onChoose={choose} />
            ))}
            {!activity?.overlapping.length ? <p className="perf-note">No overlapping activity was captured on this timeline.</p> : null}
            {(activity?.overlapping.length ?? 0) > relatedLimit ? (
              <button type="button" onClick={() => setRelatedLimit((limit) => limit + 8)}>
                Show more related events ({activity!.overlapping.length - relatedLimit})
              </button>
            ) : null}
            {activity?.nearbyActions.length ? (
              <>
                <h3>Nearby actions</h3>
                <p className="perf-note">Within 500 ms of the captured source start.</p>
                {activity.nearbyActions.slice(0, relatedLimit).map((row) => (
                  <EventButton key={row.id} row={row} onChoose={choose} />
                ))}
                {activity.nearbyActions.length > relatedLimit ? (
                  <button type="button" onClick={() => setRelatedLimit((limit) => limit + 8)}>
                    Show more nearby actions ({activity.nearbyActions.length - relatedLimit})
                  </button>
                ) : null}
              </>
            ) : null}
          </section>
        ) : null}
      </div>
    </section>
  );
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
      className="perf-event"
      data-performance-id={row.id}
      aria-expanded={selected === row.id}
      onClick={(event) => onChoose(row, event.currentTarget)}
    >
      <span>
        <strong>{row.label}</strong>
        <small>
          {formatClock(row.at)} · {rowDuration(row)}
        </small>
      </span>
    </button>
  );
}

function PerformanceEvents({
  rows,
  selected,
  onChoose,
  onFocus,
}: {
  rows: readonly WaterfallRow[];
  selected: string | undefined;
  onChoose: (row: WaterfallRow, element?: HTMLElement) => void;
  onFocus: (element: HTMLElement) => void;
}) {
  const player = usePlayer();
  const ats = useMemo(() => rows.map((row) => row.at), [rows]);
  const reached = usePlayhead((time) => countAtOrBefore(ats, time >= player.duration ? Infinity : time <= 0 ? -1 : time));
  const scroll = useRef<HTMLDivElement>(null);
  const pending = useRef<string | undefined>(undefined);
  const window = useWindowedRows(scroll, { count: rows.length, rowHeight: EVENT_HEIGHT, headerHeight: HEADER_HEIGHT });
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
      rowHeight={EVENT_HEIGHT}
      ats={ats}
      scroller={scroll}
    >
      {!rows.length ? <p className="perf-note">No matching performance events.</p> : null}
      <div className="perf-event-columns" aria-hidden="true">
        <span>Event</span>
        <span>Replay time</span>
        <span>Captured value</span>
        <span>Timing</span>
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
            if (scroll.current) scroll.current.scrollTop = Math.max(0, next) * EVENT_HEIGHT;
            onChoose(target);
          }}
        >
          <span className="perf-event-name">
            <strong>
              {row.label}
              {row.kind === 'performance' && row.entry.eventType ? ` · ${row.entry.eventType}` : ''}
            </strong>
            <small>
              {row.kind === 'performance' && row.entry.kind.includes('paint') ? 'Paint milestone' : 'Captured duration'}
              {window.start + offset >= reached ? ' · Upcoming' : ''}
            </small>
          </span>
          <span className="perf-event-time">{formatClock(row.at)}</span>
          <span className="perf-event-value">{rowDuration(row)}</span>
          <TimingBar row={row} duration={player.duration} />
        </button>
      ))}
      <div style={{ height: window.padBottom + TRAILING_GAP }} aria-hidden="true" />
    </TrackList>
  );
}
