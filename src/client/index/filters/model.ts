import { compileHandlePattern } from '../../../shared/people.ts';
import type { ReplayFilters, ReplaySource } from '../../../shared/replay.ts';
import { resolveSlot, type Snapshot } from '../../plugins/registry.ts';
import type { SlotDescriptor } from '../../plugins/slots.ts';
import type { IndexKind } from '../../ReplayIndex.tsx';

/*
 * The index filters as data: one ordered list of rows (`index.filters`, built-ins as `core:*`, plugin filters as
 * `plugin:<owner>:<id>`, shaped as slot descriptors so the plugin registry can merge into it), and the active
 * filters as tokens (`index.chips`). No React here: FilterMenu, FilterSheet and the tokens render from it.
 */

/** Every user-visible string of the index filters. */
export const filterStrings = {
  filter: 'Filter',
  filters: 'Filters',
  clearAll: 'Clear all',
  clear: 'Clear',
  reset: 'Reset',
  back: 'Back to filters',
  done: 'Done',
  forMe: 'For me',
  hasErrors: 'Has errors',
  all: 'All',
  allHosts: 'All hosts',
  allTags: 'All tags',
  host: 'Host',
  tag: 'Tag',
  source: 'Source',
  kind: 'Kind',
  agentRuns: 'Agent runs',
  imported: 'Imported',
  suites: 'Suites',
  sessions: 'Sessions',
  activeFilters: 'Active filters',
  clearSearch: 'Clear search',
  yourHandle: (label: string) => `Your ${label}`,
  searchLabel: (label: string) => `Search ${label.toLowerCase()}s`,
  searchPlaceholder: (label: string) => `Search ${label.toLowerCase()}s…`,
  noMatch: (label: string) => `No matching ${label.toLowerCase()}s`,
  filterBy: (label: string) => `Filter by ${label}`,
  trigger: (active: number) => (active ? `Filter, ${active} active` : 'Filter'),
  sheetTrigger: (active: number) => (active ? `Filters, ${active} active` : 'Filters'),
  removeToken: (name: string) => `Remove filter: ${name}`,
  editToken: (name: string) => `Change filter: ${name}`,
  more: (count: number) => `+${count}`,
  moreLabel: (count: number) => `${count} more active ${count === 1 ? 'filter' : 'filters'}`,
} as const;

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
  { value: undefined, label: filterStrings.all },
  { value: 'agent', label: filterStrings.agentRuns },
  // why: `human` stays the stored value and `?source=` param; people see it as an imported recording.
  { value: 'human', label: filterStrings.imported },
];

export const KIND_OPTIONS: Array<{ value: IndexKind | undefined; label: string }> = [
  { value: undefined, label: filterStrings.all },
  { value: 'suites', label: filterStrings.suites },
  { value: 'sessions', label: filterStrings.sessions },
];

export function activeFilters({ filters, kind, forMe }: Pick<FilterState, 'filters' | 'kind' | 'forMe'>) {
  return (
    [filters.host, filters.tag, filters.source, kind, filters.errors, forMe].filter(Boolean).length +
    Object.keys(filters.params ?? {}).length
  );
}

export type PluginFilter = Snapshot['filters'][number];

export const pluginTestId = (filter: PluginFilter) => `plugin-filter:${filter.plugin}:${filter.definition.id}`;

/** What a plugin filter's current value reads as (an option's label, the text, or the switch's own label). */
export function pluginFilterLabel(filter: PluginFilter, value: string) {
  const { definition } = filter;
  if (definition.type === 'switch') return definition.label;
  if (definition.type === 'choice') return definition.options?.find((option) => option.value === value)?.label ?? value;
  return `${definition.label}: ${value}`;
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

export interface Choice {
  key: string;
  label: string;
  value: string | undefined;
  options: ReadonlyArray<{ value: string | undefined; label: string }>;
  onChange: (value?: string) => void;
  testId?: string;
}

export interface SwitchFilter {
  key: string;
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  icon: 'for-me' | 'errors' | 'plugin';
  testId?: string;
}

/** One row of the filter list; `group` decides where the hairlines fall (people, facets, status). */
export type FilterRow = { group: 'people' | 'facets' | 'status' } & (
  | { type: 'choice'; choice: Choice }
  | { type: 'switch'; filter: SwitchFilter }
  | { type: 'text'; filter: PluginFilter }
);

/** The built-in filters as `index.filters` slot descriptors (100, 200, …; For me first). */
export function coreFilterDescriptors(state: FilterState): Array<SlotDescriptor<FilterState, FilterRow>> {
  const { filters, kind, hosts, tags, update, setKind } = state;
  const built: Array<SlotDescriptor<FilterState, FilterRow>> = [
    {
      id: 'core:for-me',
      order: 50,
      when: (context) => Boolean(context.setForMe),
      render: (context) => ({
        group: 'people',
        type: 'switch',
        filter: { key: 'for-me', label: filterStrings.forMe, checked: Boolean(context.forMe), onChange: context.setForMe!, icon: 'for-me' },
      }),
    },
    {
      id: 'core:host',
      order: 100,
      render: () => ({
        group: 'facets',
        type: 'choice',
        choice: {
          key: 'host',
          label: filterStrings.host,
          value: filters.host,
          options: [{ value: undefined, label: filterStrings.allHosts }, ...hosts.map((host) => ({ value: host, label: host }))],
          onChange: (value?: string) => update('host', value),
        },
      }),
    },
    {
      id: 'core:tag',
      order: 200,
      when: () => tags.length > 0 || Boolean(filters.tag),
      render: () => ({
        group: 'facets',
        type: 'choice',
        choice: {
          key: 'tag',
          label: filterStrings.tag,
          value: filters.tag,
          options: [{ value: undefined, label: filterStrings.allTags }, ...tags.map((tag) => ({ value: tag, label: tag }))],
          onChange: (value?: string) => update('tag', value),
        },
      }),
    },
    {
      id: 'core:source',
      order: 300,
      render: () => ({
        group: 'facets',
        type: 'choice',
        choice: {
          key: 'source',
          label: filterStrings.source,
          value: filters.source,
          options: SOURCE_OPTIONS,
          onChange: (value?: string) => update('source', value as ReplaySource | undefined),
        },
      }),
    },
    {
      id: 'core:kind',
      order: 400,
      render: () => ({
        group: 'facets',
        type: 'choice',
        choice: {
          key: 'kind',
          label: filterStrings.kind,
          value: kind,
          options: KIND_OPTIONS,
          onChange: (value?: string) => setKind(value as IndexKind | undefined),
        },
      }),
    },
    {
      id: 'core:errors',
      order: 500,
      render: () => ({
        group: 'status',
        type: 'switch',
        filter: {
          key: 'errors',
          label: filterStrings.hasErrors,
          checked: Boolean(filters.errors),
          onChange: (value: boolean) => update('errors', value ? true : undefined),
          icon: 'errors',
        },
      }),
    },
  ];
  return built;
}

/** A plugin filter's row; plugins keep their own `order` (the registry places them after the built-ins). */
function pluginRow(filter: PluginFilter, context: FilterState): FilterRow {
  const { definition } = filter;
  if (definition.type === 'choice')
    return {
      group: 'facets',
      type: 'choice',
      choice: {
        key: filter.key,
        label: definition.label,
        value: context.filters.params?.[definition.param],
        options: [{ value: undefined, label: filterStrings.all }, ...(definition.options ?? [])],
        onChange: (value?: string) => context.setParam(definition.param, value),
        testId: pluginTestId(filter),
      },
    };
  if (definition.type === 'switch')
    return {
      group: 'status',
      type: 'switch',
      filter: {
        key: filter.key,
        label: definition.label,
        checked: Boolean(context.filters.params?.[definition.param]),
        onChange: (value: boolean) => context.setParam(definition.param, value ? '1' : undefined),
        icon: 'plugin',
        testId: pluginTestId(filter),
      },
    };
  return { group: 'status', type: 'text', filter };
}

/**
 * The visible rows in order: the `index.filters` slot resolved through the plugin registry, so its hide/order
 * configuration applies to built-ins and plugin filters alike. Plugin items render from their snapshot entry
 * (same `plugin:<owner>:<id>` key), which also re-renders this list when plugins change.
 */
export function filterRows(state: FilterState, plugins: readonly PluginFilter[]) {
  const byKey = new Map(plugins.map((filter) => [filter.key, filter]));
  return resolveSlot<FilterState, unknown>('index.filters', coreFilterDescriptors(state), state).flatMap((descriptor) => {
    if (descriptor.id.startsWith('core:')) return [{ id: descriptor.id, row: descriptor.render(state) as FilterRow }];
    const filter = byKey.get(descriptor.id);
    return filter ? [{ id: descriptor.id, row: pluginRow(filter, state) }] : [];
  });
}

export type ResolvedFilterRows = ReturnType<typeof filterRows>;

export const choicesOf = (rows: ResolvedFilterRows) =>
  rows.flatMap(({ row }) => (row.type === 'choice' ? [row.choice] : []));

export const valueLabel = (choice: Choice) => choice.options.find((option) => option.value === choice.value)?.label ?? choice.options[0]!.label;

export interface FilterToken {
  /** Slot item id: `core:host`, `plugin:<owner>:<id>`. */
  id: string;
  /** The field ("Host"); absent for switches, which read as their own label ("Has errors"). */
  field?: string;
  value: string;
  /** The accessible name: "Host shop.example". */
  name: string;
  /** The choice pane a click opens (undefined: the main list, focused on this row). */
  pane?: string;
  /** The row to focus when the token opens the menu. */
  rowKey: string;
  remove: () => void;
}

/** The active filters in list order, one token each. */
export function activeFilterTokens(state: FilterState, plugins: readonly PluginFilter[]): FilterToken[] {
  const tokens: FilterToken[] = [];
  for (const { id, row } of filterRows(state, plugins)) {
    if (row.type === 'choice' && row.choice.value !== undefined) {
      const { choice } = row;
      const value = valueLabel(choice);
      tokens.push({ id, field: choice.label, value, name: `${choice.label} ${value}`, pane: choice.key, rowKey: choice.key, remove: () => choice.onChange(undefined) });
    } else if (row.type === 'switch' && row.filter.checked) {
      const { filter } = row;
      tokens.push({ id, value: filter.label, name: filter.label, rowKey: filter.key, remove: () => filter.onChange(false) });
    } else if (row.type === 'text') {
      const value = state.filters.params?.[row.filter.definition.param];
      if (value)
        tokens.push({
          id,
          field: row.filter.definition.label,
          value,
          name: `${row.filter.definition.label} ${value}`,
          rowKey: row.filter.key,
          remove: () => state.setParam(row.filter.definition.param, undefined),
        });
    }
  }
  // why: a param whose plugin has not loaded (yet) shows as itself, so it can still be removed.
  const known = new Set(plugins.map((filter) => filter.definition.param));
  for (const [param, value] of Object.entries(state.filters.params ?? {})) {
    if (known.has(param)) continue;
    tokens.push({ id: `param:${param}`, field: param, value, name: `${param} ${value}`, rowKey: param, remove: () => state.setParam(param, undefined) });
  }
  return tokens;
}
