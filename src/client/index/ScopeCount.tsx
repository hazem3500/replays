import { AnimatedNumber } from '@/components/animated-number.tsx';
import { cn } from '@/lib/utils.ts';

import { nounFor, plural } from '../plural.ts';

import '../loading.css';
import './scope-count.css';

export type ScopeCountState = 'loading' | 'updating' | 'ready' | 'error';

/** What screen readers hear in each state; `ready` reads the count itself. */
const STATUS: Record<Exclude<ScopeCountState, 'ready'>, string> = {
  loading: `Loading ${nounFor(0, 'replay')}…`,
  updating: `Updating ${nounFor(0, 'replay')}…`,
  error: '',
};

/**
 * The index's result count ("22 replays · 4 suites") and its loading states, without ever swapping the count for a
 * sentence: through a refresh the count it had stays (numbers roll to the new values when they land) and dims after
 * 300 ms while RefreshLine draws the activity; during the first load a filtered view (where the count shows) holds
 * its place with a bar. What is going on is said to screen readers only, in a polite live region. Visible only while
 * filtered (`shown`); scope-bar.css also hides it when purpose tabs take the toolbar's left side.
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
      <ScopeCountValue replays={known ? replays : undefined} suites={suites} loading={state === 'loading'} />
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {status}
      </span>
    </span>
  );
}

function ScopeCountValue({ replays, suites, loading }: { replays: number | undefined; suites: number; loading: boolean }) {
  if (replays === undefined) return loading ? <span className="skel-line scope-count-skeleton" aria-hidden="true" /> : null;
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

function readyText(replays: number | undefined, suites: number) {
  return replays === undefined ? '' : countText(replays, suites);
}

/** "22 replays · 4 suites": the count as one sentence (the live region, tooltips). */
export function countText(replays: number, suites: number) {
  return suites ? `${plural(replays, 'replay')} · ${plural(suites, 'suite')}` : plural(replays, 'replay');
}

/** The index header's refresh activity: a hairline along its bottom edge, shown only for refreshes past 300 ms. */
export function RefreshLine({ active }: { active: boolean }) {
  return (
    <span className="load-line index-refresh-line" data-active={active || undefined} aria-hidden="true">
      <span />
    </span>
  );
}
