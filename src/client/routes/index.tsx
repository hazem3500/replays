import { createFileRoute } from '@tanstack/react-router';

import { indexSearchSchema } from '../../shared/schemas/search.ts';

/**
 * The index. The root layout draws its page (routing/KeptIndex.tsx), which keeps it mounted behind viewer pages so Back
 * finds the same list, scroll and card; this route owns its address: filters, sort, view and purpose.
 */
export const Route = createFileRoute('/')({
  validateSearch: indexSearchSchema,
  component: () => null,
});
