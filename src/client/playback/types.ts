import { PLAYBACK_SPEEDS } from '../../shared/render-variant.ts';
import type { IdleGap } from '../../shared/skip.ts';
import type { ReplayController } from './controller.ts';

export const SPEEDS = PLAYBACK_SPEEDS;
export type Speed = (typeof SPEEDS)[number];
export type PlaybackStatus = 'paused' | 'playing' | 'ended';

export interface PlayerState {
  status: PlaybackStatus;
  /** The chosen speed; a skip's fast-forward never changes it. */
  speed: Speed;
  skipInactive: boolean;
  /** Play was asked for and starts once the replay is ready (its frame is still loading, or its run is being switched in). */
  starting?: boolean | undefined;
  /** The idle gap being fast-forwarded right now, if any. */
  skipping?: IdleGap | undefined;
}

export interface Viewport {
  width: number;
  height: number;
}

export type Listener = () => void;

/** Takes a player's play requests while a run switch is pending: `request` on play, `cancel` on pause. */
export interface PlayHold {
  request(): void;
  cancel(): void;
}

/**
 * What the viewer's chrome (transport, shortcuts, steps, inspector) drives: one recording's controller, or a
 * comparison's shared clock scoped to its focused recording (compare/shared-player.ts).
 */
export type Playback = Pick<
  ReplayController,
  | 'duration'
  | 'idleGaps'
  | 'eventCount'
  | 'wrapper'
  | 'mount'
  | 'getEffects'
  | 'setEffects'
  | 'setZoomSuspended'
  | 'highlightTarget'
  | 'clearTarget'
  | 'play'
  | 'pause'
  | 'playPause'
  | 'seek'
  | 'isScrubbing'
  | 'beginScrub'
  | 'endScrub'
  | 'setSpeed'
  | 'setSkipInactive'
  | 'getTime'
  | 'getState'
  | 'getViewport'
  | 'subscribeTime'
  | 'subscribeSeek'
  | 'subscribeState'
  | 'subscribeViewport'
> & {
  /** False when the playback cannot fast-forward idle stretches (a shared clock: one ruler for every recording). */
  readonly canSkipInactive?: boolean;
};
