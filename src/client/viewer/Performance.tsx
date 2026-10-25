import { type PointerEvent as ReactPointerEvent, type ReactNode, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { formatClock, type ReplayNetworkEntry } from '../../shared/replay.ts';
import { usePlayer, usePlayhead } from '../player.ts';
import { useWindowedRows } from '../windowing.ts';
import { Empty } from './Empty.tsx';
import {
  chartLaneRows,
  focusPerformanceWindow,
  missingPerformanceLabel,
  PERFORMANCE_LANES,
  relatedPerformanceActivity,
  type PerformanceModel,
  type PerformanceWindow,
} from './performance.ts';
import { durationLabel, rowDuration, validDuration, type WaterfallRow } from './waterfall.ts';
import './performance.css';

const EVENT_HEIGHT = 44;

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
  const [mode, setMode] = useState<'overview' | 'events'>('overview');
  const [query, setQuery] = useState('');
  const [selection, setSelection] = useState<string>();
  const [zoom, setZoom] = useState<PerformanceWindow>();
  const [relatedLimit, setRelatedLimit] = useState(8);
  const selected = model.rows.find((row) => row.id === selection);
  const selectedId = selected?.id;
  const activity = useMemo(() => (selected ? relatedPerformanceActivity(selected, model.rows) : undefined), [model, selected]);
  const events = useMemo(() => {
    const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    return model.signals.filter((row) => {
      const text = `${row.label} ${row.entry.eventType ?? ''} ${rowDuration(row)}`.toLocaleLowerCase();
      return words.every((word) => text.includes(word));
    });
  }, [model, query]);
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
    else panel.current?.querySelector<HTMLElement>('.perf-mode')?.focus();
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
      <div className="perf-toolbar" role="group" aria-label="Performance view">
        <button className="perf-mode" type="button" aria-pressed={mode === 'overview'} onClick={() => setMode('overview')}>
          Overview
        </button>
        <button className="perf-mode" type="button" aria-pressed={mode === 'events'} onClick={() => setMode('events')}>
          All events ({model.signals.length})
        </button>
      </div>
      <div className="perf-workspace" data-detail-open={selected ? '' : undefined}>
        <div className="perf-main" data-testid="performance-main">
          {mode === 'overview' ? (
            <>
              <div className="perf-summary">
                {[
                  {
                    label: 'Longest recorded task',
                    row: model.longestTask,
                    missing: missingPerformanceLabel(model, 'longtask', 'long-task'),
                  },
                  {
                    label: 'Slowest recorded interaction',
                    row: model.slowestInteraction,
                    missing: missingPerformanceLabel(model, 'event', 'slow-interaction'),
                  },
                  {
                    label: 'Latest largest paint candidate',
                    row: model.largestPaint,
                    missing: missingPerformanceLabel(model, 'largest-contentful-paint', 'largest-contentful-paint'),
                  },
                ].map(({ label, row, missing }) => (
                  <button
                    type="button"
                    className="perf-metric"
                    key={label}
                    disabled={!row}
                    onClick={(event) => row && choose(row, event.currentTarget)}
                  >
                    <span>{label}</span>
                    <strong>{row ? durationLabel(row.measured ?? row.entry.value) : missing}</strong>
                    <small>{row ? (row.measured === undefined ? 'Since navigation' : 'Captured duration') : 'No score inferred'}</small>
                  </button>
                ))}
              </div>
              <div className="perf-chart-tools">
                <span>Shared replay clock</span>
                <button
                  type="button"
                  disabled={!selected}
                  onClick={() => selected && setZoom(focusPerformanceWindow(selected, player.duration))}
                >
                  Zoom to selection
                </button>
                {zoom ? (
                  <button type="button" onClick={() => setZoom(undefined)}>
                    Full recording
                  </button>
                ) : null}
              </div>
              <PerformanceTimeline
                model={model}
                window={zoom ?? { from: 0, to: player.duration }}
                selected={selectedId}
                onChoose={choose}
              />
              <h2 className="perf-heading">Worst recorded moments</h2>
              <p className="perf-note">Ranked by captured duration. Overlapping tasks and interactions are not added into a score.</p>
              <div className="perf-moments">
                {model.moments.slice(0, 6).map((row) => (
                  <EventButton key={row.id} row={row} selected={selectedId} onChoose={choose} />
                ))}
                {!model.moments.length ? <p className="perf-note">No valid task or interaction durations on this timeline.</p> : null}
              </div>
              <p className="perf-note">
                Paints are milestones. Requests with unknown duration show only their start. Values describe captured observations, not a
                complete CPU profile.
              </p>
              {model.invalidTimes ? (
                <p className="perf-note">{model.invalidTimes} events have unusable timestamps and are omitted.</p>
              ) : null}
            </>
          ) : (
            <>
              <label className="perf-search">
                <span className="visually-hidden">Search performance events</span>
                <input
                  type="search"
                  placeholder="Signal, event type, timing…"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <PerformanceEvents
                key={query}
                rows={events}
                selected={selectedId}
                onChoose={choose}
                onFocus={(element) => {
                  opener.current = element;
                }}
              />
            </>
          )}
        </div>
        {selected ? (
          // Keyboard focus makes the independently scrollable evidence pane accessible.
          // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          <section className="perf-detail" ref={detail} aria-label="Selected performance evidence" tabIndex={0}>
            <div className="perf-detail-heading">
              <h2 title={selected.label}>{selected.label}</h2>
              <button type="button" onClick={close}>
                Close details
              </button>
            </div>
            <p className="perf-note">
              Replay position {formatClock(selected.at)} · Source start {formatClock(selected.sourceAt)}
            </p>
            <p>
              {rowDuration(selected)}
              {selected.visible !== undefined ? ` · ${durationLabel(selected.visible)} visible in this replay` : ''}
            </p>
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
  const scroll = useRef<HTMLDivElement>(null);
  const pending = useRef<string | undefined>(undefined);
  const window = useWindowedRows(scroll, { count: rows.length, rowHeight: EVENT_HEIGHT });
  useLayoutEffect(() => {
    if (!pending.current) return;
    const row = scroll.current?.querySelector<HTMLElement>(`[data-performance-id="${pending.current}"]`);
    if (row) {
      row.focus({ preventScroll: true });
      pending.current = undefined;
    }
  });
  return (
    <div className="perf-events" ref={scroll} data-testid="performance-events">
      {!rows.length ? <p className="perf-note">No matching performance events.</p> : null}
      <div style={{ height: window.padTop }} aria-hidden="true" />
      {rows.slice(window.start, window.end).map((row, offset) => (
        <button
          type="button"
          key={row.id}
          className="perf-event"
          data-performance-id={row.id}
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
          <span>
            <strong>
              {row.label}
              {row.kind === 'performance' && row.entry.eventType ? ` · ${row.entry.eventType}` : ''}
            </strong>
            <small>
              {formatClock(row.at)} · {rowDuration(row)}
            </small>
          </span>
        </button>
      ))}
      <div style={{ height: window.padBottom }} aria-hidden="true" />
    </div>
  );
}

function PerformanceTimeline({
  model,
  window,
  selected,
  onChoose,
}: {
  model: PerformanceModel;
  window: PerformanceWindow;
  selected: string | undefined;
  onChoose: (row: WaterfallRow, element?: HTMLElement) => void;
}) {
  const player = usePlayer();
  const time = usePlayhead((current) => current);
  const extent = Math.max(0, window.to - window.from);
  const width = Math.max(1, extent);
  const percent = (value: number) => ((value - window.from) / width) * 100;
  const shown = useMemo(
    () => PERFORMANCE_LANES.map((lane) => ({ ...lane, ...chartLaneRows(model.rows, lane.id, window, selected) })),
    [model, window, selected],
  );
  const omitted = shown.reduce((sum, lane) => sum + lane.omitted, 0);
  const seekAt = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width > 0) player.seek(window.from + Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)) * extent);
  };
  return (
    <>
      <div className="perf-timeline" aria-label="Performance activity on the replay clock">
        <div className="perf-ruler">
          <span>Replay time</span>
          <div
            className="perf-axis"
            role="slider"
            tabIndex={0}
            aria-orientation="horizontal"
            aria-label="Performance replay playhead"
            aria-valuemin={window.from}
            aria-valuemax={window.to}
            aria-valuenow={Math.max(window.from, Math.min(window.to, time))}
            aria-valuetext={`${formatClock(time)}${time < window.from || time > window.to ? ', outside zoomed window' : ''}`}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              seekAt(event);
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) seekAt(event);
            }}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onKeyDown={(event) => {
              const next =
                event.key === 'ArrowRight'
                  ? time + 100
                  : event.key === 'ArrowLeft'
                    ? time - 100
                    : event.key === 'Home'
                      ? window.from
                      : event.key === 'End'
                        ? window.to
                        : undefined;
              if (next === undefined) return;
              event.preventDefault();
              player.seek(Math.max(window.from, Math.min(window.to, next)));
            }}
          >
            {[0, 0.25, 0.5, 0.75, 1].map((part) => (
              <span key={part} className="perf-tick" style={{ left: `${part * 100}%` }}>
                {formatClock(window.from + extent * part)}
              </span>
            ))}
            {time >= window.from && time <= window.to ? (
              <span className="perf-playhead" data-testid="performance-playhead" style={{ left: `${percent(time)}%` }} />
            ) : null}
          </div>
        </div>
        {shown.map((lane) => (
          <div className="perf-track" key={lane.id} data-lane={lane.id}>
            <span title={lane.label}>{lane.label}</span>
            <div className="perf-lane">
              {lane.rows.map((row) =>
                row.segments.length ? (
                  row.segments.map((segment, index) => {
                    const from = Math.max(window.from, segment.from),
                      to = Math.min(window.to, segment.to);
                    return to > from ? (
                      <button
                        type="button"
                        key={`${row.id}-${index}`}
                        className="perf-span"
                        data-performance-id={row.id}
                        aria-expanded={selected === row.id}
                        aria-label={`${row.label}, ${formatClock(row.at)}, ${rowDuration(row)}`}
                        title={`${row.label} · ${rowDuration(row)}`}
                        style={{ left: `${percent(from)}%`, width: `${((to - from) / width) * 100}%` }}
                        onClick={(event) => onChoose(row, event.currentTarget)}
                      />
                    ) : null;
                  })
                ) : (
                  <button
                    type="button"
                    key={row.id}
                    className="perf-point"
                    data-unknown={
                      row.timing === 'invalid' ||
                      row.timing === 'incomplete' ||
                      (row.kind === 'performance' && !validDuration(row.entry.value))
                        ? ''
                        : undefined
                    }
                    data-performance-id={row.id}
                    aria-expanded={selected === row.id}
                    aria-label={`${row.label}, ${formatClock(row.at)}, ${rowDuration(row)}`}
                    title={`${row.label} · ${rowDuration(row)}`}
                    style={{ left: `${percent(row.at)}%` }}
                    onClick={(event) => onChoose(row, event.currentTarget)}
                  />
                ),
              )}
            </div>
          </div>
        ))}
      </div>
      <p className="perf-note">
        Drag the ruler or blue line to scrub. Bars show measured spans; diamonds are paint milestones.{' '}
        {omitted ? `${omitted} marks omitted in this view; zoom or use All events and related details.` : ''}
      </p>
    </>
  );
}
