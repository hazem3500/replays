/* why: deprecated names for profiles (src/shared/profiles.ts), kept for downstream code written before the rename.
   Each alias is removed after the deprecation window in docs/api-stability.md. */
import {
  assertProfileConfig,
  isProfileId,
  PROFILE_ID,
  profileProblem,
  type ProfileConfig,
  type ProfileInfo,
  type ProfileOpenAt,
  type ProfileViewerDefaults,
} from './profiles.ts';

export { DEFAULT_LEAD_MS, isRetentionDays, POSTER_MOMENTS, type PosterMoment } from './profiles.ts';

/** @deprecated Use `ProfileOpenAt`. */
export type PurposeOpenAt = ProfileOpenAt;
/** @deprecated Use `ProfileViewerDefaults`. */
export type PurposeViewerDefaults = ProfileViewerDefaults;
/** @deprecated Use `ProfileConfig`. */
export type PurposeConfig = ProfileConfig;
/** @deprecated Use `ProfileInfo`. */
export type PurposeInfo = ProfileInfo;
/** @deprecated Use `PROFILE_ID`. */
export const PURPOSE_ID = PROFILE_ID;
/** @deprecated Use `isProfileId`. */
export const isPurposeId = isProfileId;
/** @deprecated Use `assertProfileConfig`. */
export const assertPurposeConfig: typeof assertProfileConfig = assertProfileConfig;
/** @deprecated Use `profileProblem`. */
export const purposeProblem = profileProblem;
