import { type ComparePageProps, CompareViewer } from '../compare/CompareViewer.tsx';
import { type CompareLayout, parseCompareSearch, writeCompareSearch } from '../compare/compare-search.ts';
import { useLocationSearch } from '../hooks/use-location-search.ts';
import { navigate, setSearch } from '../routing/navigate.ts';
import { replayHref } from '../routing/links.ts';
import type { RecordedRun } from './runs.ts';

/**
 * Keeps suite runs available in every layout. Entry defaults to Single; explicit layout or Compare view intent
 * can show them together. The sidebar selects the focus without removing the URL's layout preferences.
 */
export function SuiteCompare({
  runs,
  fallback,
  focus,
  onFocus,
  page,
  hideCompareSummary,
}: {
  runs: readonly RecordedRun[];
  /** The layout a URL without `layout` means (compare/defaults.ts). */
  fallback: CompareLayout;
  focus: string;
  onFocus: (replayId: string) => void;
  page: ComparePageProps;
  hideCompareSummary: boolean;
}) {
  const { layout, t } = parseCompareSearch(useLocationSearch(), '', fallback);
  return (
    <CompareViewer
      recordings={runs.map((run) => ({ id: run.replayId, label: run.label, colour: run.colour, name: run.name }))}
      focus={focus}
      layout={layout}
      time={t}
      onFocus={onFocus}
      onLayout={(next) => setSearch(writeCompareSearch(location.search, { with: [], layout: next }, fallback))}
      onAdd={(other) => {
        const others = runs.map((run) => run.replayId).filter((id) => id !== focus);
        const search = writeCompareSearch('', { with: [...others, other], layout: layout === 'single' ? 'grid' : layout });
        navigate(`${replayHref(focus)}${search}`);
      }}
      href={(id, seconds) => `${replayHref(id)}?t=${seconds}`}
      page={page}
      hideCompareSummary={hideCompareSummary}
    />
  );
}
