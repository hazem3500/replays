import { createFileRoute, redirect } from '@tanstack/react-router';

import { viewerSearchSchema } from '../../shared/schemas/search.ts';
import { compareSearchParams } from '../compare/compare-search.ts';
import { editsQuery } from '../edits.ts';
import { replayQuery } from '../queries.ts';

/** A replay: playback (`/r/<id>`) and edit mode (`/r/<id>/edit`) share its bundle. */
export const Route = createFileRoute('/r/$id')({
  // why: compare state reads and writes through compare-search.ts, so the route keeps its keys the same way.
  validateSearch: (raw: Record<string, unknown>) => ({ ...viewerSearchSchema.parse(raw), ...compareSearchParams(raw) }),
  beforeLoad: ({ params, search }) => {
    // why: older suite links (`/r/<id>?suite=<suite>`) open the run in its suite workspace.
    if (search.suite)
      throw redirect({
        to: '/s/$suiteId/r/$replayId',
        params: { suiteId: search.suite, replayId: params.id },
        search: ({ suite: _suite, ...rest }) => rest,
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
