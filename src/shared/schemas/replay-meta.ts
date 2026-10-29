import * as z from 'zod/mini';

import { isReplayTag, MAX_TAGS } from '../replay.ts';

/** Days a deleted replay stays restorable (`POST /api/replays/<id>/restore`) before retention removes it for good. */
export const TRASH_DAYS = 7;

const title = z.string().check(z.trim(), z.minLength(1, 'title must not be empty'), z.maxLength(200, 'title is at most 200 characters'));
const tags = z
  .array(z.string().check(z.refine(isReplayTag, 'tags are 1 to 40 characters')))
  .check(z.maxLength(MAX_TAGS, `at most ${MAX_TAGS} tags`));

/**
 * `PATCH /api/replays/<id>/meta`: what to change about a replay without touching its bundle. `profile: null` drops the
 * override (the producer's or an inferred profile applies again). `purpose` is its deprecated name.
 */
export const replayMetaPatchSchema = z
  .strictObject({
    title: z.optional(title),
    tags: z.optional(tags),
    profile: z.optional(z.nullable(z.string())),
    purpose: z.optional(z.nullable(z.string())),
  })
  .check(
    z.refine((patch) => Object.keys(patch).length > 0, 'nothing to change'),
    z.refine(
      (patch) => patch.profile === undefined || patch.purpose === undefined || patch.profile === patch.purpose,
      'profile and purpose disagree; send only profile (purpose is its deprecated name)',
    ),
  );
export type ReplayMetaPatch = z.infer<typeof replayMetaPatchSchema>;

/** `<id>/overrides.json`: the replay's meta changes, applied wherever its summary is built. */
export const metaOverridesSchema = z.object({
  title: z.optional(z.string()),
  tags: z.optional(z.array(z.string())),
  profile: z.optional(z.nullable(z.string())),
  // why: overrides saved before the rename say `purpose`; read when `profile` is absent.
  purpose: z.optional(z.nullable(z.string())),
  by: z.string(),
  at: z.string(),
});
export type MetaOverrides = z.infer<typeof metaOverridesSchema>;

/** `<id>/trash.json`: who deleted the replay, and when (it is restorable for TRASH_DAYS from the server's write time). */
export const trashRecordSchema = z.object({ by: z.string(), at: z.string() });
export type TrashRecord = z.infer<typeof trashRecordSchema>;
