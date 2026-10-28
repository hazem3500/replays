import { createFileRoute, redirect } from '@tanstack/react-router';

/** `/r` and `/r/` (a replay link without its id) open the index. */
export const Route = createFileRoute('/r/')({
  beforeLoad: () => {
    throw redirect({ to: '/', replace: true });
  },
});
