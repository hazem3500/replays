import { ArrowUpRightIcon, Maximize2Icon, Minimize2Icon, XIcon } from 'lucide-react';
import type { CSSProperties } from 'react';

import type { ReplayBundle } from '../../shared/replay.ts';
import { Hint } from '@/components/icon-button.tsx';
import { useClockState } from '../hooks/use-clock.ts';
import { useTilePlayer } from '../hooks/use-tile-player.ts';
import { formatSeconds } from '../permalink.ts';
import { plural } from '../plural.ts';
import type { Fidelity } from './clock.ts';
import type { Placement } from './layout.ts';
import type { CompareSession } from './session.ts';
import type { CompareTile } from './tiles.ts';

const TILE_STRINGS = {
  loading: 'Loading recording',
  unavailable: (reason: string) => `Recorded page unavailable: ${reason}`,
  ended: 'Ended',
  spotlight: 'Spotlight',
  grid: 'Back to grid',
  open: 'Open on its own',
  remove: 'Remove from comparison',
  inspect: (letter: string, label: string) => `Inspect ${letter}: ${label}`,
  playPause: 'Play or pause',
} as const;

export interface TileCommands {
  onFocus: (id: string) => void;
  /** Spotlight this tile, or back to the grid when it already is. */
  onSpotlight: (id: string) => void;
  onPlayPause: () => void;
  /** Takes a removable tile off the stage. */
  onRemove?: ((id: string) => void) | undefined;
  /** The recording on its own at `seconds`. */
  href: (id: string, seconds: string) => string;
}

function placementStyle(placement: Placement | undefined): CSSProperties | undefined {
  if (!placement) return undefined;
  return { transform: `translate(${placement.x}px, ${placement.y}px)`, width: placement.width, height: placement.height };
}

function tileName(tile: CompareTile, ended: boolean) {
  const errors = tile.errors ? `, ${plural(tile.errors, 'error')}` : '';
  return `${tile.letter}: ${tile.label}${errors}${ended ? ', ended' : ''}`;
}

/** One compared recording: its picture on the shared clock, its letter and label, and a few hover actions. */
export function CompareTileView({
  session,
  tile,
  placement,
  focused,
  alone,
  fidelity,
  commands,
}: {
  session: CompareSession;
  tile: CompareTile;
  placement: Placement | undefined;
  focused: boolean;
  alone: boolean;
  fidelity: Fidelity;
  commands: TileCommands;
}) {
  const ended = useClockState(session.clock, (snapshot) => snapshot.ended.has(tile.id));
  const role = placement?.role ?? 'flow';
  const single = role === 'single';
  const hidden = role === 'hidden';
  const onHit = () => {
    if (single) commands.onPlayPause();
    else commands.onFocus(tile.id);
  };
  const onSpotlight = () => {
    if (!single) commands.onSpotlight(tile.id);
  };

  return (
    <section
      className="ct-tile"
      style={placementStyle(placement)}
      data-tile={tile.colour}
      data-role={role}
      data-focused={ringed(focused, single, alone)}
      data-ended={ended || undefined}
      data-tile-id={tile.id}
      aria-label={tileName(tile, ended)}
      aria-hidden={hidden || undefined}
      inert={hidden}
    >
      {tile.bundle ? (
        <TilePicture session={session} id={tile.id} bundle={tile.bundle} fidelity={fidelity} />
      ) : (
        <TileNotice busy={!tile.failure} text={tile.failure || TILE_STRINGS.loading} />
      )}
      <button
        type="button"
        className="ct-hit"
        aria-label={single ? TILE_STRINGS.playPause : TILE_STRINGS.inspect(tile.letter, tile.label)}
        aria-pressed={single ? undefined : focused}
        onClick={onHit}
        onDoubleClick={onSpotlight}
      />
      <TileLabel tile={tile} ended={ended && !single} />
      {single ? null : <TileActions session={session} tile={tile} spotlit={role === 'spotlight'} alone={alone} commands={commands} />}
    </section>
  );
}

/** A ring in the tile's colour marks the focus wherever there is more than one tile on the stage. */
function ringed(focused: boolean, single: boolean, alone: boolean) {
  return (focused && !single && !alone) || undefined;
}

function TileLabel({ tile, ended }: { tile: CompareTile; ended: boolean }) {
  return (
    <>
      {ended ? (
        <span className="ct-ended" aria-hidden="true">
          {TILE_STRINGS.ended}
        </span>
      ) : null}
      <footer className="ct-nametag" aria-hidden="true">
        <span className="ct-letter">{tile.letter}</span>
        <span className="ct-label">{tile.label}</span>
        {tile.errors ? <span className="ct-errors">{tile.errors}</span> : null}
      </footer>
    </>
  );
}

function TileActions({
  session,
  tile,
  spotlit,
  alone,
  commands,
}: {
  session: CompareSession;
  tile: CompareTile;
  spotlit: boolean;
  alone: boolean;
  commands: TileCommands;
}) {
  const spotlightLabel = spotlit ? TILE_STRINGS.grid : TILE_STRINGS.spotlight;
  // why: the link carries the moment it is opened at, not the moment it was rendered at.
  const here = () => formatSeconds(Math.min(session.clock.getTime(), tile.bundle?.meta.duration ?? 0));
  return (
    <div className="ct-actions" role="toolbar" aria-label={`${tile.letter}: ${tile.label}`}>
      {alone ? null : (
        <Hint label={spotlightLabel} side="bottom">
          <button
            type="button"
            className="ct-action"
            aria-label={spotlightLabel}
            data-testid="tile-spotlight"
            onClick={() => commands.onSpotlight(tile.id)}
          >
            {spotlit ? <Minimize2Icon aria-hidden="true" /> : <Maximize2Icon aria-hidden="true" />}
          </button>
        </Hint>
      )}
      <Hint label={TILE_STRINGS.open} side="bottom">
        <a
          className="ct-action"
          href={commands.href(tile.id, '0.0')}
          target="_blank"
          rel="noopener"
          aria-label={TILE_STRINGS.open}
          onClick={(event) => {
            event.preventDefault();
            window.open(commands.href(tile.id, here()), '_blank', 'noopener');
          }}
        >
          <ArrowUpRightIcon aria-hidden="true" />
        </a>
      </Hint>
      {commands.onRemove && tile.removable ? (
        <Hint label={TILE_STRINGS.remove} side="bottom">
          <button
            type="button"
            className="ct-action"
            aria-label={TILE_STRINGS.remove}
            data-testid="tile-remove"
            onClick={() => commands.onRemove?.(tile.id)}
          >
            <XIcon aria-hidden="true" />
          </button>
        </Hint>
      ) : null}
    </div>
  );
}

function TileNotice({ busy, text }: { busy: boolean; text: string }) {
  return (
    <div className="ct-pending" aria-busy={busy}>
      <p role={busy ? undefined : 'alert'}>{text}</p>
    </div>
  );
}

function TilePicture({ session, id, bundle, fidelity }: { session: CompareSession; id: string; bundle: ReplayBundle; fidelity: Fidelity }) {
  const controller = session.controller({ id, bundle });
  const { stage, failure } = useTilePlayer({ session, id, controller, fidelity });
  if (failure) return <TileNotice busy={false} text={TILE_STRINGS.unavailable(failure)} />;
  return (
    <div ref={stage} className="ct-picture" data-fidelity={fidelity}>
      <div className="ct-host player-host" inert />
    </div>
  );
}
