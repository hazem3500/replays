import { useQueries } from '@tanstack/react-query';
import { type ComponentProps, useState } from 'react';

import { MOBILE_QUERY, useMediaQuery } from '../media.ts';
import { parsePermalink } from '../permalink.ts';
import { replayQuery } from '../queries.ts';
import { shortcutFor } from '../shortcuts.ts';
import { Viewer } from '../Viewer.tsx';
import { ViewerSkeleton } from '../ViewerSkeleton.tsx';
import { useCompareSession } from '../hooks/use-compare-session.ts';
import { useWindowKeydown } from '../hooks/use-window-keydown.ts';
import { CompareStage } from './CompareStage.tsx';
import type { TileCommands } from './CompareTile.tsx';
import { LayoutSwitch } from './LayoutSwitch.tsx';
import { PerformanceComparison } from './PerformanceComparison.tsx';
import { ScopeSwitch } from './ScopeSwitch.tsx';
import type { CompareLayout } from './search.ts';
import { type CompareTile, compareTiles, isLoaded, type LoadedTile } from './tiles.ts';
// oxlint-disable-next-line import/no-unassigned-import -- why: the comparison's styles load with its lazy chunk, not with every page.
import './compare.css';

export interface CompareRecording {
  id: string;
  /** A suite run's label; else the recording's title. */
  label?: string | undefined;
  removable?: boolean;
}

type ViewerProps = ComponentProps<typeof Viewer>;
/** Viewer props the page itself decides (a suite's run title, status, menus); the comparison owns the rest. */
export type ComparePageProps = Omit<
  ViewerProps,
  'bundle' | 'player' | 'stage' | 'headerActions' | 'inspectorScope' | 'performanceExtra' | 'comparing' | 'onCompareWith'
>;

export interface CompareViewerProps {
  recordings: readonly CompareRecording[];
  focus: string;
  layout: CompareLayout;
  onFocus: (id: string) => void;
  onLayout: (layout: CompareLayout) => void;
  /** "Compare with…" picked another recording. */
  onAdd: (id: string) => void;
  onRemove?: ((id: string) => void) | undefined;
  /** The recording on its own at `seconds` (its viewer page). */
  href: (id: string, seconds: string) => string;
  /** The page's own viewer props for the focused recording (a suite run's title, status and menus). */
  page?: ComparePageProps | undefined;
}

/**
 * The replay viewer comparing recordings: the same top bar, transport, shortcuts, steps and inspector, scoped to
 * the focused recording, with every recording on the stage on one shared clock. It opens once the first set of
 * recordings has settled, so the transport starts with the full timeline; later additions load in their tile.
 */
export function CompareViewer(props: CompareViewerProps) {
  const results = useQueries({ queries: props.recordings.map((recording) => replayQuery(recording.id)) });
  const tiles = compareTiles(
    props.recordings.map((recording, index) => ({
      ...recording,
      bundle: results[index]?.data,
      failure: results[index]?.error?.message,
    })),
  );
  const [opened, setOpened] = useState(false);
  const settled = results.every((result) => result.data !== undefined || result.isError);
  const first = tiles.find(isLoaded);
  if (!opened && settled && first) setOpened(true);
  if (!first) return settled ? <CompareFailed tiles={tiles} /> : <ViewerSkeleton label="Loading recordings" />;
  if (!opened) return <ViewerSkeleton label="Loading recordings" />;
  const focused = tiles.find((tile): tile is LoadedTile => tile.id === props.focus && isLoaded(tile)) ?? first;
  return <CompareSessionView compare={props} tiles={tiles} focused={focused} />;
}

function failureOf(tiles: readonly CompareTile[]) {
  const reason = tiles.find((tile) => tile.failure)?.failure;
  return reason ? reason : 'The recordings could not be loaded';
}

function CompareFailed({ tiles }: { tiles: readonly CompareTile[] }) {
  return (
    <main className="state-shell">
      <section className="state-content" role="alert">
        <span className="state-kicker">Could not compare recordings</span>
        <h1>{failureOf(tiles)}</h1>
        <p>They may have expired, or the link may be incomplete.</p>
      </section>
    </main>
  );
}

/** `?t=` and `#step-n` open at their moment, as in the single viewer; a step is the focused recording's. */
function linkedTime(focused: LoadedTile) {
  const { steps } = focused.bundle;
  const target = parsePermalink(location.search, location.hash, steps.length);
  return target.step === undefined ? target.time : steps[target.step]?.at;
}

function CompareSessionView({ compare, tiles, focused }: { compare: CompareViewerProps; tiles: CompareTile[]; focused: LoadedTile }) {
  const { layout, onFocus, onLayout } = compare;
  const [initialTime] = useState(() => linkedTime(focused));
  const session = useCompareSession(tiles, focused.id, initialTime);
  const mobile = useMediaQuery(MOBILE_QUERY);
  const ready = tiles.filter(isLoaded);

  useWindowKeydown((event) => {
    if (document.querySelector('[role="dialog"]')) return;
    const action = shortcutFor(event, event.target instanceof HTMLElement ? event.target : null);
    if (action !== 'next-run' && action !== 'previous-run') return;
    event.preventDefault();
    const index = ready.findIndex((tile) => tile.id === focused.id);
    const next = ready[(index + (action === 'next-run' ? 1 : -1) + ready.length) % ready.length];
    if (next) onFocus(next.id);
  });

  const commands: TileCommands = {
    onFocus,
    onSpotlight: (id) => {
      if (layout === 'spotlight' && id === focused.id) return onLayout('grid');
      onFocus(id);
      onLayout('spotlight');
    },
    onPlayPause: session.player.playPause,
    onRemove: compare.onRemove,
    href: compare.href,
  };

  return (
    <div className="compare-viewer" data-compare={layout}>
      <Viewer
        {...compare.page}
        bundle={focused.bundle}
        player={session.player}
        stage={<CompareStage session={session} tiles={tiles} layout={layout} focus={focused.id} mobile={mobile} commands={commands} />}
        headerActions={<LayoutSwitch value={layout} onChange={onLayout} phone={mobile} />}
        inspectorScope={mobile ? undefined : <ScopeSwitch tiles={tiles} focus={focused.id} onFocus={onFocus} />}
        performanceExtra={<PerformanceComparison tiles={tiles} focus={focused.id} onFocus={onFocus} />}
        comparing={tiles.map((tile) => tile.id)}
        onCompareWith={compare.onAdd}
      />
    </div>
  );
}
