import { createFileRoute } from '@tanstack/react-router';

import { ReplayPage } from '../pages/ReplayPage.tsx';
import { loadViewer } from '../routing/pages.ts';

export const Route = createFileRoute('/r/$id/')({
  loader: () => void loadViewer().catch(() => undefined),
  component: function Replay() {
    const { id } = Route.useParams();
    return <ReplayPage key={id} id={id} />;
  },
});
