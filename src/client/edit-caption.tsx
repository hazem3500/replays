import './caption-style.css';

import { captionStyleData } from '../shared/caption-style.ts';
import { editCaptionAt, type PlaybackEffects } from '../shared/effects.ts';
import { LiveCaption } from './LiveCaption.tsx';
import { usePlayhead } from './player.ts';

/**
 * A caption from the edit list (src/shared/effects.ts), at the bottom of the recorded frame while the playhead is
 * inside it. Part of the edit, like a burned-in title: shown whether playing or paused, in the step caption's look
 * (step-caption.css) without the step number, styled by the edit list's caption style (caption-style.css). The video
 * render draws the same caption (src/client/render/main.ts).
 */
export function EditCaption({ captions, style }: { captions: PlaybackEffects['captions']; style?: PlaybackEffects['captionStyle'] }) {
  const label = usePlayhead((time) => editCaptionAt(captions, time)?.label ?? '');
  return (
    <div className="caption-style" {...captionStyleData(style)}>
      <LiveCaption text={label || undefined} testId="edit-caption" />
    </div>
  );
}
