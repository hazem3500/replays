import { useState } from 'react';

import type { CaptionEdge } from '../caption-placement.ts';

export interface CaptionPresence {
  text: string | undefined;
  number: number | undefined;
  active: boolean;
  /** Bumps each time a caption shows after being hidden, so its text starts fresh instead of morphing from stale text. */
  appearance: number;
  edge: CaptionEdge;
  /** The caption is leaving its edge for the other one: it fades out where it was, then shows at `next`. */
  moving: boolean;
  next: CaptionEdge;
}

/** The browser Motion exit duration before the caption changes frame edge. */
export const CAPTION_MOVE_MS = 140;

/**
 * The caption to draw: while it hides, the last caption stays (same text, number and box size) so it fades out
 * whole instead of collapsing first. `text` undefined means no caption now. A caption that changes edge (top or
 * bottom of the frame) leaves its old edge whole, then shows fresh at the new one: it never slides across the page.
 */
export function useCaptionPresence(text: string | undefined, number?: number | undefined, edge: CaptionEdge = 'bottom') {
  const [state, setState] = useState<CaptionPresence>(() => ({
    text,
    number,
    active: text !== undefined,
    appearance: 0,
    edge,
    moving: false,
    next: edge,
  }));
  let next = state;
  if (text === undefined) {
    if (state.active || state.moving) next = { ...state, active: false, moving: false };
  } else if (state.active && edge !== state.edge) {
    next = { ...state, active: false, moving: true, next: edge };
  } else if (state.moving) {
    if (edge !== state.next) next = { ...state, next: edge };
  } else if (!state.active) {
    next = { text, number, active: true, appearance: state.appearance + 1, edge, moving: false, next: edge };
  } else if (text !== state.text || number !== state.number) {
    next = { ...state, text, number };
  }
  // why: adjusted during render, so the hiding frame still draws the old caption.
  if (next !== state) setState(next);

  const completeMove = () => setState((current) => (current.moving ? { ...current, moving: false } : current));
  return { ...next, completeMove };
}
