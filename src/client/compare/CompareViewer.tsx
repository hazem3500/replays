import { useQueries } from '@tanstack/react-query';
import { ArrowUpRightIcon } from 'lucide-react';
import { type ComponentProps, useState } from 'react';

import { DropdownMenuItem } from '@/components/ui/dropdown-menu.tsx';

import { MOBILE_QUERY, useMediaQuery } from '../media.ts';
import { formatSeconds, parsePermalink } from '../permalink.ts';
import { replayQuery } from '../queries.ts';
import { shortcutFor } from '../shortcuts.ts';
import { Viewer } from '../Viewer.tsx';
import { failureCopy, StateShell, TRY_AGAIN } from '../routing/states.tsx';
import { ViewerSkeleton } from '../ViewerSkeleton.tsx';
import { useCompareSession } from '../hooks/use-compare-session.ts';
import { useWindowKeydown } from '../hooks/use-window-keydown.ts';
import { CompareStage } from './CompareStage.tsx';
import type { TileCommands } from './CompareTile.tsx';
import { LayoutMenuItems, LayoutSwitch } from './LayoutSwitch.tsx';
import { ScopeSwitch } from './ScopeSwitch.tsx';
import { CompareSummary } from './CompareSummary.tsx';
import { showsPhoneSwitch } from './layout.ts';
import type { CompareLayout } from './compare-search.ts';
import { type CompareTile, compareTiles, isLoaded, type LoadedTile } from './tiles.ts';
// oxlint-disable-next-line import/no-unassigned-import -- why: the comparison's styles load with its lazy chunk, not with every page.
import './compare.css';

export interface CompareRecording {
  id: string;
  /** A suite run's label; else the recording's title. */
  label?: string | undefined;
  removable?: boolean;
  /** The colour a suite run already shows in its sidebar row. */
  colour?: number | undefined;
}

type ViewerProps = ComponentProps<typeof Viewer>;
/** Viewer props the page itself decides (a suite's run title, status, menus); the comparison owns the rest. */
export type ComparePageProps = Omit<
  ViewerProps,
  'bundle' | 'player' | 'stage' | 'headerActions' | 'inspectorScope' | 'inspectorPeers' | 'comparing' | 'onCompareWith' | 'compareSummary'
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
  /** The shared playhead the link opens at (`t` from compare-search.ts), in ms. */
  time?: number | undefined;
  /** The page's own viewer props for the focused recording (a suite run's title, status and menus). */
  page?: ComparePageProps | undefined;
  /** The expanded suite sidebar already presents each run's summary. */
  hideCompareSummary?: boolean;
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
  const skeleton = <ViewerSkeleton label="Loading recordings" comparing={props.layout === 'grid' ? tiles.length : 0} />;
  if (!first) return settled ? <CompareFailed tiles={tiles} /> : skeleton;
  if (!opened) return skeleton;
  const focused = tiles.find((tile): tile is LoadedTile => tile.id === props.focus && isLoaded(tile)) ?? first;
  return <CompareSessionView compare={props} tiles={tiles} focused={focused} />;
}

function failureOf(tiles: readonly CompareTile[]) {
  const reason = tiles.find((tile) => tile.failure)?.failure;
  if (reason) return reason;
  return 'The recordings could not be loaded';
}

function CompareFailed({ tiles }: { tiles: readonly CompareTile[] }) {
  return <StateShell {...failureCopy('comparison', failureOf(tiles))} secondary={TRY_AGAIN} />;
}

/** Phones: the recording on show, on its own at this moment (desktop has it on the tile). */
function OpenOnItsOwnItem({ name, onSelect }: { name: string; onSelect: () => void }) {
  return (
    <DropdownMenuItem onClick={onSelect} data-testid="open-on-its-own">
      <ArrowUpRightIcon aria-hidden="true" />
      Open {name} on its own
    </DropdownMenuItem>
  );
}

/** `#step-n` wins over `t`, as in the single viewer; a step is the focused recording's. */
function linkedTime(focused: LoadedTile, time: number | undefined) {
  const { steps } = focused.bundle;
  const { step } = parsePermalink('', location.hash, steps.length);
  return step === undefined ? time : steps[step]?.at;
}

function CompareSessionView({ compare, tiles, focused }: { compare: CompareViewerProps; tiles: CompareTile[]; focused: LoadedTile }) {
  const { layout, onFocus, onLayout } = compare;
  const [initialTime] = useState(() => linkedTime(focused, compare.time));
  const session = useCompareSession(tiles, focused.id, initialTime, layout === 'single');
  const mobile = useMediaQuery(MOBILE_QUERY);
  const ready = tiles.filter(isLoaded);
  const summary = !compare.hideCompareSummary && !showsPhoneSwitch({ mobile, layout, count: tiles.length });

  useWindowKeydown((event) => {
    if (document.querySelector('[role="dialog"]')) return;
    const action = shortcutFor(event, event.target instanceof HTMLElement ? event.target : null);
    if (action !== 'next-run' && action !== 'previous-run') return;
    event.preventDefault();
    const index = ready.findIndex((tile) => tile.id === focused.id);
    const next = ready[(index + (action === 'next-run' ? 1 : -1) + ready.length) % ready.length];
    if (next) onFocus(next.id);
  });

  const peers = ready
    .filter((tile) => tile.id !== focused.id)
    .map(({ id, name, colour, label, bundle }) => ({ id, name, colour, label, bundle }));

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
    <div className="compare-viewer" data-compare={layout} data-phone={mobile || undefined}>
      <Viewer
        {...compare.page}
        bundle={focused.bundle}
        player={session.player}
        stage={<CompareStage session={session} tiles={tiles} layout={layout} focus={focused.id} mobile={mobile} commands={commands} />}
        headerActions={mobile ? undefined : <LayoutSwitch value={layout} onChange={onLayout} />}
        menu={
          mobile ? (
            <>
              {compare.page?.menu}
              <OpenOnItsOwnItem
                name={focused.name}
                onSelect={() => window.open(compare.href(focused.id, formatSeconds(session.clock.getTime())), '_blank', 'noopener')}
              />
              <LayoutMenuItems value={layout} onChange={onLayout} />
            </>
          ) : (
            compare.page?.menu
          )
        }
        inspectorScope={mobile ? undefined : <ScopeSwitch tiles={tiles} focus={focused.id} onFocus={onFocus} />}
        inspectorPeers={peers}
        comparing={tiles.map((tile) => tile.id)}
        onCompareWith={compare.onAdd}
        compareSummary={summary ? <CompareSummary tiles={ready} focus={focused.id} onFocus={onFocus} /> : undefined}
      />
    </div>
  );
}
