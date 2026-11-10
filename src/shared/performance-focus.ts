import type { CaptureProfile } from './capture-profile.ts';

const PERFORMANCE_VIEW = 'performance';
const PERFORMANCE_TAG = 'performance';

/** A profile as far as the focus rule reads it. */
interface FocusProfile {
  view?: string | undefined;
  capture?: Pick<CaptureProfile, 'performance'> | undefined;
}

interface PerformanceFocusInput {
  /** The page's resolved view id. */
  view?: string | undefined;
  /** The replay's profile and, on a suite page, the suite's. */
  profiles?: ReadonlyArray<FocusProfile | undefined>;
  /** `meta.tags`. */
  tags?: readonly string[] | undefined;
}

/**
 * A replay or suite is performance-focused when the page is in the Performance view, a profile opens in it or was
 * captured with `capture.performance: true`, or the replay is tagged `performance`. `meta.captured.performance` is
 * not a signal: the capture CLI records performance by default, so it says nothing about why the recording was made.
 */
export function isPerformanceFocused({ view, profiles = [], tags = [] }: PerformanceFocusInput) {
  if (view === PERFORMANCE_VIEW || tags.includes(PERFORMANCE_TAG)) return true;
  return profiles.some((profile) => profile?.view === PERFORMANCE_VIEW || profile?.capture?.performance === true);
}
