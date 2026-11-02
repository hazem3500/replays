import { ArrowUpRightIcon, EyeOffIcon, FlagIcon, FlagOffIcon, LinkIcon, Maximize2Icon, Minimize2Icon } from 'lucide-react';
import type { CSSProperties, DragEvent, KeyboardEvent } from 'react';

import type { ReplayBundle } from '../../../shared/replay.ts';
import { useClockFrame, useClockState } from '../../hooks/use-clock.ts';
import { plural } from '../../plural.ts';
import { Hint } from '@/components/icon-button.tsx';
import { notify } from '../../toast.ts';
import type { Fidelity, MeetingClock, TileStatus } from './clock.ts';
import type { Placement } from './layout.ts';
import { TileMenu } from './TileMenu.tsx';
import { TilePlayer } from './TilePlayer.tsx';
import { errorNow, startsIn, type TileModel, type TileSource } from './tiles.ts';

export const TILE_STRINGS = {
  loading: 'Loading',
  failed: 'Could not load',
  waiting: 'Waiting',
  playing: 'Playing',
  paused: 'Paused',
  ended: 'Ended',
  spotlight: 'Spotlight',
  grid: 'Back to grid',
  open: 'Open in viewer',
  hide: 'Hide from comparison',
  mute: 'Hide markers from the seek bar',
  unmute: 'Show markers on the seek bar',
  copy: 'Copy link at this moment',
  copied: 'Link copied',
} as const;

export interface TileActions {
  onPin(id: string): void;
  onMute(id: string): void;
  onHide(id: string): void;
  onFocus(id: string): void;
  onKey(id: string, event: KeyboardEvent<HTMLElement>): void;
  onDrop(from: string, to: string): void;
}

interface Props extends TileActions {
  source: TileSource;
  model: TileModel | undefined;
  bundle: ReplayBundle | undefined;
  failure: string;
  clock: MeetingClock;
  offset: number;
  placement: Placement | undefined;
  fidelity: Fidelity;
  pinned: boolean;
  muted: boolean;
  current: boolean;
  dragging: string | undefined;
  onDragState(id: string | undefined): void;
  /** The recording on its own at `seconds` of its local time (the viewer, or its run in the suite). */
  href(id: string, seconds: number): string;
  /** Touch: the "⋯" menu opens as a bottom sheet. */
  sheet: boolean;
  /** A row of this tile is hovered in the diagnostics dock. */
  highlighted?: boolean;
}

function statusWord(status: TileStatus | undefined, playing: boolean, loaded: boolean) {
  if (!loaded || !status) return TILE_STRINGS.loading;
  if (status === 'waiting') return TILE_STRINGS.waiting;
  if (status === 'ended') return TILE_STRINGS.ended;
  return playing ? TILE_STRINGS.playing : TILE_STRINGS.paused;
}

export function MeetingTile(props: Props) {
  const { source, model, bundle, failure, clock, placement, pinned, muted, current } = props;
  const actions: TileActions = props;
  const { id } = source;
  const status = useClockState(clock, (snapshot) => snapshot.tiles[id]?.status);
  const playing = useClockState(clock, (snapshot) => snapshot.status === 'playing');
  const errors = model?.errors ?? [];
  const label = model?.label ?? source.label ?? id;
  const word = failure ? TILE_STRINGS.failed : statusWord(status, playing, Boolean(model));

  const glow = useClockFrame<HTMLElement>(clock, (element) => {
    const error = muted ? undefined : errorNow(errors, clock.localTime(id));
    const next = error ? 'error' : '';
    if ((element.dataset.alert ?? '') === next) return;
    if (next) element.dataset.alert = next;
    else delete element.dataset.alert;
    element.title = error?.label ?? '';
  });
  const countdown = useClockFrame<HTMLElement>(clock, (element) => {
    const text = startsIn(clock.localTime(id));
    if (element.textContent !== text) element.textContent = text;
  });

  const here = () => props.href(id, Math.round(Math.max(0, clock.localTime(id)) / 100) / 10);

  const style: CSSProperties | undefined = placement
    ? { transform: `translate(${placement.x}px, ${placement.y}px)`, width: placement.width, height: placement.height }
    : undefined;
  const role = placement?.role ?? 'flow';
  const tabIndex = current ? 0 : -1;

  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- why: a roving-focus tile (arrows move, Enter pins, drag swaps); its actions are real buttons
    <section
      ref={glow}
      className="mt-tile"
      style={{ ...style, '--tile': `var(--tile-${source.colour + 1})` } as CSSProperties}
      data-role={role}
      data-state={failure ? 'failed' : (status ?? 'loading')}
      data-pinned={pinned || undefined}
      data-highlight={props.highlighted || undefined}
      data-muted={muted || undefined}
      data-drop-target={(props.dragging && props.dragging !== id) || undefined}
      data-tile-id={id}
      aria-label={`${source.letter}: ${label}, ${word}${errors.length ? `, ${plural(errors.length, 'error')}` : ''}${pinned ? ', in the spotlight' : ''}`}
      tabIndex={tabIndex}
      draggable
      onFocus={(event) => event.target === event.currentTarget && actions.onFocus(id)}
      onKeyDown={(event) => actions.onKey(id, event)}
      onDragStart={(event: DragEvent) => {
        event.dataTransfer.setData('application/x-replay-tile', id);
        event.dataTransfer.effectAllowed = 'move';
        props.onDragState(id);
      }}
      onDragEnd={() => props.onDragState(undefined)}
      onDragOver={(event) => {
        if (props.dragging && props.dragging !== id) event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        const from = event.dataTransfer.getData('application/x-replay-tile');
        if (from && from !== id) actions.onDrop(from, id);
        props.onDragState(undefined);
      }}
      onDoubleClick={() => actions.onPin(id)}
      onClick={(event) => {
        if (role === 'strip' && !(event.target as Element).closest('button, a')) actions.onPin(id);
      }}
    >
      {bundle && model ? (
        <TilePlayer id={id} bundle={bundle} clock={clock} offset={props.offset} fidelity={props.fidelity} label={label} />
      ) : (
        <div className="mt-player mt-player-pending" aria-busy={!failure}>
          {failure ? <p role="alert">{failure}</p> : null}
        </div>
      )}
      {status === 'waiting' ? (
        <div className="mt-overlay" data-kind="waiting">
          <span ref={countdown}>{startsIn(clock.localTime(id))}</span>
        </div>
      ) : status === 'ended' ? (
        <div className="mt-overlay" data-kind="ended">
          <span>{TILE_STRINGS.ended}</span>
        </div>
      ) : null}
      <footer className="mt-nametag">
        <span className="mt-letter" aria-hidden="true">
          {source.letter}
        </span>
        <span className="mt-label">{label}</span>
        {errors.length ? (
          <span className="mt-errors" aria-hidden="true">
            {errors.length}
          </span>
        ) : null}
      </footer>
      <div className="mt-actions" role="toolbar" aria-label={`${label} actions`}>
        <Hint label={pinned ? TILE_STRINGS.grid : TILE_STRINGS.spotlight} side="bottom">
          <button
            type="button"
            className="mt-action"
            aria-label={pinned ? TILE_STRINGS.grid : TILE_STRINGS.spotlight}
            tabIndex={tabIndex}
            onClick={() => actions.onPin(id)}
          >
            {pinned ? <Minimize2Icon aria-hidden="true" /> : <Maximize2Icon aria-hidden="true" />}
          </button>
        </Hint>
        <Hint label={TILE_STRINGS.open} side="bottom">
          <a
            className="mt-action"
            href={props.href(id, 0)}
            target="_blank"
            rel="noopener"
            aria-label={TILE_STRINGS.open}
            tabIndex={tabIndex}
            onClick={(event) => {
              event.currentTarget.href = here();
            }}
          >
            <ArrowUpRightIcon aria-hidden="true" />
          </a>
        </Hint>
        <TileMenu
          label={label}
          sheet={props.sheet}
          tabIndex={tabIndex}
          items={[
            { id: 'hide', label: TILE_STRINGS.hide, icon: <EyeOffIcon aria-hidden="true" />, onSelect: () => actions.onHide(id) },
            {
              id: 'markers',
              label: muted ? TILE_STRINGS.unmute : TILE_STRINGS.mute,
              icon: muted ? <FlagIcon aria-hidden="true" /> : <FlagOffIcon aria-hidden="true" />,
              onSelect: () => actions.onMute(id),
            },
            {
              id: 'copy',
              label: TILE_STRINGS.copy,
              icon: <LinkIcon aria-hidden="true" />,
              onSelect: () =>
                void navigator.clipboard
                  ?.writeText(new URL(here(), location.origin).href)
                  .then(() => notify(TILE_STRINGS.copied, 'success')),
            },
          ]}
        />
      </div>
    </section>
  );
}
