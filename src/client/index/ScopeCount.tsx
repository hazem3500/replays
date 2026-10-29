import { AnimatedNumber } from '@/components/animated-number.tsx';
import { cn } from '@/lib/utils.ts';

import { nounFor, plural } from '../plural.ts';

export type ScopeCountState = 'loading' | 'updating' | 'ready' | 'error';

/** What screen readers hear while lists load; `ready` reads the count itself. */
const STATUS: Record<Exclude<ScopeCountState, 'ready'>, string> = {
  loading: 'Loading replays…',
  updating: 'Updating replays…',
  error: '',
};

/** "22 replays · 4 suites": the count as one sentence. */
function countText(replays: number, suites: number) {
  return suites ? `${plural(replays, 'replay')} · ${plural(suites, 'suite')}` : plural(replays, 'replay');
}

/**
 * The index's result count ("22 replays · 4 suites"), never swapped for a sentence: through a refresh the count it
 * had stays (numbers roll to the new values when they land) and dims after 300 ms while RefreshLine draws the
 * activity; during the first load a filtered view holds the count's place with a bar the height of its text. Known
 * counts (a list restored for Back, a settled one) show at once. What is going on is said to screen readers only.
 * Visible only while filtered (`shown`); scope-bar.css also hides it when profile tabs take the toolbar's left side.
 */
export function ScopeCount({
  replays,
  suites = 0,
  shown,
  state,
}: {
  /** Replays the list shows; undefined until the first list arrives. */
  replays: number | undefined;
  suites?: number;
  shown: boolean;
  state: ScopeCountState;
}) {
  const known = replays !== undefined && state !== 'error';
  const status = state === 'ready' ? readyText(replays, suites) : STATUS[state];
  return (
    <span className={cn('scope-count', !shown && 'sr-only')} data-state={state}>
      <CountValue replays={known ? replays : undefined} suites={suites} loading={state === 'loading'} />
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {status}
      </span>
    </span>
  );
}

function readyText(replays: number | undefined, suites: number) {
  return replays === undefined ? '' : countText(replays, suites);
}

/** The visible count, rolling to new values; a bar while the first list loads; nothing when unknown otherwise. */
function CountValue({ replays, suites, loading }: { replays: number | undefined; suites: number; loading: boolean }) {
  if (replays === undefined) return loading ? <span className="skel-line skel-appear scope-count-skeleton" aria-hidden="true" /> : null;
  return (
    <span className="scope-count-value" aria-hidden="true">
      <AnimatedNumber value={replays} /> {nounFor(replays, 'replay')}
      {suites ? (
        <>
          {' · '}
          <AnimatedNumber value={suites} /> {nounFor(suites, 'suite')}
        </>
      ) : null}
    </span>
  );
}

/** The index header's refresh activity: an accent hairline along its bottom edge, only for refreshes past 300 ms. */
export function RefreshLine({ active }: { active: boolean }) {
  return (
    <span className="load-line" data-active={active || undefined} aria-hidden="true">
      <span />
    </span>
  );
}
