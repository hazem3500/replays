import { PLAYBACK_SPEEDS } from '../../shared/render-variant.ts';
import type { IdleGap } from '../../shared/skip.ts';
import type { CaptionEdge } from '../caption-placement.ts';
import type { ReplayController } from './controller.ts';

export const SPEEDS = PLAYBACK_SPEEDS;
export type Speed = (typeof SPEEDS)[number];
export type PlaybackStatus = 'paused' | 'playing' | 'ended';

export interface PlayerState {
  status: PlaybackStatus;
  /** The chosen speed; a skip's fast-forward never changes it. */
  speed: Speed;
  skipInactive: boolean;
  /** The idle gap being fast-forwarded right now, if any. */
  skipping?: IdleGap | undefined;
}

export interface Viewport {
  width: number;
  height: number;
}

export type Listener = () => void;

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
  /** Where captions sit (ReplayController.captionEdge); without it they stay at the bottom. */
  readonly captionEdge?: (from: number, to: number) => CaptionEdge;
};
