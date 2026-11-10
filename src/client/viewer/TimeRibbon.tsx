export type RibbonTone = 'danger' | 'warning' | 'neutral' | 'success';

/** A stretch of the recording, in ms on the player's clock, picked by dragging across a timeline. */
export interface RibbonRange {
  from: number;
  to: number;
}
