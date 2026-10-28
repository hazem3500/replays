import { createFileRoute } from '@tanstack/react-router';

import { editsQuery } from '../edits.ts';
import { replayQuery } from '../queries.ts';

/** A run in its suite: the workspace (the parent route) shows it; its data starts here. */
export const Route = createFileRoute('/s/$suiteId/r/$replayId')({
  loader: ({ context: { queryClient }, params }) => {
    void queryClient.prefetchQuery(replayQuery(params.replayId));
    void queryClient.prefetchQuery(editsQuery(params.replayId));
  },
});
