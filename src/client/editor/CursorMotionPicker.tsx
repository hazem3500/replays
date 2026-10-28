import { RadioCard, RadioGroup } from '@/components/ui/radio-group.tsx';
import { isCursorMotionStyle, type CursorMotionStyle } from '../../shared/cursor.ts';
import { CURSOR_CANVAS, CURSOR_HOTSPOT, CURSOR_PATH } from '../cursor-motion.ts';
import { CURSOR_MOTION_PREVIEWS, PREVIEW_BOX, type CursorMotionPreview } from './cursor-motion-previews.ts';

const ARROW_UNITS = 26;
const ARROW_SCALE = ARROW_UNITS / CURSOR_CANVAS;

/** The CUA arrow drawn with its hotspot at the group origin. */
function Arrow() {
  return (
    <path
      className="cursor-motion-arrow"
      d={CURSOR_PATH}
      transform={`scale(${ARROW_SCALE}) translate(${-CURSOR_HOTSPOT.x} ${-CURSOR_HOTSPOT.y})`}
    />
  );
}

function MotionPreview({ preview }: { preview: CursorMotionPreview }) {
  return (
    <svg className="cursor-motion-preview" viewBox={`0 0 ${PREVIEW_BOX.width} ${PREVIEW_BOX.height}`} aria-hidden="true">
      <path className="cursor-motion-trace" d={preview.trace} />
      <circle className="cursor-motion-origin" cx={preview.start.x} cy={preview.start.y} r="1.6" />
      <circle className="cursor-motion-target" cx={preview.end.x} cy={preview.end.y} r="3.2" />
      <g className="cursor-motion-still" transform={`translate(${preview.end.x} ${preview.end.y})`}>
        <Arrow />
      </g>
      <g className="cursor-motion-moving">
        <animateMotion
          dur={`${preview.durationMs}ms`}
          repeatCount="indefinite"
          path={preview.trace}
          keyPoints={preview.keyPoints}
          keyTimes={preview.keyTimes}
          calcMode="linear"
        />
        <Arrow />
      </g>
    </svg>
  );
}

/**
 * The cursor motion styles as a radio grid. Each card draws the path its style
 * plans for the same move; the selected, hovered or focused card plays it.
 */
export function CursorMotionPicker({
  value,
  disabled,
  onChange,
}: {
  value: CursorMotionStyle;
  disabled: boolean;
  onChange: (style: CursorMotionStyle) => void;
}) {
  const selected = CURSOR_MOTION_PREVIEWS.find((preview) => preview.style === value) ?? CURSOR_MOTION_PREVIEWS[0]!;
  return (
    <div className="cursor-motion">
      <span className="cursor-section-label" id="cursor-motion-label">
        Motion
      </span>
      <RadioGroup
        className="cursor-motion-grid"
        value={value}
        disabled={disabled}
        aria-labelledby="cursor-motion-label"
        aria-describedby="cursor-motion-description"
        onValueChange={(next) => {
          if (isCursorMotionStyle(next)) onChange(next);
        }}
      >
        {CURSOR_MOTION_PREVIEWS.map((preview) => (
          <RadioCard key={preview.style} value={preview.style} className="cursor-motion-option" data-style={preview.style}>
            <MotionPreview preview={preview} />
            <span className="cursor-motion-name">{preview.label}</span>
          </RadioCard>
        ))}
      </RadioGroup>
      <p className="cursor-motion-description" id="cursor-motion-description">
        {selected.description}
      </p>
    </div>
  );
}
