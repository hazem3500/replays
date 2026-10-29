import { RadioCard, RadioGroup } from '@/components/ui/radio-group.tsx';
import { CURSOR_CLICK_EFFECTS, type ReplayCursorSettings } from '../../shared/cursor.ts';
import { CLICK_COPY, type ClickChoice, clickChoiceOf } from './cursor-recipe.ts';

const CHOICES: readonly ClickChoice[] = ['off', ...CURSOR_CLICK_EFFECTS];
const isChoice = (value: unknown): value is ClickChoice => typeof value === 'string' && (CHOICES as readonly string[]).includes(value);

/** The click layer, chosen apart from the cursor's style: off, or one effect. */
export function CursorClickPicker({
  settings,
  disabled,
  onChange,
}: {
  settings: ReplayCursorSettings | undefined;
  disabled: boolean;
  onChange: (patch: ReplayCursorSettings) => void;
}) {
  const current = clickChoiceOf(settings);
  return (
    <div className="cursor-click">
      <span className="cursor-section-label" id="cursor-click-label">
        Click
      </span>
      <RadioGroup
        className="ui-segmented cursor-click-choices"
        value={current}
        disabled={disabled}
        aria-labelledby="cursor-click-label"
        aria-describedby="cursor-click-hint"
        onValueChange={(next) => {
          if (!isChoice(next)) return;
          onChange(next === 'off' ? { clickFeedback: false } : { clickFeedback: true, clickEffect: next });
        }}
      >
        {CHOICES.map((choice) => (
          <RadioCard key={choice} value={choice} className="ui-segment">
            {CLICK_COPY[choice].label}
          </RadioCard>
        ))}
      </RadioGroup>
      <p className="cursor-motion-description" id="cursor-click-hint">
        {CLICK_COPY[current].hint}
      </p>
    </div>
  );
}
