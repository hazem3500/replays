import { CaptionMorph } from './CaptionMorph.tsx';
import { useCaptionPresence } from './hooks/use-caption-presence.ts';

/**
 * The caption host at the bottom of the recorded frame, shared by step captions (viewer) and edit captions.
 * One stable element: a new caption swaps the whole line in place; a hide fades and drops the last caption whole
 * (step-caption.css, imported by its callers); a caption that shows again after a hide starts fresh.
 */
export function LiveCaption({ text, number, testId }: { text: string | undefined; number?: number | undefined; testId: string }) {
  const caption = useCaptionPresence(text, number);
  return (
    <div
      className="step-caption step-caption-live"
      data-active={caption.active ? 'true' : 'false'}
      data-testid={testId}
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
        <span className="step-caption-label" aria-hidden="true">
          <CaptionMorph key={caption.appearance} text={caption.text ?? ''} />
        </span>
      </span>
    </div>
  );
}
