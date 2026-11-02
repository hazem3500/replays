import {
  createSortedRowModel,
  rowSortingFeature,
  sortFn_basic,
  tableFeatures,
  useTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { EllipsisIcon } from 'lucide-react';
import { useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu.tsx';
import { usePlayer, usePlayhead } from '../../player.ts';
import { countAtOrBefore } from '../../timeline.ts';
import { usePlayheadProperty } from '../../hooks/use-playhead-property.ts';
import { useRevealIndex } from '../../hooks/use-reveal-index.ts';
import { useVirtualRows } from '../../hooks/use-virtual-rows.ts';
import type { TimeScale } from '../time-axis.ts';
import { resolveRowActions } from './actions.ts';
import type { NetworkColumnSpec } from './columns.tsx';
import type { NetworkRow } from './model.ts';

const features = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel(), sortFns: { basic: sortFn_basic } });

const STRINGS = {
  table: 'Network requests',
  actions: (row: NetworkRow) => `Actions for ${row.entry.method} ${row.entry.url}`,
  future: 'Upcoming',
  sort: (label: string) => `Sort by ${label}`,
};

export interface ResolvedColumn {
  id: string;
  spec: NetworkColumnSpec;
}

interface NetworkTableProps {
  rows: readonly NetworkRow[];
  columns: readonly ResolvedColumn[];
  /** Start times of every listed request, ascending: rows after the playhead are dimmed. */
  ats: readonly number[];
  scale: TimeScale;
  rowHeight: number;
  selected: string | undefined;
  onSelect: (row: NetworkRow) => void;
  onClose: () => void;
  empty?: ReactNode;
}

/**
 * Requests as a sortable, virtualised grid. Columns come resolved from `inspector.network.columns`; TanStack Table owns
 * sorting (default: start order) and TanStack Virtual mounts only the rows in view.
 */
export function NetworkTable({ rows, columns, ats, scale, rowHeight, selected, onSelect, onClose, empty }: NetworkTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const definitions: ColumnDef<typeof features, NetworkRow>[] = columns.map(({ id, spec }) => ({
    id,
    header: spec.label,
    accessorFn: spec.sortValue ?? (() => 0),
    enableSorting: Boolean(spec.sortValue),
    sortFn: 'basic',
  }));
  const table = useTable({
    features,
    columns: definitions,
    data: rows as NetworkRow[],
    state: { sorting },
    onSortingChange: setSorting,
    getRowId: (row) => row.id,
  });
  const ordered = table.getRowModel().rows.map((row) => row.original);
  const specs = new Map(columns.map((column) => [column.id, column.spec]));
  const scroller = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const virtual = useVirtualRows(
    scroller,
    ordered.map((row) => row.id),
    rowHeight,
  );
  const player = usePlayer();
  // why: a count only changes when the playhead crosses a request's start, so rows re-render rarely; at 0:00.0 nothing has happened yet (not even requests stamped 0), at the end everything has.
  const reached = usePlayhead((time) => countAtOrBefore(ats, time >= player.duration ? Infinity : time <= 0 ? -1 : time));
  const horizon = reached > 0 ? ats[reached - 1]! : -Infinity;
  const toPercent = (time: number) => `${Math.max(-1, Math.min(101, (scale.x(time) / scale.width) * 100))}%`;
  usePlayheadProperty(grid, '--net-playhead', toPercent);
  const selectedIndex = selected ? ordered.findIndex((row) => row.id === selected) : -1;
  useRevealIndex(selectedIndex, virtual.scrollToIndex);
  const template = columns.map((column) => column.spec.width).join(' ');

  const move = (index: number, event: KeyboardEvent<HTMLElement>) => {
    const target =
      event.key === 'ArrowDown'
        ? index + 1
        : event.key === 'ArrowUp'
          ? index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? ordered.length - 1
              : undefined;
    if (event.key === 'Escape' && selected) {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      const row = ordered[index];
      if (row) onSelect(row);
      return;
    }
    if (target === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    const next = ordered[Math.max(0, Math.min(ordered.length - 1, target))];
    if (!next) return;
    onSelect(next);
    requestAnimationFrame(() =>
      scroller.current?.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(next.id)}"]`)?.focus({ preventScroll: true }),
    );
  };

  const focusable = selectedIndex >= 0 ? selectedIndex : 0;
  return (
    <div
      ref={grid}
      className="net-grid"
      role="grid"
      aria-label={STRINGS.table}
      aria-rowcount={ordered.length + 1}
      aria-colcount={columns.length}
      data-slot="inspector.network.columns"
      style={{ '--net-columns': template, '--row-height': `${rowHeight}px` } as CSSProperties}
    >
      <div className="net-head" role="rowgroup">
        <div className="net-row net-head-row" role="row" aria-rowindex={1}>
          {table.getHeaderGroups()[0]?.headers.map((header) => {
            const spec = specs.get(header.column.id);
            if (!spec) return null;
            const sorted = header.column.getIsSorted();
            const content = spec.header ? spec.header() : spec.label;
            return (
              <div
                key={header.id}
                role="columnheader"
                className="net-cell net-head-cell"
                data-slot-item={header.column.id}
                data-align={spec.align}
                aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
              >
                {header.column.getCanSort() ? (
                  <button
                    type="button"
                    className="net-sort"
                    aria-label={STRINGS.sort(spec.label)}
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    {content}
                    <span className="net-sort-mark" data-sorted={sorted || undefined} aria-hidden="true" />
                  </button>
                ) : (
                  content
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div ref={scroller} className="net-scroller" role="rowgroup" data-testid="network-list">
        {ordered.length === 0 ? (
          empty
        ) : (
          <div className="net-body" style={{ height: virtual.totalSize }}>
            {virtual.items.map((item) => {
              const row = ordered[item.index]!;
              return (
                <NetworkTableRow
                  key={item.key}
                  row={row}
                  index={item.index}
                  offset={item.start}
                  columns={columns}
                  future={row.at > horizon}
                  selected={row.id === selected}
                  focusable={item.index === focusable}
                  onSelect={onSelect}
                  onKey={move}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function NetworkTableRow({
  row,
  index,
  offset,
  columns,
  future,
  selected,
  focusable,
  onSelect,
  onKey,
}: {
  row: NetworkRow;
  index: number;
  offset: number;
  columns: readonly ResolvedColumn[];
  future: boolean;
  selected: boolean;
  focusable: boolean;
  onSelect: (row: NetworkRow) => void;
  onKey: (index: number, event: KeyboardEvent<HTMLElement>) => void;
}) {
  return (
    // why: a grid row is the selectable unit: click and arrow keys select it, Enter re-selects.
    <div
      className="net-row"
      role="row"
      aria-rowindex={index + 2}
      aria-selected={selected}
      tabIndex={focusable ? 0 : -1}
      data-row-id={row.id}
      data-failed={row.failed || undefined}
      data-future={future || undefined}
      style={{ '--row-offset': `${offset}px` } as CSSProperties}
      onClick={() => onSelect(row)}
      onKeyDown={(event) => onKey(index, event)}
    >
      {columns.map(({ id, spec }) => (
        <div key={id} role="gridcell" className="net-cell" data-slot-item={id} data-align={spec.align}>
          {spec.cell(row)}
        </div>
      ))}
      {future ? <span className="visually-hidden">{STRINGS.future}</span> : null}
      <RowActions row={row} />
    </div>
  );
}

function RowActions({ row }: { row: NetworkRow }) {
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        className="net-row-actions"
        aria-label={STRINGS.actions(row)}
        data-slot="inspector.network.row.actions"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <EllipsisIcon aria-hidden="true" />
      </DropdownMenuTrigger>
      {open ? (
        <DropdownMenuContent align="end" className="net-row-menu">
          {resolveRowActions(row).map(({ id, action }) => (
            <DropdownMenuItem key={id} data-slot-item={id} onClick={() => void action.run()}>
              {action.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      ) : null}
    </DropdownMenu>
  );
}
