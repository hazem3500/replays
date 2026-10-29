import { ChartNoAxesGanttIcon, ChevronDownIcon, SearchIcon, XIcon } from 'lucide-react';
import { type KeyboardEvent as ReactKeyboardEvent, useRef, useState } from 'react';

import { formatClock } from '../../../shared/replay.ts';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import { type NetworkFilter, REQUEST_TYPES, type RequestType, type StatusFilter } from './model.ts';

const STATUS_CHIPS: ReadonlyArray<{ id: StatusFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'failed', label: 'Failed' },
  { id: 'slow', label: 'Slow' },
  { id: 'pending', label: 'No response' },
];

const TYPE_LABELS: Readonly<Record<RequestType | 'all', string>> = {
  all: 'All types',
  document: 'Documents',
  fetch: 'Fetch and XHR',
  script: 'Scripts',
  stylesheet: 'Stylesheets',
  image: 'Images',
  font: 'Fonts',
  other: 'Other',
};

const STRINGS = {
  status: 'Show requests',
  type: 'Request type',
  search: 'Search requests',
  timeline: 'Timeline',
  timelineHint: 'Show when requests happened, on the seek bar’s scale',
  closeSearch: 'Close search',
  placeholder: 'URL, method or status',
  clearRange: (from: number, to: number) => `Show all times, not only ${formatClock(from)} to ${formatClock(to)}`,
  range: (from: number, to: number) => `${formatClock(from)} to ${formatClock(to)}`,
  shown: (shown: number) => `${shown} ${shown === 1 ? 'request' : 'requests'}`,
  slowHint: 'Took 500 ms or longer',
  pendingHint: 'No response recorded: a redirect hop, or still in flight when capture stopped',
};

const HINTS: Partial<Record<StatusFilter, string>> = { slow: STRINGS.slowHint, pending: STRINGS.pendingHint };

/** Keys typed in the toolbar stay out of the player's shortcuts (space, arrows). */
const keepKeys = (event: ReactKeyboardEvent<HTMLElement>) => {
  if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) event.stopPropagation();
};

/**
 * One row: the status chips are the filters and the summary at once (All 300 · Failed 6 · Slow 1), so issues are the
 * first thing read; a type menu; search opens in place of the chips instead of adding a row.
 */
export function NetworkToolbar({
  counts,
  types,
  filter,
  shown,
  onFilter,
  timeline,
}: {
  counts: Readonly<Record<StatusFilter, number>>;
  types: ReadonlyArray<{ type: RequestType; count: number }>;
  filter: NetworkFilter;
  /** Rows left after filtering. */
  shown: number;
  onFilter: (next: NetworkFilter) => void;
  /** On a narrow panel the ribbon is a disclosure: whether it is open, and the switch. */
  timeline?: { open: boolean; onToggle: () => void } | undefined;
}) {
  const [searching, setSearching] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeSearch = () => {
    onFilter({ ...filter, text: '' });
    setSearching(false);
    requestAnimationFrame(() => trigger.current?.focus());
  };
  return (
    <div className="np-toolbar" data-testid="network-toolbar" data-searching={searching || undefined}>
      {searching ? (
        <SearchField text={filter.text} onText={(text) => onFilter({ ...filter, text })} onClose={closeSearch} />
      ) : (
        <StatusChips counts={counts} value={filter.status} onChange={(status) => onFilter({ ...filter, status })} />
      )}
      {filter.range ? (
        <button
          type="button"
          className="np-chip np-range"
          aria-label={STRINGS.clearRange(filter.range.from, filter.range.to)}
          onClick={() => onFilter({ ...filter, range: undefined })}
          onKeyDown={keepKeys}
        >
          {STRINGS.range(filter.range.from, filter.range.to)}
          <XIcon aria-hidden="true" />
        </button>
      ) : null}
      <span className="np-spacer" />
      {shown === counts.all ? null : (
        <span className="np-shown" aria-live="polite">
          {STRINGS.shown(shown)}
        </span>
      )}
      <TypeMenu types={types} value={filter.type} onChange={(type) => onFilter({ ...filter, type })} />
      {timeline && !searching ? (
        <button
          type="button"
          className="np-type np-toggle"
          aria-label={STRINGS.timeline}
          aria-pressed={timeline.open}
          title={STRINGS.timelineHint}
          data-testid="network-timeline-toggle"
          onClick={timeline.onToggle}
          onKeyDown={keepKeys}
        >
          <ChartNoAxesGanttIcon aria-hidden="true" />
          <span className="np-toggle-label">{STRINGS.timeline}</span>
        </button>
      ) : null}
      {searching ? null : (
        <button
          ref={trigger}
          type="button"
          className="np-icon"
          aria-label={STRINGS.search}
          data-active={filter.text ? '' : undefined}
          data-testid="network-search-toggle"
          onClick={() => setSearching(true)}
          onKeyDown={keepKeys}
        >
          <SearchIcon aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

function SearchField({ text, onText, onClose }: { text: string; onText: (text: string) => void; onClose: () => void }) {
  return (
    <label className="np-search">
      <SearchIcon aria-hidden="true" />
      <span className="visually-hidden">{STRINGS.search}</span>
      <input
        type="search"
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- why: the field appears because its button was pressed; focus belongs there.
        autoFocus
        placeholder={STRINGS.placeholder}
        value={text}
        onChange={(event) => onText(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape') onClose();
        }}
      />
      <button type="button" className="np-icon" aria-label={STRINGS.closeSearch} onClick={onClose} onKeyDown={keepKeys}>
        <XIcon aria-hidden="true" />
      </button>
    </label>
  );
}

/**
 * The chips worth showing: each status that occurred, and All only when there are two or more to choose between (a
 * lone Failed chip already toggles back to every request, and the tab's badge carries the total).
 */
function visibleChips(counts: Readonly<Record<StatusFilter, number>>, value: StatusFilter) {
  const statuses = STATUS_CHIPS.filter((chip) => chip.id !== 'all' && (counts[chip.id] > 0 || chip.id === value));
  return statuses.length > 1 ? STATUS_CHIPS.filter((chip) => chip.id === 'all' || statuses.includes(chip)) : statuses;
}

function StatusChips({
  counts,
  value,
  onChange,
}: {
  counts: Readonly<Record<StatusFilter, number>>;
  value: StatusFilter;
  onChange: (status: StatusFilter) => void;
}) {
  return (
    <div className="np-chips" role="group" aria-label={STRINGS.status}>
      {visibleChips(counts, value).map((chip) => (
        <button
          key={chip.id}
          type="button"
          className="np-chip"
          data-status={chip.id}
          data-testid={`network-status-${chip.id}`}
          aria-pressed={value === chip.id}
          title={HINTS[chip.id]}
          // why: pressing the active filter again goes back to every request, as a toggle would.
          onClick={() => onChange(value === chip.id ? 'all' : chip.id)}
          onKeyDown={keepKeys}
        >
          {chip.id === 'all' ? null : <span className="np-dot" data-status={chip.id} aria-hidden="true" />}
          {chip.label}
          <span className="np-chip-count">{counts[chip.id]}</span>
        </button>
      ))}
    </div>
  );
}

const isTypeFilter = (value: string): value is RequestType | 'all' => value === 'all' || REQUEST_TYPES.some((type) => type === value);

function TypeMenu({
  types,
  value,
  onChange,
}: {
  types: ReadonlyArray<{ type: RequestType; count: number }>;
  value: RequestType | 'all';
  onChange: (type: RequestType | 'all') => void;
}) {
  if (types.length < 2 && value === 'all') return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="np-type"
        aria-label={`${STRINGS.type}: ${TYPE_LABELS[value]}`}
        data-testid="network-type"
        onKeyDown={keepKeys}
      >
        {TYPE_LABELS[value]}
        <ChevronDownIcon aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-44">
        <DropdownMenuRadioGroup value={value} onValueChange={(next: string) => onChange(isTypeFilter(next) ? next : 'all')}>
          <DropdownMenuRadioItem value="all" closeOnClick className="pointer-coarse:min-h-10">
            {TYPE_LABELS.all}
          </DropdownMenuRadioItem>
          {types.map(({ type, count }) => (
            <DropdownMenuRadioItem key={type} value={type} closeOnClick className="pointer-coarse:min-h-10">
              {TYPE_LABELS[type]}
              <span className="np-type-count">{count}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
