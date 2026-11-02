import { type PointerEvent as ReactPointerEvent, useEffect } from 'react';

import type { ReplayEdits } from '../../shared/edits.ts';
import { type EditorAction, type Selection, setTrimEdge, trimOf } from '../editor/state.ts';
import { startDrag, type TimelineScale } from '../editor/timeline/scale.ts';
import { usePlayer } from '../player.ts';

type Dispatch = (action: EditorAction) => void;

/** Press on the ruler (or the playhead's knob) to seek, drag to scrub. */
export function useScrub(scale: TimelineScale) {
  const player = usePlayer();
  return (event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    player.beginScrub();
    player.seek(scale.timeAt(event.clientX));
    startDrag(event, scale, { move: (time) => player.seek(time), end: () => player.endScrub() });
  };
}

/** A scrub that a control started ends when the control goes (the phone's ruler seek). */
export function useEndScrubOnUnmount() {
  const player = usePlayer();
  useEffect(() => () => player.endScrub(), [player]);
}

/**
 * Dragging across the clip selects a range (C cuts it); a press without a drag seeks there (and on a phone selects
 * the clip, whose trim then shows). `tap` replaces that press behaviour (a marker keeps its own click).
 */
export function useRangeDrag(scale: TimelineScale, dispatch: Dispatch, mobile: boolean) {
  const player = usePlayer();
  return (event: ReactPointerEvent, tap?: () => void) => {
    if (event.button !== 0) return;
    const start = scale.timeAt(event.clientX);
    startDrag(event, scale, {
      move: (time) => {
        dispatch({ type: 'select', selection: { kind: 'range', from: Math.min(start, time), to: Math.max(start, time) } });
        player.seek(time);
      },
      end: (moved, time) => {
        if (moved) return;
        if (tap) return tap();
        dispatch({ type: 'select', selection: mobile ? { kind: 'trim' } : undefined });
        player.seek(time);
        if (mobile) player.pause();
      },
    });
  };
}

/**
 * A trim edge: drag it (scrubbing the preview to the edge) or nudge it with the keys. `latest` is the edit list at
 * the moment of each move; `change` records the first move as an undo step and merges the rest.
 */
export function useTrimEdge({
  scale,
  edge,
  latest,
  change,
  dispatch,
  mobile,
}: {
  scale: TimelineScale;
  edge: 'start' | 'end';
  latest: { readonly current: ReplayEdits };
  change: (edits: ReplayEdits, first: boolean, select?: Selection) => void;
  dispatch: Dispatch;
  mobile: boolean;
}) {
  const player = usePlayer();
  const duration = scale.duration;
  const set = (time: number, first: boolean) => {
    const next = setTrimEdge(latest.current, edge, time, duration);
    change(next, first, mobile || next.trim ? { kind: 'trim' } : undefined);
    player.seek(trimOf(next, duration)[edge]);
  };
  return {
    onPointerDown: (event: ReactPointerEvent) => {
      dispatch({ type: 'select', selection: mobile || latest.current.trim ? { kind: 'trim' } : undefined });
      player.beginScrub();
      startDrag(event, scale, { move: set, end: () => player.endScrub() });
    },
    nudge: (time: number) => set(time, true),
  };
}
