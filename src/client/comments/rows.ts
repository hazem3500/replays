import type * as RowsSource from './CommentRowsSource.tsx';

let loading: Promise<typeof RowsSource> | undefined;

/** The comment rows and their data layer (TanStack DB) as a chunk of their own: the index page's entry never carries them. */
export const loadCommentRowsSource = () => (loading ??= import('./CommentRowsSource.tsx'));
