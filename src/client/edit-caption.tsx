import './step-caption.css';

import { useMemo } from 'react';

import { editCaptionAt, type PlaybackEffects } from '../shared/effects.ts';
import { editCaptionPlaces, pointerUnderCaption } from './caption-placement.ts';
import { usePlayer, usePlayhead } from './player.ts';
import { LiveCaption } from './LiveCaption.tsx';

/**
 * A caption from the edit list (src/shared/effects.ts), on the recorded frame while the playhead is inside it. Part
 * of the edit, like a burned-in title: shown whether playing or paused, in the step caption's look
 * (step-caption.css) without the step number, at the bottom edge, or the top when the pointer is under its bottom
 * place, like the video render (src/client/render/main.ts; caption-placement.ts).
 */
export function EditCaption({ captions }: { captions: PlaybackEffects['captions'] }) {
  const player = usePlayer();
  const pointer = player.pointerTrack();
  const places = useMemo(() => editCaptionPlaces(captions, pointer), [captions, pointer]);
  const index = usePlayhead((time) => editCaptionAt(captions, time)?.index ?? -1);
  const text = captions[index]?.text || undefined;
  const place = places[index] ?? 'bottom';
  const covered = usePlayhead((time) => (text === undefined ? false : pointerUnderCaption(pointer, time, place, text, false)));
  return <LiveCaption text={text} place={place} covered={covered} testId="edit-caption" />;
}
