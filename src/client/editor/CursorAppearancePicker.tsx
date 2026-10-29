import { RadioCard, RadioGroup } from '@/components/ui/radio-group.tsx';
import { CURSOR_COLORS, type CursorAppearance, type CursorColor, isCursorAppearance, isCursorColor } from '../../shared/cursor.ts';
import { CURSOR_COLOR_LABELS, CURSOR_THEMES, cursorColorValue, type CursorTheme } from '../cursor-themes.ts';
import { useCursorGlyph } from '../hooks/use-cursor-glyph.ts';

const DEFAULT_COLOR = 'default';

function Glyph({ theme, color }: { theme: CursorTheme; color: string | undefined }) {
  const host = useCursorGlyph(theme, color);
  return <span ref={host} className="cursor-style-glyph" aria-hidden="true" />;
}

/** The cursor's look: every theme as a card drawn by the player's own renderer, then an optional tint. */
export function CursorAppearancePicker({
  appearance,
  color,
  disabled,
  onChange,
}: {
  appearance: CursorAppearance;
  color: CursorColor | undefined;
  disabled: boolean;
  onChange: (patch: { appearance?: CursorAppearance; color?: CursorColor | undefined }) => void;
}) {
  const tint = cursorColorValue(color);
  const selected = CURSOR_THEMES.find((theme) => theme.id === appearance);
  return (
    <div className="cursor-style">
      <span className="cursor-section-label" id="cursor-style-label">
        Style
      </span>
      <RadioGroup
        className="cursor-style-grid"
        value={appearance}
        disabled={disabled}
        aria-labelledby="cursor-style-label"
        aria-describedby="cursor-style-description"
        onValueChange={(next) => {
          if (isCursorAppearance(next)) onChange({ appearance: next });
        }}
      >
        {CURSOR_THEMES.map((theme) => (
          <RadioCard key={theme.id} value={theme.id} className="cursor-style-option" data-style={theme.id}>
            <span className="cursor-style-well">
              <Glyph theme={theme} color={tint} />
            </span>
            <span className="cursor-style-name">{theme.label}</span>
          </RadioCard>
        ))}
      </RadioGroup>
      <p className="cursor-motion-description" id="cursor-style-description">
        {selected?.description}
      </p>
      <span className="cursor-section-label cursor-color-label" id="cursor-color-label">
        Color
      </span>
      <RadioGroup
        className="cursor-color-row"
        value={color ?? DEFAULT_COLOR}
        disabled={disabled}
        aria-labelledby="cursor-color-label"
        onValueChange={(next) => onChange({ color: isCursorColor(next) ? next : undefined })}
      >
        <RadioCard value={DEFAULT_COLOR} className="cursor-color-swatch" data-default="" aria-label="The style's own colors" />
        {Object.entries(CURSOR_COLORS).map(([name, value]) => (
          <RadioCard
            key={name}
            value={name}
            className="cursor-color-swatch"
            style={{ background: value }}
            aria-label={isCursorColor(name) ? CURSOR_COLOR_LABELS[name] : name}
          />
        ))}
      </RadioGroup>
    </div>
  );
}
