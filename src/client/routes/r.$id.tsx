import { createFileRoute } from '@tanstack/react-router';

import { viewerSearchSchema } from '../../shared/schemas/search.ts';
import { compareSearchParams } from '../compare/compare-search.ts';
import { editsQuery } from '../edits.ts';
import { replayQuery } from '../queries.ts';

/** A replay: playback (`/r/<id>`) and edit mode (`/r/<id>/edit`) share its bundle. */
export const Route = createFileRoute('/r/$id')({
  // why: the player, the suite workspace and plugin pages are browser-only; the server sends the document.
  ssr: false,
  validateSearch: (raw: Record<string, unknown>) => ({ ...viewerSearchSchema.parse(raw), ...compareSearchParams(raw) }),
  // why: started here (a hover may have started it already), never awaited: the page shows its skeleton meanwhile.
  loader: ({ context: { queryClient }, params }) => {
    void queryClient.query(replayQuery(params.id)).catch(() => {});
    void queryClient.query(editsQuery(params.id)).catch(() => {});
  },
});
