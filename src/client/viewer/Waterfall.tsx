import { type ReactNode, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ListFilterIcon, SearchIcon, XIcon } from 'lucide-react';

import type { EditTimeline } from '../../shared/edits.ts';
import { formatClock, type ReplayBundle, type ReplayNetworkEntry } from '../../shared/replay.ts';
import { usePlayer } from '../player.ts';
import { WaterfallDetails, WaterfallSeek, WaterfallPlayhead } from './WaterfallParts.tsx';
import { useWindowedRows } from '../windowing.ts';
import { buildWaterfall, filterWaterfall, rowDuration, type WaterfallKind, type WaterfallRow, type WaterfallState } from './waterfall.ts';
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
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const searchToggle = useRef<HTMLButtonElement>(null);
  const wasSearchOpen = useRef(false);
  const detail = useRef<HTMLElement>(null);
  const pendingFocus = useRef<string | undefined>(undefined);
  const scroller = useRef<HTMLDivElement>(null);
  const model = useMemo(() => buildWaterfall(bundle, timeline), [bundle, timeline]);
  const rows = useMemo(() => filterWaterfall(model.rows, query, kind, state), [model, query, kind, state]);
  const selected = rows.find((row) => row.id === selection);
  const selectedId = selected?.id;
  const activeFilters = Number(kind !== 'all') + Number(state !== 'all');
  const hasQuery = Boolean(query.trim());
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
  useLayoutEffect(() => {
    if (searchOpen && !wasSearchOpen.current) searchInput.current?.focus();
    else if (!searchOpen && wasSearchOpen.current) searchToggle.current?.focus();
    wasSearchOpen.current = searchOpen;
  }, [searchOpen]);
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
        <div className="wf-tools-main">
          <div
            className="wf-event-count"
            role="status"
            aria-live="polite"
            aria-atomic="true"
            aria-label={rows.length === model.rows.length ? `${model.rows.length} events` : `${rows.length} of ${model.rows.length} events`}
          >
            <span className="wf-count-value">
              {rows.length === model.rows.length ? model.rows.length : `${rows.length} / ${model.rows.length}`}
            </span>
            <span>{rows.length === 1 ? 'event' : 'events'}</span>
          </div>
          <div className="wf-tool-actions">
            <button
              ref={searchToggle}
              type="button"
              className="wf-tool-button wf-search-toggle"
              data-testid="waterfall-search-toggle"
              aria-label={searchOpen ? 'Close event search' : 'Search events'}
              aria-expanded={searchOpen}
              aria-controls={`${id}-search-panel`}
              onClick={() => {
                if (searchOpen) setQuery('');
                setSearchOpen(!searchOpen);
              }}
            >
              {searchOpen ? <XIcon aria-hidden="true" /> : <SearchIcon aria-hidden="true" />}
              <span>{searchOpen ? 'Close search' : 'Search'}</span>
            </button>
            <Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
              <PopoverTrigger
                render={
                  <button
                    type="button"
                    className="wf-tool-button wf-filter-trigger"
                    data-testid="waterfall-filters"
                    aria-label={activeFilters ? `Filters, ${activeFilters} active` : 'Filters'}
                  />
                }
              >
                <ListFilterIcon aria-hidden="true" />
                <span>Filters</span>
                {activeFilters ? (
                  <span className="wf-filter-count" aria-hidden="true">
                    {activeFilters}
                  </span>
                ) : null}
              </PopoverTrigger>
              <PopoverContent
                className="wf-filter-popover"
                align="end"
                aria-label="Waterfall filters"
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    setFiltersOpen(false);
                  }
                }}
              >
                <PopoverTitle>Filter events</PopoverTitle>
                <div className="wf-filter-controls">
                  <fieldset className="wf-filter-group">
                    <legend>Tracks</legend>
                    <div className="wf-track-options" role="group" aria-label="Event tracks">
                      {(
                        [
                          ['all', 'All'],
                          ['network', 'Network'],
                          ['action', 'Actions'],
                          ['performance', 'Performance'],
                        ] as const
                      ).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          className="wf-option"
                          aria-pressed={kind === value}
                          onClick={() => {
                            setKind(value);
                            if (scroller.current) scroller.current.scrollTop = 0;
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                  <fieldset className="wf-filter-group">
                    <legend>Request status</legend>
                    <div className="wf-state-options" role="group" aria-label="Request status">
                      {(
                        [
                          ['all', 'All requests'],
                          ['failed', 'Failed'],
                          ['slow', 'Slow · 500 ms or more'],
                          ['incomplete', 'Incomplete'],
                          ['invalid', 'Unknown duration'],
                        ] as const
                      ).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          className="wf-option"
                          aria-pressed={state === value}
                          onClick={() => {
                            setState(value);
                            if (scroller.current) scroller.current.scrollTop = 0;
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                  {activeFilters ? (
                    <button
                      type="button"
                      className="wf-clear-filters"
                      onClick={() => {
                        setQuery('');
                        setKind('all');
                        setState('all');
                        if (scroller.current) scroller.current.scrollTop = 0;
                      }}
                    >
                      Clear filters
                    </button>
                  ) : null}
                </div>
                <p className="wf-note">Bars show time kept in the replay; durations use source timing.</p>
                <p className="wf-note">↑/↓ selects and seeks · Escape closes details</p>
                {model.invalidTimes ? <p className="wf-note">{model.invalidTimes} invalid timestamps omitted</p> : null}
              </PopoverContent>
            </Popover>
          </div>
        </div>
        <div
          id={`${id}-search-panel`}
          className="wf-search-reveal"
          data-open={searchOpen || undefined}
          aria-hidden={!searchOpen}
          inert={!searchOpen}
        >
          <div className="wf-search-inner">
            <label className="wf-search-field" htmlFor={`${id}-search`}>
              <SearchIcon aria-hidden="true" />
              <span className="visually-hidden">Search network requests, actions, and performance events</span>
              <input
                ref={searchInput}
                id={`${id}-search`}
                type="search"
                tabIndex={searchOpen ? 0 : -1}
                placeholder="URL, action, or signal"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  if (scroller.current) scroller.current.scrollTop = 0;
                }}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    if (hasQuery) setQuery('');
                    else setSearchOpen(false);
                  }
                }}
              />
              {hasQuery ? (
                <button
                  type="button"
                  className="wf-search-clear"
                  aria-label="Clear search"
                  onClick={() => {
                    setQuery('');
                    searchInput.current?.focus();
                  }}
                >
                  <XIcon aria-hidden="true" />
                </button>
              ) : null}
            </label>
          </div>
        </div>
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
        <WaterfallDetails
          selected={selected}
          detailRef={detail}
          id={`${id}-detail`}
          close={close}
          renderRequestDetail={renderRequestDetail}
        />
      </div>
    </section>
  );
}
