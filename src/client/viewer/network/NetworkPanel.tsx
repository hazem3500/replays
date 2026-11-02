import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';

import type { EditTimeline } from '../../../shared/edits.ts';
import { formatClock, type ReplayBundle } from '../../../shared/replay.ts';
import { EmptyState } from '@/components/ui/empty-state.tsx';
import { useElementWidth } from '../../hooks/use-element-width.ts';
import { useMediaQuery } from '../../media.ts';
import { usePlayer } from '../../player.ts';
import { readStorage, writeStorage } from '../../storage.ts';
import { replayDomain, timeScale, type TimeDomain } from '../time-axis.ts';
import { resolveNetworkColumns } from './columns.tsx';
import { useInspectorRows } from '../../data/inspector.ts';
import type { NetworkRow } from './model.ts';
import { NetworkTable } from './NetworkTable.tsx';
import { EMPTY_TOOLBAR, NetworkToolbar, STATUS_CHIPS, toolbarFilter, TYPE_CHIPS, type NetworkToolbarState } from './NetworkToolbar.tsx';
import { RequestDetail } from './RequestDetail.tsx';
import './network.css';

export const TIMING_PREFERENCE_KEY = 'replays-network-timing';
/** The Timing column is on by default once the dock is this wide (px). */
const TIMING_MIN_WIDTH = 760;
const PHONE_QUERY = '(max-width: 600px)';
const TOUCH_QUERY = '(pointer: coarse)';
const ROW_HEIGHT = { desktop: 28, touch: 44 };
const DETAIL_WIDTH = { initial: 40, min: 25, max: 70, step: 5 };

const STRINGS = {
  splitter: 'Resize request details',
  humanTitle: 'Network wasn’t recorded',
  humanBody: 'This replay was imported from an rrweb recording, which doesn’t capture console or network activity.',
  noneTitle: 'No network requests were captured in this replay',
  noneBody: 'The page made no requests while it was recorded, or network capture was off.',
  noMatchTitle: 'No requests match these filters',
  noMatchBody: 'Try another URL, method, status or type.',
  clear: 'Clear filters',
  activeFilters: 'Active filters',
  search: (text: string) => `“${text}”`,
  zoom: (domain: TimeDomain) => `${formatClock(domain.from)} to ${formatClock(domain.to)}`,
};

export interface NetworkPanelProps {
  /** Captured data; requests are mapped onto the player's clock through `timeline`. */
  sourceBundle: ReplayBundle;
  timeline?: EditTimeline | undefined;
  human: boolean;
  /** The selected request's id (the viewer's `expandedRequest`, so error jumps select too). */
  selected: string | undefined;
  onSelect: (id: string | undefined) => void;
}

function activeFilterLabels(toolbar: NetworkToolbarState, zoom: TimeDomain | undefined) {
  return [
    toolbar.text.trim() ? STRINGS.search(toolbar.text.trim()) : undefined,
    toolbar.status !== 'all' ? STATUS_CHIPS.find((chip) => chip.id === toolbar.status)?.label : undefined,
    toolbar.type !== 'all' ? TYPE_CHIPS.find((chip) => chip.id === toolbar.type)?.title : undefined,
    zoom ? STRINGS.zoom(zoom) : undefined,
  ].filter((label): label is string => Boolean(label));
}

function storedTiming() {
  const value = readStorage(TIMING_PREFERENCE_KEY);
  return value === 'on' ? true : value === 'off' ? false : undefined;
}

export function NetworkPanel({ sourceBundle, timeline, human, selected, onSelect }: NetworkPanelProps) {
  const player = usePlayer();
  const panel = useRef<HTMLElement>(null);
  const split = useRef<HTMLDivElement>(null);
  const width = useElementWidth(panel, 1024);
  const phone = useMediaQuery(PHONE_QUERY);
  const touch = useMediaQuery(TOUCH_QUERY);
  const [toolbar, setToolbar] = useState<NetworkToolbarState>(EMPTY_TOOLBAR);
  const [zoom, setZoom] = useState<TimeDomain | undefined>(undefined);
  const [timingChoice, setTimingChoice] = useState(storedTiming);
  const [detailWidth, setDetailWidth] = useState(DETAIL_WIDTH.initial);
  const drag = useRef<{ left: number; width: number; value: number } | undefined>(undefined);

  const { rows } = useInspectorRows(sourceBundle, 'network', {}, timeline);
  const { rows: visible } = useInspectorRows(
    sourceBundle,
    'network',
    { text: toolbar.text, range: zoom, ...toolbarFilter(toolbar) },
    timeline,
  );
  const ats = visible.map((row) => row.at);

  const timingAvailable = !phone;
  const showTiming = timingAvailable && (timingChoice ?? width >= TIMING_MIN_WIDTH);
  const bounds = replayDomain(player.duration);
  const scale = timeScale(zoom ?? bounds, 100);
  const columns = resolveNetworkColumns({ showTiming, compact: phone, scale, bounds, onZoom: setZoom });
  const selectedRow = selected ? rows.find((row) => row.id === selected) : undefined;
  const firstAt = rows.reduce((first, row) => Math.min(first, row.timing.sourceAt), Infinity);

  const select = (row: NetworkRow) => {
    onSelect(row.id);
    // why: seeking keeps play/pause as it was, so selecting while playing doesn't stop the replay.
    player.seek(row.at);
  };
  const close = () => {
    const id = selected;
    onSelect(undefined);
    if (id) requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(id)}"]`)?.focus());
  };
  const changeTiming = (shown: boolean) => {
    setTimingChoice(shown);
    writeStorage(TIMING_PREFERENCE_KEY, shown ? 'on' : 'off');
  };
  const clearFilters = () => {
    setToolbar(EMPTY_TOOLBAR);
    setZoom(undefined);
  };
  const clampDetail = (value: number) => Math.round(Math.min(DETAIL_WIDTH.max, Math.max(DETAIL_WIDTH.min, value)));
  const dragTo = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start) return;
    start.value = clampDetail(((start.left + start.width - event.clientX) / start.width) * 100);
    split.current?.style.setProperty('--inspector-detail-width', `${start.value}%`);
  };
  const endDrag = () => {
    if (drag.current) setDetailWidth(drag.current.value);
    drag.current = undefined;
  };

  const empty = human ? (
    <EmptyState variant="compact" icon="network" title={STRINGS.humanTitle} body={STRINGS.humanBody} />
  ) : rows.length === 0 ? (
    <EmptyState variant="compact" icon="network" title={STRINGS.noneTitle} body={STRINGS.noneBody} />
  ) : (
    <EmptyState
      variant="compact"
      icon="filter"
      title={STRINGS.noMatchTitle}
      body={STRINGS.noMatchBody}
      actions={[{ id: 'clear', label: STRINGS.clear, primary: true, onSelect: clearFilters }]}
      chips={activeFilterLabels(toolbar, zoom)}
      chipsLabel={STRINGS.activeFilters}
    />
  );

  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-static-element-interactions -- why: Escape anywhere in the panel closes the open request; its row keeps the keyboard.
    <section
      ref={panel}
      className="net-panel"
      data-slot="inspector.network"
      data-touch={touch || undefined}
      data-phone={phone || undefined}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && selected) {
          event.stopPropagation();
          close();
        }
      }}
    >
      <NetworkToolbar
        state={toolbar}
        onChange={setToolbar}
        showTiming={showTiming}
        onTimingChange={changeTiming}
        timingAvailable={timingAvailable}
      />
      <div
        ref={split}
        className="net-split"
        data-detail-open={selectedRow ? '' : undefined}
        style={{ '--inspector-detail-width': `${detailWidth}%` } as CSSProperties}
      >
        <NetworkTable
          rows={visible}
          columns={columns}
          ats={ats}
          scale={scale}
          rowHeight={touch || phone ? ROW_HEIGHT.touch : ROW_HEIGHT.desktop}
          selected={selected}
          onSelect={select}
          onClose={close}
          empty={empty}
        />
        {selectedRow ? (
          <>
            <div
              className="net-splitter"
              role="separator"
              aria-orientation="vertical"
              aria-label={STRINGS.splitter}
              aria-valuemin={DETAIL_WIDTH.min}
              aria-valuemax={DETAIL_WIDTH.max}
              aria-valuenow={detailWidth}
              tabIndex={0}
              onPointerDown={(event) => {
                const box = split.current?.getBoundingClientRect();
                if (!box) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                drag.current = { left: box.left, width: box.width, value: detailWidth };
              }}
              onPointerMove={dragTo}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onKeyDown={(event) => {
                const delta = event.key === 'ArrowLeft' ? DETAIL_WIDTH.step : event.key === 'ArrowRight' ? -DETAIL_WIDTH.step : 0;
                if (!delta) return;
                event.preventDefault();
                event.stopPropagation();
                setDetailWidth((value) => clampDetail(value + delta));
              }}
            />
            <RequestDetail
              key={selectedRow.id}
              context={{ row: selectedRow, steps: sourceBundle.steps, firstAt, onSeek: player.seek }}
              onClose={close}
            />
          </>
        ) : null}
      </div>
    </section>
  );
}
