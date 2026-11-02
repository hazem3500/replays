import { CheckIcon } from 'lucide-react';
import { AnimatedText } from '@/components/animated-text.tsx';

import { AnimatedIcon } from '@/components/animated-icon.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Drawer, DrawerClose, DrawerContent, DrawerFooter, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';

import { useMediaQuery } from './media.ts';
import { COLUMNS, INDEX_COMPACT_QUERY, type Sort, sortFromSearch } from './ReplayIndex.tsx';
import './index/index-mobile.css';

/*
 * The replay index's sort control: a menu on desktop, quiet text opening a bottom sheet on phones (≤ 640 px,
 * INDEX_COMPACT_QUERY). Active filters live with the Filter control (index/filters/): tokens beside it on desktop,
 * the count inside the button and the bottom sheet on phones.
 */

const strings = {
  sort: 'Sort',
  done: 'Done',
  trigger: (label: string) => `Sort: ${label}`,
};

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

const triggerContent = (label: string) => (
  <>
    <AnimatedText text={label} />
    <AnimatedIcon name="chevron-down" />
  </>
);

/** Phones: each order a 48 px radio row; choosing one applies it and closes the sheet. */
function SortSheet({ sort, onChange, label }: { sort: Sort; onChange: (sort: Sort) => void; label: string }) {
  const current = sortToken(sort);
  return (
    <Drawer>
      <DrawerTrigger className="index-sort-trigger" aria-label={strings.trigger(label)}>
        {triggerContent(label)}
      </DrawerTrigger>
      <DrawerContent className="sort-sheet">
        <DrawerTitle className="sort-sheet-title">{strings.sort}</DrawerTitle>
        <div className="sort-sheet-options" role="radiogroup" aria-label={strings.sort}>
          {SORT_OPTIONS.map((option) => {
            const checked = option.value === current;
            return (
              <DrawerClose
                key={option.value}
                role="radio"
                aria-checked={checked}
                className="sort-sheet-option"
                data-slot-item="sort-option"
                onClick={() => onChange(sortFromSearch(`?sort=${option.value}`))}
              >
                <span>{option.label}</span>
                {checked ? <CheckIcon className="sort-sheet-check" aria-hidden="true" /> : null}
              </DrawerClose>
            );
          })}
        </div>
        <DrawerFooter className="sheet-footer">
          <DrawerClose render={<Button variant="secondary" className="h-[44px] w-full text-[13px]" />}>{strings.done}</DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

export function SortMenu({ sort, onChange }: { sort: Sort; onChange: (sort: Sort) => void }) {
  const label = sortLabel(sort);
  const phone = useMediaQuery(INDEX_COMPACT_QUERY);
  if (phone) return <SortSheet sort={sort} onChange={onChange} label={label} />;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="index-sort-trigger" aria-label={strings.trigger(label)}>
        {triggerContent(label)}
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
