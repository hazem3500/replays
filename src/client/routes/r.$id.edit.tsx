import { createFileRoute, redirect } from '@tanstack/react-router';

import { editingEnabled } from '../config.ts';
import { EditPage } from '../pages/EditPage.tsx';
import { loadEditor } from '../routing/pages.ts';

/** Edit mode. Without edit capability (the host's, or this person's Labs choice), edit links open playback at the same time and anchor. */
export const Route = createFileRoute('/r/$id/edit')({
  beforeLoad: ({ params }) => {
    if (!editingEnabled()) throw redirect({ to: '/r/$id', params, search: true, hash: true, replace: true });
  },
  loader: () => void loadEditor().catch(() => undefined),
  component: function Edit() {
    const { id } = Route.useParams();
    return <EditPage key={id} id={id} />;
  },
});
