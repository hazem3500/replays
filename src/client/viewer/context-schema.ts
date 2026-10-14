import { queryOptions, useQuery } from '@tanstack/react-query';

import type { ClientConfig, FieldSchema } from '../config.ts';
import { apiUrl } from '../route.ts';

/** `GET /api/config`; the deployment's configuration does not change while a page is open. */
const configQuery = queryOptions({
  queryKey: ['config'] as const,
  queryFn: async ({ signal }) => {
    const response = await fetch(apiUrl('config'), { signal });
    if (!response.ok) throw new Error(`Config failed to load (${response.status})`);
    return (await response.json()) as ClientConfig;
  },
  staleTime: Number.POSITIVE_INFINITY,
  retry: false,
});

/** The JSON Schema of `context.fields`, when the deployment configured one. */
export function useContextSchema(): FieldSchema | undefined {
  return useQuery(configQuery).data?.contextSchema;
}
