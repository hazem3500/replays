import { SPEEDS, type Speed } from '../playback/types.ts';

/** App controls offer up to four times speed; portable playback retains its full rate range. */
export const APP_PLAYBACK_SPEEDS = SPEEDS.filter((speed) => speed <= 4);

export function appPlaybackSpeed(speed: number): Speed {
  return APP_PLAYBACK_SPEEDS.find((candidate) => candidate === Math.min(speed, 4)) ?? 1;
}
