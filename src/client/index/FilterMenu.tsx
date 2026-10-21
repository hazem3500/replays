import { CheckIcon, ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { type KeyboardEvent, useMemo, useState } from 'react';

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

import { usePluginSnapshot } from '../plugins/PluginUi.tsx';
import type { Snapshot } from '../plugins/registry.ts';
import type { IndexKind } from '../ReplayIndex.tsx';

/*
 * The index's filters as one compact menu (Linear-style; CLAUDE.md principle 6): a 32 px row each, no section
 * hairlines. Has errors is a switch; Host, Tag, Source and Kind show their value and open a submenu with
 * checkmarks (Host and Tag are searchable past eight). Keyboard: arrows move between rows, Right/Enter opens a submenu,
 * Left/Escape goes back. Phones get the same rows in a bottom sheet (44 px), the submenus as a second panel.
 * Every control writes the same URL state as before. Plugin filters (registerIndexFilter) follow the built-in rows: a
 * choice submenu, a switch or a text field, each setting its `x-*` query parameter, which the server matches.
 */

export interface FilterState {
  filters: ReplayFilters;
  kind: IndexKind | undefined;
  hosts: string[];
  /** Every tag the list has shown: the Tag filter's options (hidden while there are none). */
  tags: string[];
  update: <K extends keyof ReplayFilters>(key: K, value: ReplayFilters[K] | undefined) => void;
  /** Sets (or, with undefined, removes) a plugin filter's `x-*` param. */
  setParam: (param: string, value: string | undefined) => void;
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
  return (
    [filters.host, filters.tag, filters.source, kind, filters.errors].filter(Boolean).length + Object.keys(filters.params ?? {}).length
  );
}

export type PluginFilter = Snapshot['filters'][number];

const pluginTestId = (filter: PluginFilter) => `plugin-filter:${filter.plugin}:${filter.definition.id}`;

/** What a plugin filter's current value reads as (an option's label, the text, or the switch's own label). */
export function pluginFilterLabel(filter: PluginFilter, value: string) {
  const { definition } = filter;
  if (definition.type === 'switch') return definition.label;
  if (definition.type === 'choice') return definition.options?.find((option) => option.value === value)?.label ?? value;
  return `${definition.label}: ${value}`;
}

interface Choice {
  key: string;
  label: string;
  value: string | undefined;
  options: ReadonlyArray<{ value: string | undefined; label: string }>;
  onChange: (value?: string) => void;
  testId?: string;
}

/** Plugin `choice` filters as rows like Host or Source, with "All" first. */
function pluginChoices(filters: readonly PluginFilter[], { filters: current, setParam }: FilterState): Choice[] {
  return filters
    .filter((filter) => filter.definition.type === 'choice')
    .map((filter) => ({
      key: filter.key,
      label: filter.definition.label,
      value: current.params?.[filter.definition.param],
      options: [{ value: undefined, label: 'All' }, ...(filter.definition.options ?? [])],
      onChange: (value?: string) => setParam(filter.definition.param, value),
      testId: pluginTestId(filter),
    }));
}

const SEARCH_HOSTS_PAST = 8;

/** The choice rows, shared by the menu and the sheet: label, current value, options. */
function choiceRows({ filters, kind, hosts, tags, update, setKind }: FilterState): Choice[] {
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
  ];
}

/** Keys the menus use for their own navigation; everything else types into a field. */
function keepTyping(event: KeyboardEvent<HTMLInputElement>) {
  if (event.key !== 'Escape' && event.key !== 'ArrowDown') event.stopPropagation();
}

/** A plugin `text` filter: applied on Enter or when the field loses the keyboard. Keyed by its value, so a change elsewhere resets it. */
function TextFilter({ filter, state }: { filter: PluginFilter; state: FilterState }) {
  const { param, label } = filter.definition;
  const value = state.filters.params?.[param] ?? '';
  const [draft, setDraft] = useState(value);
  const commit = () => {
    if (draft.trim() !== value) state.setParam(param, draft.trim() || undefined);
  };
  return (
    <label className="filter-row filter-text-row" data-active={value ? '' : undefined} data-testid={pluginTestId(filter)}>
      <span className="filter-row-label">{label}</span>
      <input
        className="filter-text-input"
        value={draft}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={(event) => {
          keepTyping(event);
          if (event.key === 'Enter') commit();
        }}
        onBlur={commit}
      />
    </label>
  );
}

/** The plugins' switch and text filters (their choices are rows with the built-in ones). */
function PluginFilterRows({ plugins, state, Switch }: { plugins: readonly PluginFilter[]; state: FilterState; Switch: typeof SwitchRow }) {
  return plugins.map((filter) =>
    filter.definition.type === 'switch' ? (
      <Switch
        key={filter.key}
        label={filter.definition.label}
        checked={Boolean(state.filters.params?.[filter.definition.param])}
        onChange={(value) => state.setParam(filter.definition.param, value ? '1' : undefined)}
        testId={pluginTestId(filter)}
      />
    ) : filter.definition.type === 'text' ? (
      <TextFilter key={`${filter.key}=${state.filters.params?.[filter.definition.param] ?? ''}`} filter={filter} state={state} />
    ) : null,
  );
}

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
      <DropdownMenuSubTrigger className="filter-row" data-active={active || undefined} data-testid={choice.testId}>
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
            onKeyDown={keepTyping}
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

interface SwitchProps {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  testId?: string;
}

function SwitchRow({ label, checked, onChange, testId }: SwitchProps) {
  return (
    <DropdownMenuCheckboxItem
      closeOnClick={false}
      checked={checked}
      onCheckedChange={(value: boolean) => onChange(value)}
      className="filter-row filter-switch-row"
      data-active={checked || undefined}
      data-testid={testId}
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
  const plugins = usePluginSnapshot().filters;
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
        {[...choiceRows(state), ...pluginChoices(plugins, state)].map((choice) => (
          <ChoiceSubmenu key={choice.key} choice={choice} />
        ))}
        <SwitchRow label="Has errors" checked={Boolean(filters.errors)} onChange={(value) => update('errors', value ? true : undefined)} />
        <PluginFilterRows plugins={plugins} state={state} Switch={SwitchRow} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ---------- Phones: the same rows in a bottom sheet ---------- */

function SheetSwitch({ label, checked, onChange, testId }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className="filter-row filter-switch-row"
      data-active={checked || undefined}
      data-testid={testId}
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
  const plugins = usePluginSnapshot().filters;
  const choices = [...choiceRows(state), ...pluginChoices(plugins, state)];
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
                data-testid={choice.testId}
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
            <PluginFilterRows plugins={plugins} state={state} Switch={SheetSwitch} />
          </>
        )}
        <DrawerFooter className="sheet-footer">
          <DrawerClose render={<Button variant="secondary" className={cn('h-[44px] w-full text-[13px]')} />}>Done</DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
