import * as z from 'zod/mini';

/** Read-only server policy and trash entries visible to this identity. Storage locations and credentials are excluded. */
export const dataStorageSchema = z.object({
  backend: z.string(),
  replayCount: z.number(),
  retention: z.object({
    days: z.number(),
    profiles: z.record(z.string(), z.number()),
    hasRules: z.boolean(),
    expiredDays: z.number(),
    trashDays: z.number(),
  }),
  trash: z.array(z.object({ id: z.string(), deletedAt: z.string(), restorableUntil: z.string() })),
});
export type DataStorageInfo = z.infer<typeof dataStorageSchema>;

/** Explicit confirmation is required in addition to the endpoint's authentication and same-origin checks. */
export const bulkTrashRequestSchema = z.strictObject({ confirm: z.literal('trash-all') });

/** Counts describe readable, delete-authorized uploads only. No replay IDs or provider errors are returned. */
export const bulkTrashResultSchema = z.object({
  trashed: z.number(),
  protected: z.number(),
  unavailable: z.number(),
  failed: z.number(),
});
export type BulkTrashResult = z.infer<typeof bulkTrashResultSchema>;
