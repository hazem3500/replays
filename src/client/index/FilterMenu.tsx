import {
  BotIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  GlobeIcon,
  LayersIcon,
  SlidersHorizontalIcon,
  TagIcon,
  UserRoundIcon,
} from 'lucide-react';
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';

import { compileHandlePattern } from '../../shared/people.ts';
import type { ReplayFilters, ReplaySource } from '../../shared/replay.ts';
import { AnimatedIcon } from '@/components/animated-icon.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Drawer, DrawerClose, DrawerContent, DrawerFooter, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover.tsx';
import { cn } from '@/lib/utils.ts';

import { usePluginSnapshot } from '../plugins/PluginUi.tsx';
import type { Snapshot } from '../plugins/registry.ts';
import type { IndexKind } from '../ReplayIndex.tsx';

/*
 * The index's filters as one compact popover with in-place choice panels, no section
 * hairlines. For me (only where people exist) and Has errors are switches; Host, Tag, Source and Kind show their value
 * and open an in-place panel with checkmarks (Host and Tag are searchable past eight). Keyboard: arrows move between rows, Right/Enter opens a panel,
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
  /** "For me" (`for=me`); absent (no switch) when neither the deployment nor the list has people. */
  forMe?: boolean;
  setForMe?: (value: boolean) => void;
  /** The handles a person can link for For me (`GET /api/me`), the values linked in this browser, and the setter. */
  handles?: readonly LinkableHandle[];
  linked?: Readonly<Record<string, string>>;
  setLinked?: (id: string, value: string) => void;
}

/** A handle the deployment matches people by (`api.people({ handles })`). */
export interface LinkableHandle {
  id: string;
  label: string;
  pattern: string;
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

export function activeFilters({ filters, kind, forMe }: Pick<FilterState, 'filters' | 'kind' | 'forMe'>) {
  return (
    [filters.host, filters.tag, filters.source, kind, filters.errors, forMe].filter(Boolean).length +
    Object.keys(filters.params ?? {}).length
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

/** True when `value` is empty (unlinks) or matches the handle's pattern, as the server checks it. */
export function handleAccepted(handle: LinkableHandle, value: string) {
  if (!value) return true;
  try {
    return compileHandlePattern(handle.pattern).test(value);
  } catch {
    return false;
  }
}

/**
 * The handles For me also matches by ("GitHub username"), one field each, saved in this browser on Enter or blur.
 * A value that does not fit the handle's pattern is marked and not saved.
 */
function HandleFields({
  handles,
  linked,
  onSave,
}: {
  handles: readonly LinkableHandle[];
  linked: Readonly<Record<string, string>>;
  onSave: (id: string, value: string) => void;
}) {
  const [invalid, setInvalid] = useState<Record<string, boolean>>({});
  const save = (handle: LinkableHandle, raw: string) => {
    const value = raw.trim();
    const ok = handleAccepted(handle, value);
    setInvalid((current) => ({ ...current, [handle.id]: !ok }));
    if (ok && value !== (linked[handle.id] ?? '')) onSave(handle.id, value);
  };
  return (
    <div className="filter-handles">
      {handles.map((handle) => (
        <label key={handle.id} className="filter-handle">
          <span>Your {handle.label}</span>
          <input
            className="filter-handle-input"
            data-testid={`for-me-handle-${handle.id}`}
            defaultValue={linked[handle.id] ?? ''}
            placeholder={handle.label}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={invalid[handle.id] || undefined}
            onBlur={(event) => save(handle, event.currentTarget.value)}
            // Typing belongs to the field, not to the menu's typeahead and arrow keys (Escape still closes).
            onKeyDown={(event) => {
              if (event.key === 'Escape') return;
              event.stopPropagation();
              if (event.key === 'Enter') save(handle, event.currentTarget.value);
            }}
          />
        </label>
      ))}
    </div>
  );
}

/** The fields under For me while it is on (and the deployment has handles to link). */
function forMeFields({ forMe, handles, linked, setLinked }: FilterState) {
  return forMe && handles?.length && setLinked ? <HandleFields handles={handles} linked={linked ?? {}} onSave={setLinked} /> : null;
}

const SEARCH_OPTIONS_PAST = 8;

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
function PluginFilterRows({
  plugins,
  state,
  Switch,
}: {
  plugins: readonly PluginFilter[];
  state: FilterState;
  Switch: typeof SheetSwitch;
}) {
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

function ChoiceIcon({ name }: { name: string }) {
  const Icon =
    ({ host: GlobeIcon, tag: TagIcon, source: BotIcon, kind: LayersIcon } as Record<string, typeof GlobeIcon>)[name] ??
    SlidersHorizontalIcon;
  return <Icon className="filter-kind-icon" aria-hidden="true" />;
}

/* ---------- Desktop: the Filter menu ---------- */

function ChoiceOptions({ choice, onBack }: { choice: Choice; onBack: () => void }) {
  const [query, setQuery] = useState('');
  const searchInput = useRef<HTMLInputElement>(null);
  const searchable = choice.key === 'host' || choice.key === 'tag' || choice.options.length > SEARCH_OPTIONS_PAST;
  const options = useMemo(
    () => choice.options.filter((option) => !searchable || option.label.toLowerCase().includes(query.toLowerCase())),
    [choice.options, query, searchable],
  );
  return (
    <div className="filter-pane">
      <div className="filter-choice-head">
        <Button variant="ghost" size="icon-sm" onClick={onBack} aria-label="Back to filters">
          <ChevronLeftIcon aria-hidden="true" />
        </Button>
        <span className="filter-menu-title">{choice.label}</span>
        {choice.value !== undefined ? (
          <Button
            variant="ghost"
            size="xs"
            className="filter-choice-reset"
            onClick={() => {
              choice.onChange(undefined);
              onBack();
            }}
          >
            Reset
          </Button>
        ) : null}
      </div>
      {searchable ? (
        <input
          ref={searchInput}
          className="filter-search"
          aria-label={`Search ${choice.label.toLowerCase()}s`}
          placeholder={`Search ${choice.label.toLowerCase()}s…`}
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              event.currentTarget.parentElement?.querySelector<HTMLElement>('[role="option"]')?.focus();
            }
          }}
        />
      ) : null}
      <div
        className="filter-choice-list"
        role="listbox"
        aria-label={choice.label}
        onKeyDown={(event) => {
          const rows = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="option"]')];
          const position = rows.indexOf(document.activeElement as HTMLElement);
          let next: number | undefined;
          if (event.key === 'ArrowDown') next = (position + 1) % rows.length;
          if (event.key === 'ArrowUp') next = (position - 1 + rows.length) % rows.length;
          if (event.key === 'Home') next = 0;
          if (event.key === 'End') next = rows.length - 1;
          if (next !== undefined) {
            event.preventDefault();
            rows[next]?.focus();
          }
        }}
      >
        {options.map((option, index) => (
          <button
            key={option.label}
            type="button"
            role="option"
            aria-selected={option.value === choice.value}
            className="filter-choice-option"
            tabIndex={
              option.value === choice.value || (index === 0 && !options.some((candidate) => candidate.value === choice.value)) ? 0 : -1
            }
            onClick={() => {
              choice.onChange(option.value);
              onBack();
            }}
          >
            <span>{option.label}</span>
            {option.value === choice.value ? <CheckIcon aria-hidden="true" /> : null}
          </button>
        ))}
      </div>
      {!options.length ? (
        <div className="filter-empty" role="status">
          No matching {choice.label.toLowerCase()}s
          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              setQuery('');
              searchInput.current?.focus();
            }}
          >
            Clear search
          </Button>
        </div>
      ) : null}
    </div>
  );
}

interface SwitchProps {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  testId?: string;
}

/** Desktop: one quiet "Filter" button (icon, label, active count) opening the filter menu. */
export function FilterMenu(state: FilterState) {
  const { filters, clearFilters, update } = state;
  const active = activeFilters(state);
  const plugins = usePluginSnapshot().filters;
  const [panel, setPanel] = useState<string>();
  const previousPanel = useRef<string | undefined>(undefined);
  useEffect(() => {
    const previous = previousPanel.current;
    previousPanel.current = panel;
    if (!panel && !previous) return;
    const frame = requestAnimationFrame(() => {
      const popup = document.querySelector<HTMLElement>('[data-filter-menu]');
      const target = panel
        ? popup?.querySelector<HTMLElement>('.filter-search, [role="option"][aria-selected="true"], [role="option"]')
        : popup?.querySelector<HTMLElement>(`[data-filter-key="${CSS.escape(previous!)}"]`);
      target?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [panel]);
  const choices = [...choiceRows(state), ...pluginChoices(plugins, state)];
  const selected = choices.find((choice) => choice.key === panel);
  return (
    <Popover
      onOpenChange={(open, details) => {
        // Base UI listens for Escape before the popup's React key handler. Cancel its dismissal when
        // leaving a choice pane, so the first Escape goes back and the next one closes the popover.
        if (!open && panel && details.reason === 'escape-key') {
          details.cancel();
          setPanel(undefined);
          return;
        }
        if (!open) setPanel(undefined);
      }}
    >
      <PopoverTrigger className="scope-button" aria-label={active ? `Filter, ${active} active` : 'Filter'}>
        <AnimatedIcon name="sliders-horizontal" />
        Filter
        {active ? (
          <span className="scope-badge" aria-hidden="true">
            {active}
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent
        data-filter-menu=""
        align="end"
        className="filter-menu w-[264px] max-w-[calc(100vw-24px)] gap-0 p-1"
        aria-label={selected ? `Filter by ${selected.label}` : 'Filters'}
        onKeyDown={(event) => {
          if (!selected && event.target instanceof HTMLButtonElement && event.target.matches('.filter-row')) {
            const rows = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button.filter-row')];
            const position = rows.indexOf(event.target);
            let next: number | undefined;
            if (event.key === 'ArrowDown') next = (position + 1) % rows.length;
            if (event.key === 'ArrowUp') next = (position - 1 + rows.length) % rows.length;
            if (event.key === 'Home') next = 0;
            if (event.key === 'End') next = rows.length - 1;
            if (next !== undefined) {
              event.preventDefault();
              rows[next]?.focus();
            }
          }
          if (selected && (event.key === 'Escape' || (event.key === 'ArrowLeft' && !(event.target instanceof HTMLInputElement)))) {
            event.preventDefault();
            event.stopPropagation();
            setPanel(undefined);
          }
        }}
      >
        {selected ? (
          <ChoiceOptions key={selected.key} choice={selected} onBack={() => setPanel(undefined)} />
        ) : (
          <div key="filters" className="filter-pane">
            <div className="filter-menu-head">
              <span className="filter-menu-title">Filters</span>
              {active ? (
                <Button variant="ghost" size="xs" className="filter-menu-clear" onClick={clearFilters}>
                  Clear all
                </Button>
              ) : null}
            </div>
            {state.setForMe ? <SheetSwitch label="For me" checked={Boolean(state.forMe)} onChange={state.setForMe} /> : null}
            {forMeFields(state)}
            {choices.map((choice) => (
              <button
                type="button"
                key={choice.key}
                data-filter-key={choice.key}
                className="filter-row"
                data-active={choice.value !== undefined || undefined}
                data-testid={choice.testId}
                onClick={() => setPanel(choice.key)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowRight') {
                    event.preventDefault();
                    setPanel(choice.key);
                  }
                }}
              >
                <ChoiceIcon name={choice.key} />
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
          </div>
        )}
      </PopoverContent>
    </Popover>
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
      {label === 'Has errors' ? (
        <CircleAlertIcon className="filter-kind-icon" aria-hidden="true" />
      ) : label === 'For me' ? (
        <UserRoundIcon className="filter-kind-icon" aria-hidden="true" />
      ) : (
        <SlidersHorizontalIcon className="filter-kind-icon" aria-hidden="true" />
      )}
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
            {state.setForMe ? <SheetSwitch label="For me" checked={Boolean(state.forMe)} onChange={state.setForMe} /> : null}
            {forMeFields(state)}
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
