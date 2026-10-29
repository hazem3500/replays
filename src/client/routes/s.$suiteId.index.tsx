import { createFileRoute } from '@tanstack/react-router';

/** `/s/<suite>`: the workspace (the parent route) picks the run it lands on. */
export const Route = createFileRoute('/s/$suiteId/')({});
