import { type ReactNode, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { EditTimeline } from '../../shared/edits.ts';
import { formatClock, type ReplayBundle, type ReplayNetworkEntry } from '../../shared/replay.ts';
import { usePlayer, usePlayhead } from '../player.ts';
import { useWindowedRows } from '../windowing.ts';
import {
  buildWaterfall,
  durationLabel,
  filterWaterfall,
  performanceHasDuration,
  rowDuration,
  validDuration,
  type WaterfallKind,
  type WaterfallRow,
  type WaterfallState,
} from './waterfall.ts';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '../components/ui/popover.tsx';
import './waterfall.css';

const ROW_HEIGHT = 44;
const RULER_HEIGHT = 52;

/** Diagnostics on the same clock and controller as the replay. Source data is essential: edits can
 * remove a request's start while leaving part of its measured span visible.
 */
export function Waterfall({
  bundle,
  timeline,
  renderRequestDetail,
  onNetworkSelection,
}: {
  bundle: ReplayBundle;
  timeline?: EditTimeline | undefined;
  renderRequestDetail: (entry: ReplayNetworkEntry) => ReactNode;
  onNetworkSelection: (id: string) => void;
}) {
  const player = usePlayer();
  const id = useId();
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<WaterfallKind | 'all'>('all');
  const [state, setState] = useState<WaterfallState>('all');
  const [selection, setSelection] = useState<string>();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const detail = useRef<HTMLElement>(null);
  const pendingFocus = useRef<string | undefined>(undefined);
  const scroller = useRef<HTMLDivElement>(null);
  const model = useMemo(() => buildWaterfall(bundle, timeline), [bundle, timeline]);
  const rows = useMemo(() => filterWaterfall(model.rows, query, kind, state), [model, query, kind, state]);
  const selected = rows.find((row) => row.id === selection);
  const selectedId = selected?.id;
  const activeFilters = Number(kind !== 'all') + Number(state !== 'all');
  useLayoutEffect(() => {
    if (selectedId && detail.current) detail.current.scrollTop = 0;
  }, [selectedId]);
  const window = useWindowedRows(scroller, { count: rows.length, rowHeight: ROW_HEIGHT, headerHeight: RULER_HEIGHT });
  const duration = player.duration;
  const percent = (time: number) => `${Math.max(0, Math.min(100, (time / duration) * 100))}%`;
  const choose = (row: WaterfallRow) => {
    setSelection(row.id);
    player.seek(row.at);
    if (row.kind === 'network') onNetworkSelection(row.entry.id);
  };
  useLayoutEffect(() => {
    if (!pendingFocus.current) return;
    const target = scroller.current?.querySelector<HTMLButtonElement>(`[data-waterfall-id="${pendingFocus.current}"]`);
    if (target) {
      target.focus({ preventScroll: true });
      pendingFocus.current = undefined;
    }
  });
  const focusRow = (index: number) => {
    const row = rows[index];
    if (!row) return;
    pendingFocus.current = row.id;
    const element = scroller.current;
    if (element) {
      const top = index * ROW_HEIGHT;
      if (top < element.scrollTop || top + ROW_HEIGHT > element.scrollTop + element.clientHeight - RULER_HEIGHT) element.scrollTop = top;
    }
  };
  const move = (index: number) => {
    const row = rows[index];
    if (!row) return;
    focusRow(index);
    choose(row);
  };
  const close = () => {
    if (selected) focusRow(rows.indexOf(selected));
    setSelection(undefined);
  };

  return (
    // Delegates keys from contained controls and detail links; the region itself is not a tab stop.
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <section
      aria-label="Replay waterfall"
      className="waterfall"
      data-testid="waterfall-panel"
      onKeyDown={(event) => {
        // The viewer's global arrows/Space must not also seek or toggle playback while using controls.
        event.stopPropagation();
        if (event.key === 'Escape' && selected) {
          event.preventDefault();
          close();
        }
      }}
    >
      <div className="wf-tools">
        <label className="wf-search" htmlFor={`${id}-search`}>
          <span className="visually-hidden">Search</span>
          <input
            id={`${id}-search`}
            type="search"
            placeholder="URL, action, signal…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              if (scroller.current) scroller.current.scrollTop = 0;
            }}
          />
        </label>
        <Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
          <PopoverTrigger render={<button type="button" className="wf-clear" data-testid="waterfall-filters" />}>
            Filters{activeFilters ? ` (${activeFilters})` : ''}
          </PopoverTrigger>
          <PopoverContent
            className="wf-filter-popover"
            align="end"
            aria-label="Waterfall filters and timing"
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Escape') {
                event.preventDefault();
                setFiltersOpen(false);
              }
            }}
          >
            <PopoverTitle>Filters &amp; timing</PopoverTitle>
            <div className="wf-filter-controls">
              <label>
                Track
                <select
                  aria-label="Waterfall track"
                  value={kind}
                  onChange={(event) => {
                    setKind(event.target.value as WaterfallKind | 'all');
                    if (scroller.current) scroller.current.scrollTop = 0;
                  }}
                >
                  <option value="all">All tracks</option>
                  <option value="network">Network</option>
                  <option value="action">Actions</option>
                  <option value="performance">Performance</option>
                </select>
              </label>
              <label>
                State
                <select
                  aria-label="Waterfall state"
                  value={state}
                  onChange={(event) => {
                    setState(event.target.value as WaterfallState);
                    if (scroller.current) scroller.current.scrollTop = 0;
                  }}
                >
                  <option value="all">All events</option>
                  <option value="failed">Failed requests</option>
                  <option value="slow">Slow requests ≥500 ms</option>
                  <option value="incomplete">Incomplete requests</option>
                  <option value="invalid">Invalid / unknown duration</option>
                </select>
              </label>
              <button
                type="button"
                className="wf-clear"
                disabled={!query && kind === 'all' && state === 'all'}
                onClick={() => {
                  setQuery('');
                  setKind('all');
                  setState('all');
                  if (scroller.current) scroller.current.scrollTop = 0;
                }}
              >
                Clear filters
              </button>
            </div>
            <p className="wf-note">
              {timeline ? 'Edited replay clock' : 'Replay clock'} · Bars show visible elapsed time; labels show measured source duration.
              Actions and paints are points. ↑/↓ selects and seeks; Escape closes details.
            </p>
            {model.invalidTimes ? <p className="wf-note">{model.invalidTimes} invalid timestamps omitted</p> : null}
          </PopoverContent>
        </Popover>
        <span
          className="wf-count"
          role="status"
          aria-label={`${rows.length} of ${model.rows.length} events`}
          title={`${rows.length} of ${model.rows.length} events`}
        >
          {rows.length}/{model.rows.length}
        </span>
      </div>
      <div className="wf-workspace" data-detail-open={Boolean(selected) || undefined}>
        <div className="wf-scroll" ref={scroller} data-testid="waterfall-scroll">
          <div className="wf-chart">
            <div className="wf-ruler">
              <span className="wf-heading">{timeline ? 'Edited replay clock' : 'Replay clock'}</span>
              <div className="wf-clock">
                <div className="wf-ticks" aria-hidden="true">
                  {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
                    <span key={fraction} style={{ left: percent(duration * fraction) }}>
                      {formatClock(duration * fraction)}
                    </span>
                  ))}
                </div>
                <WaterfallSeek />
              </div>
            </div>
            <div className="wf-body" style={{ height: rows.length * ROW_HEIGHT }}>
              <WaterfallPlayhead />
              <div style={{ height: window.padTop }} aria-hidden="true" />
              {rows.slice(window.start, window.end).map((row, offset) => {
                const index = window.start + offset;
                return (
                  <button
                    type="button"
                    key={row.id}
                    className="wf-row"
                    data-waterfall-id={row.id}
                    data-kind={row.kind}
                    data-failed={row.failed || undefined}
                    data-slow={row.slow || undefined}
                    aria-label={`${row.label}, ${row.kind === 'network' ? `${row.failed ? 'Failed, ' : ''}${row.entry.status || 'No response'}, ` : ''}${rowDuration(row)}, seek ${formatClock(row.at)}`}
                    aria-expanded={selected?.id === row.id}
                    aria-controls={`${id}-detail`}
                    onClick={() => choose(row)}
                    onKeyDown={(event) => {
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
                      if (next !== undefined) {
                        event.preventDefault();
                        event.stopPropagation();
                        move(Math.max(0, Math.min(rows.length - 1, next)));
                      }
                    }}
                  >
                    <span className="wf-label" title={`${row.label} · ${rowDuration(row)}`}>
                      <span className="wf-name">
                        {row.kind === 'network' ? (
                          <span className="wf-state">
                            {row.failed ? 'Failed' : row.timing === 'incomplete' ? 'Incomplete' : row.entry.status}
                            {row.slow ? ' · Slow' : ''}
                          </span>
                        ) : (
                          <span className="wf-state">{row.kind === 'action' ? 'Action' : 'Performance'}</span>
                        )}{' '}
                        {row.label}
                      </span>
                      <span className="wf-duration">{rowDuration(row)}</span>
                    </span>
                    <span className="wf-lane" aria-hidden="true">
                      {row.segments.length ? (
                        row.segments.map((segment, n) => (
                          <span
                            key={n}
                            className="wf-span"
                            style={{ left: percent(segment.from), width: `${((segment.to - segment.from) / duration) * 100}%` }}
                          />
                        ))
                      ) : (
                        <span
                          className="wf-point"
                          data-unknown={row.timing === 'invalid' || row.timing === 'incomplete' || undefined}
                          style={{ left: percent(row.at) }}
                        />
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
            {!rows.length ? (
              <p className="wf-empty">
                {model.rows.length
                  ? 'No matching events. Clear filters to see all captured events.'
                  : 'No timed events in this replay. Older or imported recordings may not include network or performance data.'}
              </p>
            ) : null}
          </div>
        </div>
        <section
          ref={detail}
          id={`${id}-detail`}
          className="wf-detail"
          aria-label="Selected waterfall event"
          // The independent scroll region must be reachable for native keyboard scrolling.
          // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          tabIndex={0}
          hidden={!selected}
        >
          {selected ? (
            <>
              <div className="wf-detail-heading">
                <h2 title={selected.label}>{selected.label}</h2>
                <button type="button" className="wf-clear" onClick={close}>
                  Close details
                </button>
              </div>
              <p className="wf-note">
                Replay position {formatClock(selected.at)} · Source start {formatClock(selected.sourceAt)} · {rowDuration(selected)}
                {selected.visible !== undefined ? ` · ${durationLabel(selected.visible)} visible in replay` : ''}
                {selected.segments.length > 1 ? ` · ${selected.segments.length} pieces across edits` : ''}
              </p>
              {selected.kind === 'network' ? (
                renderRequestDetail(selected.entry)
              ) : (
                <dl className="wf-facts">
                  <dt>Kind</dt>
                  <dd>{selected.entry.kind}</dd>
                  {selected.kind === 'action' ? (
                    <>
                      <dt>Action</dt>
                      <dd>{selected.entry.label}</dd>
                      {selected.entry.selector ? (
                        <>
                          <dt>Target</dt>
                          <dd>
                            <code>{selected.entry.selector}</code>
                          </dd>
                        </>
                      ) : null}
                      {selected.entry.url ? (
                        <>
                          <dt>URL</dt>
                          <dd>{selected.entry.url}</dd>
                        </>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <dt>{performanceHasDuration(selected.entry.kind) ? 'Measured duration' : 'Metric timestamp from navigation'}</dt>
                      <dd>{validDuration(selected.entry.value) ? durationLabel(selected.entry.value) : 'Invalid value'}</dd>
                      {selected.entry.eventType ? (
                        <>
                          <dt>Event</dt>
                          <dd>{selected.entry.eventType}</dd>
                        </>
                      ) : null}
                    </>
                  )}
                </dl>
              )}
            </>
          ) : null}
        </section>
      </div>
    </section>
  );
}

function WaterfallSeek() {
  const player = usePlayer();
  const time = usePlayhead();
  return (
    <input
      className="wf-seek"
      aria-label="Waterfall replay position"
      type="range"
      min={0}
      max={player.duration}
      step={1}
      value={time}
      aria-valuetext={formatClock(time)}
      onChange={(event) => player.seek(Number(event.target.value))}
    />
  );
}

function WaterfallPlayhead() {
  const player = usePlayer();
  const time = usePlayhead();
  return (
    <div className="wf-playhead-lane" aria-hidden="true">
      <span
        className="wf-playhead"
        data-testid="waterfall-playhead"
        style={{ left: `${Math.max(0, Math.min(100, (time / player.duration) * 100))}%` }}
      />
    </div>
  );
}
