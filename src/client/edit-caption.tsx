import './step-caption.css';

import { editCaptionAt, type PlaybackEffects } from '../shared/effects.ts';
import { usePlayer, usePlayhead } from './player.ts';
import { LiveCaption } from './LiveCaption.tsx';

/**
 * A caption from the edit list (src/shared/effects.ts), on the recorded frame while the playhead is inside it. Part
 * of the edit, like a burned-in title: shown whether playing or paused, in the step caption's look
 * (step-caption.css) without the step number, at the edge the video render (src/client/render/main.ts) gives it.
 */
export function EditCaption({ captions }: { captions: PlaybackEffects['captions'] }) {
  const player = usePlayer();
  const index = usePlayhead((time) => editCaptionAt(captions, time)?.index ?? -1);
  const caption = captions[index];
  const edge = caption && player.captionEdge ? player.captionEdge(caption.from, caption.to) : 'bottom';
  return <LiveCaption text={caption?.text || undefined} edge={edge} testId="edit-caption" />;
}
