import { createFileRoute, redirect } from '@tanstack/react-router';

import { viewerSearchSchema } from '../../shared/schemas/search.ts';
import { editsQuery } from '../edits.ts';
import { replayQuery } from '../queries.ts';

/** A replay: playback (`/r/<id>`) and edit mode (`/r/<id>/edit`) share its bundle. */
export const Route = createFileRoute('/r/$id')({
  validateSearch: viewerSearchSchema,
  beforeLoad: ({ params, search }) => {
    // why: older suite links (`/r/<id>?suite=<suite>`) open the run in its suite workspace.
    if (search.suite)
      throw redirect({
        to: '/s/$suiteId/r/$replayId',
        params: { suiteId: search.suite, replayId: params.id },
        search: ({ suite: _suite, ...rest }: Record<string, unknown>) => rest,
        hash: true,
        replace: true,
      });
  },
  // why: started here (a hover may have started it already), never awaited: the page shows its skeleton meanwhile.
  loader: ({ context: { queryClient }, params }) => {
    void queryClient.query(replayQuery(params.id)).catch(() => {});
    void queryClient.query(editsQuery(params.id)).catch(() => {});
  },
});
