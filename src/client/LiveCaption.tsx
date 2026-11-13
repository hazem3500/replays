import { type ReactNode, useState } from 'react';

import type { CaptionPlace } from './caption-placement.ts';
import { CaptionMorph } from './CaptionMorph.tsx';
import { useCaptionPresence } from './hooks/use-caption-presence.ts';
import { useCaptionMotion } from './hooks/use-caption-motion.ts';
import { useParentDoubleClick } from './hooks/use-parent-double-click.ts';

interface LiveCaptionProps {
  text: string | undefined;
  number?: number | undefined;
  testId: string;
  /** The frame edge it sits on (caption-placement.ts); bottom when absent. */
  place?: CaptionPlace;
  /** The pointer is under the pill right now: it fades back so the pointer shows through. */
  covered?: boolean;
  /** Makes the pill editable: a double-click on it (single clicks still reach the player). */
  onDoubleClick?: () => void;
  /** Shown in place of the line while it is being edited. */
  editor?: ReactNode;
}

/**
 * The caption host on the recorded frame, shared by step captions (viewer) and edit captions. One stable element at
 * its edge (the bottom, or the top: `place`): a new caption swaps the whole line in place; a hide fades the last
 * caption out whole, where it was (step-caption.css, imported by its callers); a caption that shows again after a
 * hide, or on the other edge, starts fresh.
 */
export function LiveCaption(props: LiveCaptionProps) {
  const place = useHeldPlace(props.place ?? 'bottom', props.text !== undefined);
  return <CaptionHost key={place} {...props} place={place} />;
}

/** The place of the caption on screen: a hiding caption keeps the edge it was shown on until it is gone. */
function useHeldPlace(place: CaptionPlace, showing: boolean) {
  const [held, setHeld] = useState(place);
  // why: adjusted during render, like useCaptionPresence, so the hiding frame never jumps edges.
  if (showing && place !== held) setHeld(place);
  return showing ? place : held;
}

function CaptionHost({ text, number, testId, place = 'bottom', covered, onDoubleClick, editor }: LiveCaptionProps) {
  const caption = useCaptionPresence(text, number);
  const ref = useCaptionMotion(caption, place);
  useParentDoubleClick(ref, '.step-caption-text', editor ? undefined : onDoubleClick);
  return (
    <div
      ref={ref}
      className="step-caption step-caption-live"
      data-active={caption.active ? 'true' : 'false'}
      data-place={place === 'top' ? 'top' : undefined}
      data-covered={covered && caption.active && !editor ? 'true' : undefined}
      data-testid={testId}
      data-editing={editor ? 'true' : undefined}
      role="status"
      aria-live="off"
      aria-label={caption.active ? caption.text : undefined}
    >
      <span className="step-caption-text">
        {caption.number === undefined ? null : (
          <span className="step-caption-number" aria-hidden="true">
            {caption.number}
          </span>
        )}
        {editor ?? (
          <span className="step-caption-label" aria-hidden="true">
            <CaptionMorph key={caption.appearance} text={caption.text ?? ''} />
          </span>
        )}
      </span>
    </div>
  );
}
