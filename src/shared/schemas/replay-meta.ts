import { z } from 'zod';

import { isReplayTag, MAX_TAGS } from '../replay.ts';

const tag = z.string().refine(isReplayTag, 'a tag is 1-40 characters of a-z, 0-9, ".", "_", ":" or "-"');

/**
 * `PATCH /api/replays/<id>/meta`: what a person may change about a stored replay. The bundle stays as recorded; these
 * apply on top of it wherever the replay is listed or opened.
 */
export const replayMetaPatchSchema = z
  .strictObject({
    title: z.string().trim().min(1).max(200).exactOptional(),
    tags: z.array(tag).max(MAX_TAGS).exactOptional(),
    /** A purpose the deployment defines, or `null` for none (an inferred purpose may then apply). */
    purpose: z.string().nullable().exactOptional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, 'nothing to change');

export type ReplayMetaPatch = z.infer<typeof replayMetaPatchSchema>;

/** `GET /api/replays/<id>/meta`: the changes in force; a field that is absent keeps the recorded value. */
export const replayMetaOverridesSchema = z.object({
  title: z.string().exactOptional(),
  tags: z.array(tag).exactOptional(),
  purpose: z.string().nullable().exactOptional(),
  /** The identity that made the last change, and when. */
  by: z.string(),
  updatedAt: z.string(),
});

export type ReplayMetaOverrides = z.infer<typeof replayMetaOverridesSchema>;

/** A replay in the trash: who moved it there, and when. */
export const trashRecordSchema = z.object({ by: z.string(), at: z.string() });

export type TrashRecord = z.infer<typeof trashRecordSchema>;

/** `DELETE /api/replays/<id>`: the replay is out of every list and can be restored until `restoreBefore`. */
export const trashReceiptSchema = z.object({ id: z.string(), trashedAt: z.string(), restoreBefore: z.string() });

export type TrashReceipt = z.infer<typeof trashReceiptSchema>;
