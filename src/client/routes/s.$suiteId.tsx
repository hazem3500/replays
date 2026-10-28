import { createFileRoute, useParams } from '@tanstack/react-router';

import { runSearchSchema } from '../../shared/schemas/search.ts';
import { SuitePage } from '../pages/SuitePage.tsx';
import { suiteQuery } from '../queries.ts';
import { loadSuiteWorkspace } from '../routing/pages.ts';

/**
 * The suite workspace: its runs beside the viewer, on the run in the address (`/s/<suite>/r/<id>`), or on its first
 * failed run (else the first recording) at `/s/<suite>`. Switching runs keeps this page mounted.
 */
export const Route = createFileRoute('/s/$suiteId')({
  validateSearch: runSearchSchema,
  // why: not awaited: the workspace shows its skeleton inside the page transition, and its own error states.
  loader: ({ context: { queryClient }, params }) => {
    void loadSuiteWorkspace().catch(() => undefined);
    void queryClient.prefetchQuery(suiteQuery(params.suiteId));
  },
  component: function Suite() {
    const { suiteId } = Route.useParams();
    const { replayId } = useParams({ strict: false });
    return <SuitePage key={suiteId} id={suiteId} replayId={replayId} />;
  },
});
