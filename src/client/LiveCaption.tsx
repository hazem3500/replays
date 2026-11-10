import type { ReactNode } from 'react';

import { CaptionMorph } from './CaptionMorph.tsx';
import { useCaptionPresence } from './hooks/use-caption-presence.ts';
import { useCaptionMotion } from './hooks/use-caption-motion.ts';
import { useParentDoubleClick } from './hooks/use-parent-double-click.ts';

/**
 * The caption host on the recorded frame, shared by step captions (viewer) and edit captions. One stable element at
 * the bottom edge: a new caption swaps the whole line in place; a hide fades the last caption out whole
 * (step-caption.css, imported by its callers); a caption that shows again after a hide starts fresh.
 */
export function LiveCaption({
  text,
  number,
  testId,
  onDoubleClick,
  editor,
}: {
  text: string | undefined;
  number?: number | undefined;
  testId: string;
  /** Makes the pill editable: a double-click on it (single clicks still reach the player). */
  onDoubleClick?: () => void;
  /** Shown in place of the line while it is being edited. */
  editor?: ReactNode;
}) {
  const caption = useCaptionPresence(text, number);
  const ref = useCaptionMotion(caption);
  useParentDoubleClick(ref, '.step-caption-text', editor ? undefined : onDoubleClick);
  return (
    <div
      ref={ref}
      className="step-caption step-caption-live"
      data-active={caption.active ? 'true' : 'false'}
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
