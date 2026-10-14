import { XIcon } from 'lucide-react';
import { AnimatedText } from '@/components/animated-text.tsx';
import type { MouseEvent } from 'react';

import { AnimatedIcon } from '@/components/animated-icon.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';

import { type FilterState, KIND_OPTIONS, SOURCE_OPTIONS } from './index/FilterMenu.tsx';
import { COLUMNS, type Sort, sortFromSearch } from './ReplayIndex.tsx';

/*
 * The replay index's compact controls: the sort menu (every width), and on phones (≤ 640 px,
 * INDEX_COMPACT_QUERY) a bottom sheet plus removable chips instead of the row of filter selects.
 * Every control writes the same URL state as the desktop toolbar.
 */

/* ---------- Sort menu ---------- */

const SORT_OPTIONS = [
  { value: '-capturedAt', label: 'Newest' },
  { value: 'capturedAt', label: 'Oldest' },
  { value: '-duration', label: 'Longest' },
  { value: '-errors', label: 'Most errors' },
  { value: 'title', label: 'Title A–Z' },
];

const sortToken = (sort: Sort) => `${sort.direction === 'descending' ? '-' : ''}${sort.key}`;

/** "Newest", or for a sort only a shared URL can ask for (`?sort=-steps`), the field and an arrow. */
function sortLabel(sort: Sort) {
  const option = SORT_OPTIONS.find((candidate) => candidate.value === sortToken(sort));
  if (option) return option.label;
  const column = COLUMNS.find((candidate) => candidate.key === sort.key)?.label ?? sort.key;
  return `${column} ${sort.direction === 'ascending' ? '↑' : '↓'}`;
}

export function SortMenu({ sort, onChange }: { sort: Sort; onChange: (sort: Sort) => void }) {
  const label = sortLabel(sort);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="index-sort-trigger" aria-label={`Sort: ${label}`}>
        <AnimatedText text={label} />
        <AnimatedIcon name="chevron-down" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-40">
        <DropdownMenuRadioGroup value={sortToken(sort)} onValueChange={(value: string) => onChange(sortFromSearch(`?sort=${value}`))}>
          {SORT_OPTIONS.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value} closeOnClick className="text-[13px] pointer-coarse:min-h-10">
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// The removed chip takes the keyboard position with it: hand it to a neighbour, or back to the Filters button.
function handOff(event: MouseEvent<HTMLButtonElement>) {
  const buttons = [...(event.currentTarget.parentElement?.querySelectorAll('button') ?? [])];
  const index = buttons.indexOf(event.currentTarget);
  const next =
    buttons[index + 1] ??
    buttons[index - 1] ??
    event.currentTarget.closest('.index-shell')?.querySelector<HTMLElement>('.index-filters-button, .scope-button');
  next?.focus();
}

/** Active filters as small removable chips under the search; nothing when none are set. */
export function CompactFilterChips({ filters, kind, update, setKind }: FilterState) {
  const chips: Array<{ id: string; label: string; name: string; remove: () => void }> = [];
  if (filters.host) chips.push({ id: 'host', label: filters.host, name: `Host ${filters.host}`, remove: () => update('host', undefined) });
  if (filters.tag) chips.push({ id: 'tag', label: filters.tag, name: `Tag ${filters.tag}`, remove: () => update('tag', undefined) });
  if (filters.source) {
    const label = SOURCE_OPTIONS.find((option) => option.value === filters.source)?.label ?? filters.source;
    chips.push({ id: 'source', label, name: `Source ${label}`, remove: () => update('source', undefined) });
  }
  if (kind) {
    const label = KIND_OPTIONS.find((option) => option.value === kind)?.label ?? kind;
    chips.push({ id: 'kind', label, name: `Kind ${label}`, remove: () => setKind(undefined) });
  }
  if (filters.errors) chips.push({ id: 'errors', label: 'Has errors', name: 'Has errors', remove: () => update('errors', undefined) });
  if (chips.length === 0) return null;

  return (
    <div className="index-chips" role="group" aria-label="Active filters">
      {chips.map((chip) => (
        <button
          key={chip.id}
          type="button"
          className="index-chip"
          aria-label={`Remove filter: ${chip.name}`}
          onClick={(event) => {
            handOff(event);
            chip.remove();
          }}
        >
          <span className="index-chip-pill">
            {chip.label}
            <XIcon aria-hidden="true" />
          </span>
        </button>
      ))}
    </div>
  );
}
