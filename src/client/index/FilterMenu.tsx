/*
 * The index filters: tokens + popover on desktop (filters/FilterPopover.tsx), a bottom sheet on phones
 * (filters/FilterSheet.tsx), both rendered from one data model (filters/model.ts).
 */
export { FilterMenu } from './filters/FilterPopover.tsx';
export { FilterSheet } from './filters/FilterSheet.tsx';
export {
  activeFilters,
  activeFilterTokens,
  filterStrings,
  handleAccepted,
  KIND_OPTIONS,
  pluginFilterLabel,
  SOURCE_OPTIONS,
} from './filters/model.ts';
export type { FilterState, FilterToken, LinkableHandle, PluginFilter } from './filters/model.ts';
