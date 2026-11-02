import type { PurposeInfo } from '../../shared/purposes.ts';
import { EmptyState, type EmptyStateProps, emptyStateStrings } from '@/components/ui/empty-state.tsx';
import type { AutoRetry } from '../hooks/use-auto-retry.ts';

/*
 * The index's empty and error states as EmptyState data. The first-run state (no replays at all) is FirstRun.tsx;
 * everything here is "the list exists, but this view of it is empty or could not refresh".
 */

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
  purposeTitle: (label: string) => `No ${label.toLowerCase()} yet`,
  purposeBody: (label: string) => `Replays uploaded or recorded as ${label} are listed here.`,
  purposeKept: (days: number) => (days === 0 ? ' They’re kept until deleted.' : ` Each is kept ${days} ${days === 1 ? 'day' : 'days'}.`),
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
} as const;

const S = indexEmptyStrings;

export type IndexEmptyInput =
  /** Nothing to show and the list didn't load. */
  | { kind: 'error'; product: string; connection: boolean; reason: string; retry: AutoRetry }
  /** The saved list is shown, but refreshing it failed (`connection`: the server can't be reached at all). */
  | { kind: 'offline'; connection: boolean; retry: AutoRetry }
  /** A purpose tab with nothing in it, and no other filter on. */
  | { kind: 'purpose'; purpose: PurposeInfo; onShowAll: () => void }
  /** A search found nothing. `narrowing`: the other active filters (and purpose), by name. */
  | { kind: 'search'; query: string; narrowing: readonly string[]; onClearSearch: () => void; onSearchEverything: () => void }
  /** Filters (no search) left nothing. */
  | { kind: 'filtered'; active: readonly string[]; onClearFilters: () => void };

function retryStatus(retry: AutoRetry) {
  return retry.secondsLeft === undefined ? emptyStateStrings.retrying : emptyStateStrings.retryIn(retry.secondsLeft);
}

/** `onUpload` is separate from the input so a ref-backed handler (the upload dialog) can arrive as a JSX prop. */
export function indexEmptyState(input: IndexEmptyInput, onUpload?: () => void): EmptyStateProps {
  switch (input.kind) {
    case 'error':
      return {
        tone: input.connection ? 'offline' : 'error',
        icon: input.connection ? 'offline' : 'alert',
        title: input.connection ? S.unreachableTitle(input.product) : S.failedTitle,
        body: input.connection ? S.unreachableBody : S.failedBody(input.reason.replace(/\.$/, '')),
        status: retryStatus(input.retry),
        actions: [{ id: 'retry', label: S.tryAgain, primary: true, onSelect: input.retry.retryNow }],
        testId: 'index-error',
      };
    case 'offline':
      return {
        tone: 'offline',
        variant: 'banner',
        icon: input.connection ? 'offline' : 'alert',
        title: input.connection ? S.offlineTitle : S.staleTitle,
        body: input.connection ? S.offlineBody : S.staleBody,
        status: retryStatus(input.retry),
        actions: [{ id: 'retry', label: S.tryAgain, onSelect: input.retry.retryNow }],
        testId: 'index-offline',
      };
    case 'purpose': {
      const { label, retentionDays } = input.purpose;
      return {
        icon: 'folder',
        title: S.purposeTitle(label),
        body: S.purposeBody(label) + (retentionDays === undefined ? '' : S.purposeKept(retentionDays)),
        actions: [
          ...(onUpload ? [{ id: 'upload', label: S.upload, primary: true, onSelect: onUpload }] : []),
          { id: 'show-all', label: S.showAll, primary: !onUpload, onSelect: input.onShowAll },
        ],
        testId: 'index-empty-purpose',
      };
    }
    case 'search':
      return {
        icon: 'search',
        title: S.searchTitle(input.query),
        body: input.narrowing.length ? S.searchNarrowedBody : S.searchBody,
        chips: input.narrowing,
        chipsLabel: S.activeFilters,
        actions: [
          { id: 'clear-search', label: S.clearSearch, primary: true, onSelect: input.onClearSearch },
          ...(input.narrowing.length ? [{ id: 'search-everything', label: S.searchEverything, onSelect: input.onSearchEverything }] : []),
        ],
        testId: 'index-empty-search',
      };
    case 'filtered':
      return {
        icon: 'filter',
        title: S.filteredTitle,
        body: S.filteredBody,
        chips: input.active,
        chipsLabel: S.activeFilters,
        actions: [{ id: 'clear-filters', label: S.clearFilters, primary: true, onSelect: input.onClearFilters }],
        testId: 'index-empty-filtered',
      };
  }
}

/** The index's empty/error state. `onUpload` opens the upload dialog (offered on an empty purpose tab). */
export function IndexEmpty({ input, onUpload }: { input: IndexEmptyInput; onUpload?: () => void }) {
  return <EmptyState {...indexEmptyState(input, onUpload)} />;
}
