import { useOpacityMotion } from '../hooks/use-opacity-motion.ts';
import { XIcon } from 'lucide-react';
import type { MotionStyle } from 'motion/react';
import { useRef, useState } from 'react';
import * as m from 'motion/react-m';

import type { ReplayBundle } from '../../shared/replay.ts';
import { AnimatedIcon } from '@/components/animated-icon.tsx';
import { Hint } from '@/components/icon-button.tsx';
import { useViewerPresenceMotion } from '../hooks/use-viewer-presence-motion.ts';
import { useClockState } from '../hooks/use-clock.ts';
import { useTilePlayer } from '../hooks/use-tile-player.ts';
import { useTileCoverMotion } from '../hooks/use-tile-cover-motion.ts';
import { apiUrl } from '../api/fetch.ts';
import { freshPoster } from '../transitions/open-hint.ts';
import { formatSeconds } from '../permalink.ts';
import { plural } from '../plural.ts';
import type { Fidelity } from './clock.ts';
import type { Placement } from './layout.ts';
import type { CompareSession } from './session.ts';
import { Identity } from './Identity.tsx';
import { StepCaption } from '../viewer/StepCaption.tsx';
import { useViewer } from '../viewer/context.ts';
import type { CompareTile } from './tiles.ts';
import { REPLAY_LAYOUT_SPRING } from './motion.ts';

const TILE_STRINGS = {
  loading: 'Loading recording',
  unavailable: (reason: string) => `Recorded page unavailable: ${reason}`,
  ended: 'Ended',
  spotlight: 'Spotlight',
  grid: 'Back to grid',
  open: 'Open on its own',
  remove: 'Remove from comparison',
  inspect: (name: string, errors: number) => `Show ${name} in the panels${errors ? `, ${plural(errors, 'error')}` : ''}`,
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

function placementStyle(placement: Placement | undefined): MotionStyle {
  if (!placement) return {};
  return {
    left: placement.x,
    top: placement.y,
    width: placement.width,
    height: placement.height,
    borderRadius: placement.role === 'single' ? 0 : 10,
  };
}

function tileName(tile: CompareTile, ended: boolean) {
  const errors = tile.errors ? `, ${plural(tile.errors, 'error')}` : '';
  return `${tile.label}${errors}${ended ? ', ended' : ''}`;
}

/** One compared recording: its picture on the shared clock, its name and colour, and a few hover actions. */
export function CompareTileView({
  session,
  tile,
  placement,
  focused,
  alone,
  fidelity,
  motion,
  commands,
}: {
  session: CompareSession;
  tile: CompareTile;
  placement: Placement | undefined;
  focused: boolean;
  alone: boolean;
  fidelity: Fidelity;
  motion: { enabled: boolean; dependency: string; instant: boolean };
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
    <m.section
      layout={motion.enabled}
      layoutDependency={motion.dependency}
      initial={false}
      animate={{ opacity: hidden ? 0 : 1 }}
      transition={{ layout: REPLAY_LAYOUT_SPRING, opacity: { duration: motion.instant ? 0 : 0.16, ease: 'easeOut' } }}
      className="ct-tile"
      style={placementStyle(placement)}
      data-tile={tile.colour}
      data-role={role}
      data-focused={ringed(focused, single, alone)}
      data-current={focused || undefined}
      data-ended={ended || undefined}
      data-issues={(tile.errors > 0 && !single) || undefined}
      data-tile-id={tile.id}
      aria-label={tileName(tile, ended)}
      aria-hidden={hidden || undefined}
      inert={hidden}
    >
      {tile.bundle ? (
        <TilePicture
          session={session}
          id={tile.id}
          bundle={tile.bundle}
          fidelity={fidelity}
          caption={focused}
          ended={ended}
          size={placement}
        />
      ) : (
        <TileNotice busy={!tile.failure} text={tile.failure || TILE_STRINGS.loading} />
      )}
      <button
        type="button"
        className="ct-hit"
        aria-label={single ? TILE_STRINGS.playPause : TILE_STRINGS.inspect(tile.name, tile.errors)}
        aria-pressed={single ? undefined : focused}
        onClick={onHit}
        onDoubleClick={onSpotlight}
      />
      <TileLabel tile={tile} ended={ended && !single} />
      {single ? null : <TileActions session={session} tile={tile} spotlit={role === 'spotlight'} alone={alone} commands={commands} />}
    </m.section>
  );
}

/** A heavier frame in the tile's colour marks the focus wherever there is more than one tile on the stage. */
function ringed(focused: boolean, single: boolean, alone: boolean) {
  return (focused && !single && !alone) || undefined;
}

/**
 * The tile's frame carries its colour, so its name only shows where nothing else names it (compare.css hides the tag
 * beside an expanded suite sidebar). The count of issues lives in the tile's accessible names; the dot only marks them.
 */
function TileLabel({ tile, ended }: { tile: CompareTile; ended: boolean }) {
  return (
    <>
      {ended ? (
        <span className="ct-ended" aria-hidden="true">
          {TILE_STRINGS.ended}
        </span>
      ) : null}
      {tile.errors ? <span className="ct-issues" aria-hidden="true" /> : null}
      <footer className="ct-label" aria-hidden="true">
        <Identity tile={tile} />
        {tile.errors ? <span className="ct-label-issues" /> : null}
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
  const actions = useRef<HTMLDivElement>(null);
  useViewerPresenceMotion(actions, 'compare');
  const spotlightLabel = spotlit ? TILE_STRINGS.grid : TILE_STRINGS.spotlight;
  // why: the link carries the moment it is opened at, not the moment it was rendered at.
  const here = () => formatSeconds(Math.min(session.clock.getTime(), tile.bundle?.meta.duration ?? 0));
  return (
    <div ref={actions} className="ct-actions" role="toolbar" aria-label={tile.label}>
      {alone ? null : (
        <Hint label={spotlightLabel} side="bottom">
          <button
            type="button"
            className="ct-action"
            aria-label={spotlightLabel}
            data-testid="tile-spotlight"
            onClick={() => commands.onSpotlight(tile.id)}
          >
            <AnimatedIcon name={spotlit ? 'minimize' : 'maximize'} />
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
          <AnimatedIcon name="arrow-up-right" />
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

/**
 * The tile's recorded page. The focused tile carries the step captions when they are on: the panels, the steps rail
 * and the captions all follow the focused recording, on its own frame.
 */
function TilePicture({
  session,
  id,
  bundle,
  fidelity,
  caption,
  ended,
  size,
}: {
  session: CompareSession;
  id: string;
  bundle: ReplayBundle;
  fidelity: Fidelity;
  caption: boolean;
  ended: boolean;
  size: Pick<Placement, 'width' | 'height'> | undefined;
}) {
  const controller = session.controller({ id, bundle });
  const { stage, failure, painted } = useTilePlayer({ session, id, controller, fidelity, size });
  useOpacityMotion(stage, ended ? 0.55 : 1);
  const cover = useTileCoverMotion(painted);
  const [poster] = useState(() => {
    const hinted = caption ? freshPoster() : undefined;
    const path = `replays/${encodeURIComponent(bundle.meta.id)}/`;
    return hinted?.includes(`/${path}`) ? hinted : apiUrl(`${path}poster?v=2`);
  });
  const { captions, steps, editCaptions } = useViewer();
  if (failure) return <TileNotice busy={false} text={TILE_STRINGS.unavailable(failure)} />;
  return (
    <div ref={stage} className="ct-picture" data-fidelity={fidelity}>
      <div className="ct-host player-host" inert />
      <img ref={cover} className="ct-cover" src={poster} alt="" aria-hidden="true" />
      {caption && captions && steps.length > 0 && !editCaptions ? <StepCaption /> : null}
    </div>
  );
}
