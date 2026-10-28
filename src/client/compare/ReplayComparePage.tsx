import { useLocationSearch } from '../hooks/use-location-search.ts';
import { setSearch } from '../navigation.ts';
import { replayHref } from '../route.ts';
import { CompareViewer } from './CompareViewer.tsx';
import { type CompareSearch, parseCompareSearch, writeCompareSearch } from './compare-search.ts';

const write = (next: CompareSearch, push = false) => setSearch(writeCompareSearch(location.search, next), { push });
const without = (next: CompareSearch): CompareSearch => ({ with: next.with, layout: next.layout });

/**
 * `/r/<id>?with=…`: the replay's own page comparing it with other recordings. The URL is the state: layout and
 * focus changes replace it, adding or removing a recording adds a history entry (Back undoes it).
 */
export function ReplayComparePage({ id }: { id: string }) {
  const state = parseCompareSearch(useLocationSearch(), id);

  return (
    <CompareViewer
      recordings={[{ id }, ...state.with.map((other) => ({ id: other, removable: true }))]}
      focus={state.focus ?? id}
      layout={state.layout}
      time={state.t}
      onFocus={(focus) => write(focus === id ? without(state) : { ...state, focus })}
      onLayout={(layout) => write({ ...state, layout })}
      onAdd={(other) => write({ ...state, with: [...state.with, other] }, true)}
      onRemove={(other) => {
        const rest = { ...state, with: state.with.filter((item) => item !== other) };
        write(state.focus === other ? without(rest) : rest, true);
      }}
      href={(other, seconds) => `${replayHref(other)}?t=${seconds}`}
    />
  );
}
