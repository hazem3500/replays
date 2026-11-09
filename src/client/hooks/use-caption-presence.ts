import { useState } from 'react';

export interface CaptionPresence {
  text: string | undefined;
  number: number | undefined;
  active: boolean;
  /** Bumps each time a caption shows after being hidden, so its text starts fresh instead of morphing from stale text. */
  appearance: number;
}

/** The browser Motion exit duration of a hiding caption. */
export const CAPTION_MOVE_MS = 140;

/**
 * The caption to draw: while it hides, the last caption stays (same text, number and box size) so it fades out
 * whole instead of collapsing first. `text` undefined means no caption now.
 */
export function useCaptionPresence(text: string | undefined, number?: number | undefined) {
  const [state, setState] = useState<CaptionPresence>(() => ({
    text,
    number,
    active: text !== undefined,
    appearance: 0,
  }));
  let next = state;
  if (text === undefined) {
    if (state.active) next = { ...state, active: false };
  } else if (!state.active) {
    next = { text, number, active: true, appearance: state.appearance + 1 };
  } else if (text !== state.text || number !== state.number) {
    next = { ...state, text, number };
  }
  // why: adjusted during render, so the hiding frame still draws the old caption.
  if (next !== state) setState(next);

  return next;
}
