import * as z from 'zod/mini';

import type { KeepRecord, Retention } from '../retention.ts';

export const keepRecordSchema = z.object({ by: z.string(), at: z.string() }) satisfies z.ZodMiniType<KeepRecord>;

export const retentionSchema = z.object({
  kept: z.exactOptional(keepRecordSchema),
  expiresAt: z.nullable(z.string()),
}) satisfies z.ZodMiniType<Retention>;

/** `GET|PUT|DELETE /api/{replays,suites}/<id>/keep`; `committed` marks a sample shipped with the app. */
export const servedRetentionSchema = z.extend(retentionSchema, { committed: z.exactOptional(z.boolean()) });
export type ServedRetention = z.infer<typeof servedRetentionSchema>;
