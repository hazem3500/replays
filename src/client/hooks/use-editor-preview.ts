import { useCallback, useEffect, useMemo, useRef } from 'react';

import type { EditTimeline, ReplayEdits } from '../../shared/edits.ts';
import { IDENTITY_TIME, playbackEffects } from '../../shared/effects.ts';
import type { ReplayController, Speed } from '../player.ts';

/**
 * The editor's live preview: the player draws the effects on the original timeline it plays (zoom, blur, captions),
 * and playback skips cuts, stops at the trim end and plays speed-ups at their rate. `holdZoom` keeps the zoom at 1×
 * (placing or editing a blur box, so the box sits on the page as recorded).
 */
export function useEditorPreview(
  player: ReplayController,
  edits: ReplayEdits,
  timeline: EditTimeline,
  events: ReadonlyArray<{ timestamp: number; type?: unknown; data?: unknown }>,
  holdZoom: boolean,
) {
  const duration = player.duration;
  const effects = useMemo(() => playbackEffects(edits, IDENTITY_TIME(duration), events), [duration, edits, events]);
  useEffect(() => player.setEffects(effects), [player, effects]);
  useEffect(() => player.setZoomSuspended(holdZoom), [holdZoom, player]);

  const live = useRef({ timeline, speeds: edits.speeds });
  useEffect(() => {
    live.current = { timeline, speeds: edits.speeds };
  }, [timeline, edits.speeds]);

  useEffect(
    () =>
      player.subscribeTime(() => {
        if (player.getState().status !== 'playing' || player.isScrubbing()) return;
        const { timeline: current, speeds } = live.current;
        const time = player.getTime();
        const rate = (speeds?.find((item) => time >= item.from && time < item.to)?.rate ?? 1) as Speed;
        if (player.getState().speed !== rate) player.setSpeed(rate);
        const range = current.removed.find((item) => time >= item.from && time < item.to);
        if (!range) return;
        if (range.to >= player.duration - 1) {
          player.pause();
          player.seek(range.from);
        } else player.seek(range.to);
      }),
    [player],
  );

  const playPause = useCallback(() => {
    const { timeline: current } = live.current;
    if (player.getState().status !== 'playing') {
      // From a trimmed-off end (or the very end), play the edited version from its start.
      const time = player.getTime();
      const tail = current.removed.at(-1);
      const atEnd = (tail && tail.to >= player.duration - 1 && time >= tail.from - 1) || time >= player.duration - 1;
      if (atEnd || current.isRemoved(time)) player.seek(current.toOriginal(atEnd ? 0 : current.toEdited(time)));
    }
    player.playPause();
  }, [player]);

  return { effects, playPause };
}
