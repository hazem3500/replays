import {
  CAPTION_BACKGROUNDS,
  CAPTION_POSITIONS,
  CAPTION_SIZES,
  type ReplayCaptionStyle,
  resolveCaptionStyle,
} from '../../shared/caption-style.ts';
import { editorStrings } from './strings.ts';

const strings = editorStrings.captionStyle;

/** One setting as a row of pressed buttons (the app's `.segmented` control). */
function Choice<T extends string>({
  id,
  label,
  options,
  names,
  value,
  onChange,
}: {
  id: string;
  label: string;
  options: readonly T[];
  names: Record<T, string>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="caption-style-row">
      <span id={id}>{label}</span>
      <div className="segmented" role="group" aria-labelledby={id} data-testid={id}>
        {options.map((option) => (
          <button key={option} type="button" aria-pressed={option === value} onClick={() => onChange(option)}>
            {names[option]}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * How the edit list's captions look, for the whole replay: size, position on the frame and background. The viewer,
 * this preview and the exported video draw the same style (caption-style.css).
 */
export function CaptionStyleSection({
  style,
  hasCaptions,
  onChange,
}: {
  style: ReplayCaptionStyle | undefined;
  hasCaptions: boolean;
  onChange: (style: ReplayCaptionStyle) => void;
}) {
  const current = resolveCaptionStyle(style);
  const set = (patch: ReplayCaptionStyle) => onChange({ ...current, ...patch });
  return (
    <div className="caption-style-section" role="group" aria-labelledby="caption-style-heading" data-testid="caption-style">
      <h2 id="caption-style-heading">{strings.title}</h2>
      {hasCaptions ? null : <p className="caption-style-hint">{strings.none}</p>}
      <Choice id="caption-size" label={strings.size} options={CAPTION_SIZES} names={strings.sizes} value={current.size} onChange={(size) => set({ size })} />
      <Choice
        id="caption-position"
        label={strings.position}
        options={CAPTION_POSITIONS}
        names={strings.positions}
        value={current.position}
        onChange={(position) => set({ position })}
      />
      <Choice
        id="caption-background"
        label={strings.background}
        options={CAPTION_BACKGROUNDS}
        names={strings.backgrounds}
        value={current.background}
        onChange={(background) => set({ background })}
      />
    </div>
  );
}
