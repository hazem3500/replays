import { EmptyState, type EmptyStateProps } from '@/components/ui/empty-state.tsx';

import type { ProfileInfo } from '../../shared/profiles.ts';
import type { AutoRetry } from '../hooks/use-auto-retry.ts';

/** Every string the index's empty and error states show. */
export const indexEmptyStrings = {
  unreachableTitle: (product: string) => `Can’t reach the ${product} server`,
  unreachableBody: 'Check your connection or VPN. The list loads as soon as the server answers.',
  failedTitle: 'The list didn’t load',
  failedBody: (reason: string) => `${reason}. This is usually temporary.`,
  offlineTitle: 'Offline',
  offlineBody: 'Showing saved results from your last visit.',
  staleTitle: 'Couldn’t refresh',
  staleBody: 'Showing saved results; they may be out of date.',
  tryAgain: 'Try again',
  profileTitle: (label: string) => `No ${label.toLowerCase()} yet`,
  profileBody: (label: string) => `Replays uploaded or recorded as ${label} are listed here.`,
  profileKept: (days: number) => (days === 0 ? ' They’re kept until deleted.' : ` Each is kept ${days} ${days === 1 ? 'day' : 'days'}.`),
  upload: 'Upload a replay',
  showAll: 'Show all replays',
  searchTitle: (query: string) => `No results for “${query}”`,
  searchBody: 'Search matches replay titles, page addresses and IDs. Check the spelling, or try part of the address.',
  searchNarrowedBody: 'Search matches replay titles, page addresses and IDs, within the filters below.',
  clearSearch: 'Clear search',
  searchEverything: 'Search all replays',
  filteredTitle: 'No replays match these filters',
  filteredBody: 'Remove a filter, or clear them all to see every replay.',
  clearFilters: 'Clear filters',
  activeFilters: 'Active filters',
  retryIn: (seconds: number) => `Retrying in ${seconds}s`,
  retrying: 'Retrying…',
} as const;

const S = indexEmptyStrings;

/** Nothing to show and the list didn't load. */
interface ErrorInput {
  kind: 'error';
  product: string;
  /** The server can't be reached at all (no response, or a proxy's 502 to 504). */
  connection: boolean;
  reason: string;
  retry: AutoRetry;
}

/** The saved list is shown, but refreshing it failed. */
interface OfflineInput {
  kind: 'offline';
  connection: boolean;
  retry: AutoRetry;
}

/** A profile tab with nothing in it, and no other filter on. */
interface ProfileInput {
  kind: 'profile';
  profile: ProfileInfo;
  onShowAll: () => void;
}

/** A search found nothing. `narrowing`: the other active filters (and profile), by name. */
interface SearchInput {
  kind: 'search';
  query: string;
  narrowing: readonly string[];
  onClearSearch: () => void;
  onSearchEverything: () => void;
}

/** Filters (no search) left nothing. */
interface FilteredInput {
  kind: 'filtered';
  active: readonly string[];
  onClearFilters: () => void;
}

export type IndexEmptyInput = ErrorInput | OfflineInput | ProfileInput | SearchInput | FilteredInput;

function retryStatus(retry: AutoRetry) {
  return { status: retry.secondsLeft === undefined ? S.retrying : S.retryIn(retry.secondsLeft) };
}

const filterChips = (items: readonly string[]) => ({ chips: { label: S.activeFilters, items } });

function errorState(input: ErrorInput): EmptyStateProps {
  const retry = { id: 'retry', label: S.tryAgain, primary: true, onSelect: input.retry.retryNow };
  if (input.connection)
    return {
      tone: 'offline',
      title: S.unreachableTitle(input.product),
      body: S.unreachableBody,
      details: retryStatus(input.retry),
      actions: [retry],
      testId: 'index-error',
    };
  return {
    tone: 'error',
    title: S.failedTitle,
    body: S.failedBody(input.reason.replace(/\.$/, '')),
    details: retryStatus(input.retry),
    actions: [retry],
    testId: 'index-error',
  };
}

function offlineState(input: OfflineInput): EmptyStateProps {
  return {
    tone: 'offline',
    variant: 'banner',
    icon: input.connection ? 'offline' : 'alert',
    title: input.connection ? S.offlineTitle : S.staleTitle,
    body: input.connection ? S.offlineBody : S.staleBody,
    details: retryStatus(input.retry),
    actions: [{ id: 'retry', label: S.tryAgain, onSelect: input.retry.retryNow }],
    testId: 'index-offline',
  };
}

function profileState({ profile, onShowAll }: ProfileInput, onUpload?: () => void): EmptyStateProps {
  const kept = profile.retentionDays === undefined ? '' : S.profileKept(profile.retentionDays);
  const upload = onUpload ? [{ id: 'upload', label: S.upload, primary: true, onSelect: onUpload }] : [];
  return {
    icon: 'folder',
    title: S.profileTitle(profile.label),
    body: S.profileBody(profile.label) + kept,
    actions: [...upload, { id: 'show-all', label: S.showAll, primary: !onUpload, onSelect: onShowAll }],
    testId: 'index-empty-profile',
  };
}

function searchState(input: SearchInput): EmptyStateProps {
  const narrowed = input.narrowing.length > 0;
  const everything = narrowed ? [{ id: 'search-everything', label: S.searchEverything, onSelect: input.onSearchEverything }] : [];
  return {
    icon: 'search',
    title: S.searchTitle(input.query),
    body: narrowed ? S.searchNarrowedBody : S.searchBody,
    details: filterChips(input.narrowing),
    actions: [{ id: 'clear-search', label: S.clearSearch, primary: true, onSelect: input.onClearSearch }, ...everything],
    testId: 'index-empty-search',
  };
}

function filteredState(input: FilteredInput): EmptyStateProps {
  return {
    icon: 'filter',
    title: S.filteredTitle,
    body: S.filteredBody,
    details: filterChips(input.active),
    actions: [{ id: 'clear-filters', label: S.clearFilters, primary: true, onSelect: input.onClearFilters }],
    testId: 'index-empty-filtered',
  };
}

/**
 * The index's empty and error states as EmptyState data: the list exists, but this view of it is empty or could not
 * refresh. The first-run state (no replays at all) is FirstRun.tsx. `onUpload` is separate from the input so a
 * ref-backed handler (the upload dialog) can arrive as a JSX prop.
 */
export function indexEmptyState(input: IndexEmptyInput, onUpload?: () => void): EmptyStateProps {
  switch (input.kind) {
    case 'error':
      return errorState(input);
    case 'offline':
      return offlineState(input);
    case 'profile':
      return profileState(input, onUpload);
    case 'search':
      return searchState(input);
    case 'filtered':
      return filteredState(input);
  }
}

/** The index's empty/error state. `onUpload` opens the upload dialog (offered on an empty profile tab). */
export function IndexEmpty({ input, onUpload }: { input: IndexEmptyInput; onUpload?: () => void }) {
  return <EmptyState {...indexEmptyState(input, onUpload)} />;
}
