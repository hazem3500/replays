import { createFileRoute, notFound } from '@tanstack/react-router';

import { editingEnabled } from '../config.ts';
import { EditPage } from '../pages/EditPage.tsx';
import { editorPage, warm } from '../routing/pages.ts';

/** Edit mode; without edit capability (the host's, or this person's Labs choice) there is no such page. */
export const Route = createFileRoute('/r/$id/edit')({
  beforeLoad: () => {
    if (!editingEnabled()) throw notFound();
  },
  loader: () => warm(editorPage),
  component: function Edit() {
    const { id } = Route.useParams();
    return <EditPage key={id} id={id} />;
  },
});
