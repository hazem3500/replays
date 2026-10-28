import type { CompareLayout } from './compare-search.ts';

/** Where a viewer page opens from: what decides whether it compares and in which layout. */
export interface CompareEntry {
  page: 'replay' | 'suite';
  /** Recordings that can play (a suite's playable runs; 1 for a replay on its own). */
  recordings: number;
  /** The URL names one recording (`/s/<id>/r/<run>`): it takes the spotlight. */
  namedRecording?: boolean;
}

export interface CompareDefaults {
  /** The page opens comparing its recordings without a `?with=` or `?layout=`. */
  compare: boolean;
  /** The layout a URL without `layout` means. */
  layout: CompareLayout;
}

/**
 * The one place that decides how a page opens: a suite with two or more recordings compares them (Grid, or
 * Spotlight on the run its URL names); a replay on its own shows Single until "Compare" adds another. Capture
 * profiles (the deployment's purposes) can plug in here to pick other defaults.
 */
export function compareDefaults({ page, recordings, namedRecording = false }: CompareEntry): CompareDefaults {
  if (page === 'replay' || recordings < 2) return { compare: false, layout: 'single' };
  return { compare: true, layout: namedRecording ? 'spotlight' : 'grid' };
}
