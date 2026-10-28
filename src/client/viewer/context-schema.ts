import { useQuery } from '@tanstack/react-query';

import type { FieldSchema } from '../config.ts';
import { configQuery } from '../queries.ts';

/** The JSON Schema of `context.fields`, when the deployment configured one. */
export function useContextSchema(): FieldSchema | undefined {
  return useQuery(configQuery).data?.contextSchema;
}
