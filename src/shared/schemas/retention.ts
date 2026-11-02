import { z } from 'zod';

import type { KeepRecord, Retention } from '../retention.ts';

export const keepRecordSchema = z.object({ by: z.string(), at: z.string() }) satisfies z.ZodType<KeepRecord>;

export const retentionSchema = z.object({
  kept: keepRecordSchema.exactOptional(),
  expiresAt: z.string().nullable(),
}) satisfies z.ZodType<Retention>;

/** `GET|PUT|DELETE /api/{replays,suites}/<id>/keep`; `committed` marks a sample shipped with the app. */
export const servedRetentionSchema = retentionSchema.extend({ committed: z.boolean().exactOptional() });
export type ServedRetention = z.infer<typeof servedRetentionSchema>;
