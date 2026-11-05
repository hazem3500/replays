import type { CompareLayout } from './compare-search.ts';

/** Entry intent and the recordings available to the layout switcher. */
export interface CompareEntry {
  page: 'replay' | 'suite';
  recordings: number;
  /** A named run selects the focus without changing the layout. */
  namedRecording?: boolean;
  /** An intentionally requested view's layout; ordinary suite entry passes Single. */
  viewLayout?: CompareLayout;
}

export interface CompareDefaults {
  /** Whether the multi-recording viewer is available, including in Single. */
  compare: boolean;
  /** The layout a URL without `layout` means. */
  layout: CompareLayout;
}

/** Multiple suite runs remain switchable without making comparison the default. */
export function compareDefaults({ page, recordings, viewLayout = 'single' }: CompareEntry): CompareDefaults {
  if (page === 'replay' || recordings < 2) return { compare: false, layout: 'single' };
  return { compare: true, layout: viewLayout };
}
