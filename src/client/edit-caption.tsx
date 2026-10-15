import './step-caption.css';

import { AnimatedText } from '@/components/animated-text.tsx';

import { editCaptionAt, type PlaybackEffects } from '../shared/effects.ts';
import { usePlayhead } from './player.ts';

/**
 * A caption from the edit list (src/shared/effects.ts), at the bottom of the recorded frame while the playhead is
 * inside it. Part of the edit, like a burned-in title: shown whether playing or paused, in the step caption's look
 * (step-caption.css) without the step number. The video render draws the same text (src/client/render/main.ts).
 */
export function EditCaption({ captions }: { captions: PlaybackEffects['captions'] }) {
  const label = usePlayhead((time) => editCaptionAt(captions, time)?.label ?? '');
  if (!label) return null;
  return (
    <div className="step-caption" aria-hidden="true" data-testid="edit-caption">
      <span className="step-caption-text">
        <AnimatedText className="step-caption-label" text={label} />
      </span>
    </div>
  );
}
