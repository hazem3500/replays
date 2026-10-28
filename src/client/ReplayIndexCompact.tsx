import { AnimatedText } from '@/components/animated-text.tsx';

import { AnimatedIcon } from '@/components/animated-icon.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';

import { COLUMNS, type Sort, sortFromSearch } from './ReplayIndex.tsx';

/*
 * The replay index's sort menu. Active filters live with the Filter control (index/filters/): tokens beside it on
 * desktop, the count inside the button and the bottom sheet on phones.
 */

const SORT_OPTIONS = [
  { value: '-capturedAt', label: 'Newest' },
  { value: 'capturedAt', label: 'Oldest' },
  { value: '-duration', label: 'Longest' },
  { value: '-errors', label: 'Most errors' },
  { value: 'title', label: 'Title A to Z' },
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
