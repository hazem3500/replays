import { CheckIcon, ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { ReplayFilters, ReplaySource } from '../../shared/replay.ts';
import { AnimatedIcon } from '@/components/animated-icon.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Drawer, DrawerClose, DrawerContent, DrawerFooter, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer.tsx';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import { cn } from '@/lib/utils.ts';

import type { IndexKind } from '../ReplayIndex.tsx';

/*
 * The index's filters as one compact menu (Linear-style; CLAUDE.md principle 6): a 32 px row each, no section
 * hairlines. Has errors is a switch; Host, Tag, Source and Kind show their value and open a submenu with
 * checkmarks (Host and Tag are searchable past eight). Keyboard: arrows move between rows, Right/Enter opens a submenu,
 * Left/Escape goes back. Phones get the same rows in a bottom sheet (44 px), the submenus as a second panel.
 * Every control writes the same URL state as before.
 */

export interface FilterState {
  filters: ReplayFilters;
  kind: IndexKind | undefined;
  hosts: string[];
  /** Every tag the list has shown: the Tag filter's options (hidden while there are none). */
  tags: string[];
  update: <K extends keyof ReplayFilters>(key: K, value: ReplayFilters[K] | undefined) => void;
  setKind: (kind: IndexKind | undefined) => void;
  clearFilters: () => void;
}

export const SOURCE_OPTIONS: Array<{ value: ReplaySource | undefined; label: string }> = [
  { value: undefined, label: 'All' },
  { value: 'agent', label: 'Agent runs' },
  // `human` stays the stored value and `?source=` param; people see it as an imported recording.
  { value: 'human', label: 'Imported' },
];

export const KIND_OPTIONS: Array<{ value: IndexKind | undefined; label: string }> = [
  { value: undefined, label: 'All' },
  { value: 'suites', label: 'Suites' },
  { value: 'sessions', label: 'Sessions' },
];

export function activeFilters({ filters, kind }: Pick<FilterState, 'filters' | 'kind'>) {
  return [filters.host, filters.tag, filters.source, kind, filters.errors].filter(Boolean).length;
}

const SEARCH_HOSTS_PAST = 8;

/** The choice rows, shared by the menu and the sheet: label, current value, options. */
function choiceRows({ filters, kind, hosts, tags, update, setKind }: FilterState) {
  const hostOptions: Array<{ value: string | undefined; label: string }> = [
    { value: undefined, label: 'All hosts' },
    ...hosts.map((host) => ({ value: host, label: host })),
  ];
  const tagOptions: Array<{ value: string | undefined; label: string }> = [
    { value: undefined, label: 'All tags' },
    ...tags.map((tag) => ({ value: tag, label: tag })),
  ];
  return [
    { key: 'host', label: 'Host', value: filters.host, options: hostOptions, onChange: (value?: string) => update('host', value) },
    ...(tags.length > 0 || filters.tag
      ? [{ key: 'tag', label: 'Tag', value: filters.tag, options: tagOptions, onChange: (value?: string) => update('tag', value) } as const]
      : []),
    {
      key: 'source',
      label: 'Source',
      value: filters.source,
      options: SOURCE_OPTIONS,
      onChange: (value?: string) => update('source', value as ReplaySource | undefined),
    },
    {
      key: 'kind',
      label: 'Kind',
      value: kind,
      options: KIND_OPTIONS,
      onChange: (value?: string) => setKind(value as IndexKind | undefined),
    },
  ] as const;
}

type Choice = ReturnType<typeof choiceRows>[number];

const valueLabel = (choice: Choice) => choice.options.find((option) => option.value === choice.value)?.label ?? choice.options[0]!.label;
const ALL = '__all__';

/* ---------- Desktop: the Filter menu ---------- */

function ChoiceSubmenu({ choice }: { choice: Choice }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchable = (choice.key === 'host' || choice.key === 'tag') && choice.options.length - 1 > SEARCH_HOSTS_PAST;
  const options = useMemo(
    () =>
      searchable && query ? choice.options.filter((option) => option.label.toLowerCase().includes(query.toLowerCase())) : choice.options,
    [choice.options, query, searchable],
  );
  const active = choice.value !== undefined;
  return (
    <DropdownMenuSub open={open} onOpenChange={setOpen}>
      <DropdownMenuSubTrigger className="filter-row" data-active={active || undefined}>
        <span className="filter-row-label">{choice.label}</span>
        <span className="filter-row-value">{valueLabel(choice)}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="filter-submenu min-w-44 p-1">
        {searchable ? (
          <input
            className="filter-search"
            aria-label={`Search ${choice.label.toLowerCase()}s`}
            placeholder={`Search ${choice.label.toLowerCase()}s`}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Escape' && event.key !== 'ArrowDown') event.stopPropagation();
            }}
          />
        ) : null}
        <DropdownMenuRadioGroup
          value={choice.value ?? ALL}
          onValueChange={(next: string) => {
            choice.onChange(next === ALL ? undefined : next);
            // Back to the menu: one choice per visit, the rest of the filters stay a keystroke away.
            setOpen(false);
          }}
        >
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.label} value={option.value ?? ALL} className="filter-option">
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function SwitchRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <DropdownMenuCheckboxItem
      closeOnClick={false}
      checked={checked}
      onCheckedChange={(value: boolean) => onChange(value)}
      className="filter-row filter-switch-row"
      data-active={checked || undefined}
    >
      <span className="filter-row-label">{label}</span>
      <span className="filter-switch" aria-hidden="true" />
    </DropdownMenuCheckboxItem>
  );
}

/** Desktop: one quiet "Filter" button (icon, label, active count) opening the filter menu. */
export function FilterMenu(state: FilterState) {
  const { filters, clearFilters, update } = state;
  const active = activeFilters(state);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="scope-button" aria-label={active ? `Filter, ${active} active` : 'Filter'}>
        <AnimatedIcon name="sliders-horizontal" />
        Filter
        {active ? (
          <span className="scope-badge" aria-hidden="true">
            {active}
          </span>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="filter-menu w-[272px] p-1" aria-label="Filters">
        <div className="filter-menu-head">
          <span className="filter-menu-title">Filters</span>
          {active ? (
            <DropdownMenuItem closeOnClick={false} className="filter-menu-clear" onClick={clearFilters}>
              Clear
            </DropdownMenuItem>
          ) : null}
        </div>
        {choiceRows(state).map((choice) => (
          <ChoiceSubmenu key={choice.key} choice={choice} />
        ))}
        <SwitchRow label="Has errors" checked={Boolean(filters.errors)} onChange={(value) => update('errors', value ? true : undefined)} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ---------- Phones: the same rows in a bottom sheet ---------- */

function SheetSwitch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className="filter-row filter-switch-row"
      data-active={checked || undefined}
      onClick={() => onChange(!checked)}
    >
      <span className="filter-row-label">{label}</span>
      <span className="filter-switch" aria-hidden="true" />
    </button>
  );
}

/** Phones: a 40 px Filters button opening a bottom sheet; Host/Tag/Source/Kind open a second panel in place. */
export function FilterSheet(state: FilterState) {
  const { filters, clearFilters, update } = state;
  const active = activeFilters(state);
  const [panel, setPanel] = useState<Choice['key']>();
  const choices = choiceRows(state);
  const open = choices.find((choice) => choice.key === panel);
  return (
    <Drawer
      onOpenChange={(next) => {
        if (!next) setPanel(undefined);
      }}
    >
      <DrawerTrigger className="index-filters-button" aria-label={active ? `Filters, ${active} active` : 'Filters'}>
        <AnimatedIcon name="sliders-horizontal" />
        {active ? (
          <span className="index-filters-badge" aria-hidden="true">
            {active}
          </span>
        ) : null}
      </DrawerTrigger>
      <DrawerContent className="filter-sheet">
        {open ? (
          <>
            <div className="filter-menu-head filter-panel-head">
              <button type="button" className="filter-back" aria-label="Back to filters" onClick={() => setPanel(undefined)}>
                <ChevronLeftIcon aria-hidden="true" />
              </button>
              {/* The sheet keeps its name ("Filters"); the panel's own heading says which filter. */}
              <DrawerTitle className="visually-hidden">Filters</DrawerTitle>
              <span className="filter-menu-title">{open.label}</span>
            </div>
            <div className="filter-options" role="radiogroup" aria-label={open.label}>
              {open.options.map((option) => {
                const checked = option.value === open.value;
                return (
                  <button
                    key={option.label}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    className="filter-row filter-option"
                    onClick={() => {
                      open.onChange(option.value);
                      setPanel(undefined);
                    }}
                  >
                    <span className="filter-row-label">{option.label}</span>
                    {checked ? <CheckIcon className="filter-check" aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <div className="filter-menu-head">
              <DrawerTitle className="filter-menu-title">Filters</DrawerTitle>
              {active ? (
                <button type="button" className="filter-menu-clear" onClick={clearFilters}>
                  Clear
                </button>
              ) : null}
            </div>
            {choices.map((choice) => (
              <button
                key={choice.key}
                type="button"
                className="filter-row"
                data-active={choice.value !== undefined || undefined}
                aria-label={`${choice.label}: ${valueLabel(choice)}`}
                onClick={() => setPanel(choice.key)}
              >
                <span className="filter-row-label">{choice.label}</span>
                <span className="filter-row-value">{valueLabel(choice)}</span>
                <ChevronRightIcon className="filter-chevron" aria-hidden="true" />
              </button>
            ))}
            <SheetSwitch
              label="Has errors"
              checked={Boolean(filters.errors)}
              onChange={(value) => update('errors', value ? true : undefined)}
            />
          </>
        )}
        <DrawerFooter className="sheet-footer">
          <DrawerClose render={<Button variant="secondary" className={cn('h-[44px] w-full text-[13px]')} />}>Done</DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
