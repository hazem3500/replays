import { createFileRoute } from '@tanstack/react-router';

import { ReplayPage } from '../pages/ReplayPage.tsx';
import { viewerPage, warm } from '../routing/pages.ts';

export const Route = createFileRoute('/r/$id/')({
  loader: () => warm(viewerPage),
  component: function Replay() {
    const { id } = Route.useParams();
    return <ReplayPage key={id} id={id} />;
  },
});
