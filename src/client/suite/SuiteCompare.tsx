import { type ComparePageProps, CompareViewer } from '../compare/CompareViewer.tsx';
import { parseCompareSearch, writeCompareSearch } from '../compare/compare-search.ts';
import { useLocationSearch } from '../hooks/use-location-search.ts';
import { navigate, setSearch } from '../navigation.ts';
import { replayHref } from '../route.ts';

/**
 * A suite with two or more recordings opens as the viewer comparing its runs: the runs sidebar picks the focus,
 * the layout lives in `?layout=` (Grid unless it says otherwise). "Compare with…" leaves the suite for an ad-hoc
 * comparison of these runs and the pick.
 */
export function SuiteCompare({
  runs,
  focus,
  onFocus,
  page,
}: {
  runs: ReadonlyArray<{ replayId: string; label: string }>;
  focus: string;
  onFocus: (replayId: string) => void;
  page: ComparePageProps;
}) {
  const { layout, t } = parseCompareSearch(useLocationSearch(), '', 'grid');
  return (
    <CompareViewer
      recordings={runs.map((run) => ({ id: run.replayId, label: run.label }))}
      focus={focus}
      layout={layout}
      time={t}
      onFocus={onFocus}
      onLayout={(next) => setSearch(writeCompareSearch(location.search, { with: [], layout: next }, 'grid'))}
      onAdd={(other) => {
        const others = runs.map((run) => run.replayId).filter((id) => id !== focus);
        const search = writeCompareSearch('', { with: [...others, other], layout: layout === 'single' ? 'grid' : layout });
        navigate(`${replayHref(focus)}${search}`);
      }}
      href={(id, seconds) => `${replayHref(id)}?t=${seconds}`}
      page={page}
    />
  );
}
