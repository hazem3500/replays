import type * as RowsSource from './CommentRowsSource.tsx';

let loading: Promise<typeof RowsSource> | undefined;

/** The comment rows and their data layer (TanStack DB) as a chunk of their own: the index page's entry never carries them. */
export const loadCommentRowsSource = () => (loading ??= import('./CommentRowsSource.tsx'));

const warm = () => void loadCommentRowsSource().catch(() => {});

/** Warms the chunk once the page is idle, so opening a replay does not wait for it. */
export function prefetchCommentRows() {
  if (typeof window === 'undefined') return;
  if ('requestIdleCallback' in window) window.requestIdleCallback(warm, { timeout: 3000 });
  else setTimeout(warm, 1500);
}
