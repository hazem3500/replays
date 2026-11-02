import { useQueries } from '@tanstack/react-query';
import { LinkIcon, TimerResetIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { toast } from 'sonner';

import { IconButton } from '@/components/icon-button.tsx';
import { useMeetingClock } from '../../hooks/use-clock.ts';
import { useLatest } from '../../hooks/use-latest.ts';
import { useWindowKeydown } from '../../hooks/use-window-keydown.ts';
import type { ReplayBundle } from '../../../shared/replay.ts';
import { useMediaQuery } from '../../media.ts';
import { replayQuery } from '../../queries.ts';
import { replayHref } from '../../route.ts';
import { notify } from '../../toast.ts';
import { Topbar } from '../../Topbar.tsx';
import type { MeetingClock } from './clock.ts';
import { AlignPanel } from './AlignPanel.tsx';
import { type DockSource, MeetingDock } from './dock/MeetingDock.tsx';
import type { InspectorRowRef } from '../../viewer/inspector-scope.ts';
import { MeetingStage, type StageTile } from './MeetingStage.tsx';
import { MeetingTransport } from './MeetingTransport.tsx';
import { Announcer, Roster } from './Roster.tsx';
import { mergedMarkers, tileModel, tileSources, type TileModel } from './tiles.ts';
import { meetingQuery, type MeetingSearch } from './url.ts';
import { searchFromView, viewFromSearch, type ViewState, views } from './view-state.ts';
import './meeting.css';

export const ROOM_STRINGS = {
  align: 'Start together',
  copy: 'Copy link at this moment',
  copied: 'Link copied',
  empty: 'Choose recordings to compare',
  emptyHint: 'Add two or more recordings from this workspace; they play together on one timeline',
  hidden: (label: string) => `${label} hidden`,
  undo: 'Undo',
} as const;

const viewerHref = (id: string, seconds: number) => `${replayHref(id)}?t=${seconds}`;

/** A fixed set of tiles the URL does not list (a suite's runs), with their labels. */
export interface RoomRuns {
  ids: string[];
  labels: Record<string, string>;
}

const goTo = (id: string) =>
  document
    .querySelector<HTMLElement>(`.mt-tile[data-tile-id="${CSS.escape(id)}"]`)
    ?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });

const keyOf = (search: MeetingSearch, runs: RoomRuns | undefined) => `${meetingQuery(search)}|${runs?.ids.join(',') ?? ''}`;

/**
 * Many recordings on one shared clock: a grid of equal tiles, or a spotlight on one pinned tile with a filmstrip. Both `/compare` and the suite workspace render this, so tiles, transport and
 * keys behave the same in each. The arrangement is the caller's `search`: the room follows it when it changes and
 * reports its own changes through `onSearchChange`, so a layout switch outside the room only moves tiles.
 */
export function MeetingRoom({
  search,
  onSearchChange,
  runs,
  clock: sharedClock,
  title,
  prefix,
  backHref,
  titleMenu,
  actions,
  trailingActions,
  menu,
  shareHref,
  recordingHref = viewerHref,
  mobile,
}: {
  search: MeetingSearch;
  onSearchChange(next: MeetingSearch): void;
  runs?: RoomRuns | undefined;
  /** A clock the caller keeps across mounts (the suite hands its time to the focus viewer). */
  clock?: MeetingClock;
  title: string;
  prefix?: string;
  backHref: string;
  titleMenu?: ReactNode;
  /** Top bar actions before "Start together" (the layout switch). */
  actions?: ReactNode;
  /** Top bar actions after it ("Add recordings"). */
  trailingActions?: ReactNode;
  /** Extra "More" menu entries. */
  menu?: ReactNode;
  /** The link "Copy link at this moment" copies. */
  shareHref(search: MeetingSearch): string;
  /** One recording at `seconds` of its own time: "Open in viewer" and a tile's copied link. */
  recordingHref?(id: string, seconds: number): string;
  mobile: boolean;
}) {
  const ownClock = useMeetingClock(search.t ? search.t * 1000 : undefined);
  const clock = sharedClock ?? ownClock;

  // why: the room owns its arrangement between renders but follows any search it did not write itself.
  const incoming = keyOf(search, runs);
  const [state, setState] = useState(() => ({ key: incoming, written: incoming, view: viewFromSearch(search, runs?.ids) }));
  let view = state.view;
  if (incoming !== state.key) {
    if (incoming === state.written) setState({ ...state, key: incoming });
    else {
      view = viewFromSearch(search, runs?.ids);
      setState({ key: incoming, written: incoming, view });
    }
  }
  const update = (next: ViewState) => {
    const nextSearch = searchFromView(next, search, runs?.ids);
    setState({ key: incoming, written: keyOf(nextSearch, runs), view: next });
    onSearchChange(nextSearch);
  };

  const sources = tileSources(view.ids, runs?.labels);
  const queries = useQueries({ queries: view.ids.map((id) => replayQuery(id)) });
  const bundles: Record<string, ReplayBundle> = Object.fromEntries(
    view.ids.flatMap((id, index) => (queries[index]?.data ? [[id, queries[index].data]] : [])),
  );
  const models: Record<string, TileModel> = Object.fromEntries(
    sources.flatMap((source) => (bundles[source.id] ? [[source.id, tileModel(source, bundles[source.id]!)]] : [])),
  );
  const labels = Object.fromEntries(sources.map((source) => [source.id, models[source.id]?.label ?? source.label ?? source.id]));
  const duration = Math.max(0, ...Object.values(models).map((model) => model.duration - (view.align[model.id] ?? 0)));
  const markers = mergedMarkers(Object.values(models), view.align, duration, new Set([...view.hide, ...view.mute]));
  const muted = new Set(view.mute);

  const visible: StageTile[] = sources
    .filter((source) => !view.hide.includes(source.id))
    .map((source) => {
      const query = queries[view.ids.indexOf(source.id)];
      return {
        source,
        model: models[source.id],
        bundle: bundles[source.id],
        failure: query?.error ? query.error.message : '',
        offset: view.align[source.id] ?? 0,
      };
    });

  const touch = useMediaQuery('(hover: none)');
  // why: the dock shows one recording: the tile last clicked, focused, swiped to or pinned, else the first one shown.
  const [chosen, setChosen] = useState<string>();
  const [hovered, setHovered] = useState<InspectorRowRef>();
  const docked = visible.find((tile) => tile.source.id === chosen) ?? visible.find((tile) => tile.source.id === view.pin) ?? visible[0];
  const dockSources: DockSource[] = visible.flatMap((tile) =>
    tile.bundle && tile.model
      ? [
          {
            id: tile.source.id,
            bundle: tile.bundle,
            offset: tile.offset,
            label: tile.model.label,
            colour: `var(--tile-${tile.source.colour + 1})`,
            colourIndex: tile.source.colour,
            letter: tile.source.letter,
          },
        ]
      : [],
  );
  const probe = hovered && sources.find((source) => source.id === hovered.sourceId);
  const latest = useLatest({ view, update });
  // why: hiding is one click away from losing a tile, so it says so and offers the way back.
  const hide = (id: string) => {
    const next = views.hide(view, id);
    if (next === view) return;
    update(next);
    toast(ROOM_STRINGS.hidden(labels[id] ?? id), {
      action: {
        label: ROOM_STRINGS.undo,
        onClick: () => {
          const { view: now, update: apply } = latest.current;
          if (now.hide.includes(id)) apply(views.hide(now, id));
        },
      },
    });
  };

  const [aligning, setAligning] = useState(false);
  const align = (starts: Record<string, number>) => {
    clock.align(starts);
    update(views.align(view, starts));
  };
  const copy = () => {
    const url = new URL(shareHref({ ...searchFromView(view, search, runs?.ids), t: clock.getTime() / 1000 }), location.origin);
    void navigator.clipboard?.writeText(url.href).then(() => notify(ROOM_STRINGS.copied, 'success'));
  };

  useWindowKeydown((event) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || (event.key !== ' ' && event.key !== 'k')) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('input, select, textarea, button, a, [role="dialog"], [contenteditable="true"]')) return;
    event.preventDefault();
    clock.toggle();
  });

  const spotlight = Boolean(view.pin) && visible.length > 1;
  return (
    <main className="mt-workspace" data-mobile={mobile || undefined}>
      <Topbar
        title={title}
        {...(prefix ? { prefix } : {})}
        compact={mobile}
        backHref={backHref}
        {...(titleMenu ? { titleMenu } : {})}
        actions={
          <>
            {actions}
            <IconButton label={ROOM_STRINGS.align} disabled={Object.keys(models).length < 2} onClick={() => setAligning(true)}>
              <TimerResetIcon aria-hidden="true" />
            </IconButton>
            {trailingActions}
          </>
        }
        {...(menu ? { menu } : {})}
        menuItems={[{ label: ROOM_STRINGS.copy, icon: <LinkIcon aria-hidden="true" />, onSelect: copy }]}
      />
      {view.ids.length === 0 ? (
        <div className="mt-empty">
          <strong>{ROOM_STRINGS.empty}</strong>
          <span>{ROOM_STRINGS.emptyHint}</span>
        </div>
      ) : (
        <MeetingStage
          tiles={visible}
          pin={spotlight ? view.pin : undefined}
          muted={muted}
          mobile={mobile}
          clock={clock}
          href={recordingHref}
          sheet={mobile || touch}
          highlight={hovered?.sourceId}
          onTileFocus={setChosen}
          actions={{
            onPin: (id) => {
              setChosen(id);
              update(views.pin(view, id));
            },
            onUnpin: () => update(views.unpin(view)),
            onMute: (id) => update(views.mute(view, id)),
            onHide: hide,
            onSwap: (from, to) => update(views.swap(view, from, to)),
          }}
        />
      )}
      <MeetingTransport clock={clock} markers={markers} probe={hovered && probe ? { at: hovered.at, colour: probe.colour } : undefined}>
        <Roster
          sources={sources}
          labels={labels}
          hidden={view.hide}
          mobile={mobile}
          clock={clock}
          onToggle={(id) => update(views.hide(view, id))}
          onGo={goTo}
        />
      </MeetingTransport>
      {docked && dockSources.length ? (
        <MeetingDock
          sources={dockSources}
          focusedId={docked.source.id}
          clock={clock}
          mobile={mobile}
          onFocus={setChosen}
          onHover={setHovered}
        />
      ) : null}
      <Announcer clock={clock} sources={sources} labels={labels} muted={view.mute} />
      <AlignPanel
        open={aligning}
        onOpenChange={setAligning}
        tiles={sources.flatMap((source) => models[source.id] ?? [])}
        bundles={bundles}
        offsets={view.align}
        clock={clock}
        onAlign={align}
      />
    </main>
  );
}
