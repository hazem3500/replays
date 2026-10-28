import type { ReactNode } from 'react';

import { type CommentRows, useCommentRows } from '../data/comments.ts';

/** One replay's comment rows, handed to `children`; a chunk of its own, with the TanStack DB data layer. */
export function CommentRowsSource({ replayId, children }: { replayId: string; children: (rows: CommentRows) => ReactNode }) {
  return children(useCommentRows(replayId));
}
