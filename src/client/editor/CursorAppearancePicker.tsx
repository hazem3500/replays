import { useRef, useSyncExternalStore } from 'react';
import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';

import {
  CURSOR_COLOR_NAMES,
  CURSOR_COLORS,
  type CursorColor,
  DEFAULT_CURSOR_APPEARANCE,
  isCursorColor,
  type ReplayCursorSettings,
} from '../../shared/cursor.ts';
import { type CursorTheme, cursorThemes } from '../cursor-themes.ts';
import { playCursorGlyph, useCursorGlyph } from '../hooks/use-cursor-glyph.ts';
import { viewerRegistry } from '../plugins/registry.ts';

const COLOR_LABELS: Record<CursorColor, string> = {
  accent: 'Accent',
  periwinkle: 'Periwinkle',
  green: 'Green',
  amber: 'Amber',
  coral: 'Coral',
  graphite: 'Graphite',
};
/** The swatch group's "no tint" value. */
const OWN = 'own';
/** The picker's previews always tag the agent cursor with this. */
const PREVIEW_LABEL = 'Agent';

const prefersReducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A theme's real glyph at 75 %, or a placeholder for lazy themes (a CUA .lottie loads its player only once chosen). */
function ThemePreview({ theme, color }: { theme: CursorTheme; color: string | undefined }) {
  const host = useCursorGlyph(theme, color, PREVIEW_LABEL);
  return (
    <span className="cursor-appearance-preview" aria-hidden="true">
      {theme.lazy ? (
        <svg className="cursor-appearance-placeholder" viewBox="0 0 44 30">
          <circle cx="22" cy="15" r="9" />
          <path d="M19 11.5 L19 19 L21.2 17 L22.8 20.4 L24.3 19.7 L22.8 16.4 L25.6 16.4 Z" />
        </svg>
      ) : (
        <span className="cursor-appearance-glyph" ref={host} />
      )}
    </span>
  );
}

/** Appearance rows and the colour swatches, above Motion in the cursor inspector. */
export function CursorAppearancePicker({
  settings,
  disabled,
  update,
}: {
  settings: ReplayCursorSettings | undefined;
  disabled: boolean;
  update: (patch: ReplayCursorSettings) => void;
}) {
  // why: plugin themes can register after the editor mounts.
  useSyncExternalStore(viewerRegistry.subscribe, viewerRegistry.getSnapshot);
  const list = useRef<HTMLDivElement>(null);
  const themes = cursorThemes({ surface: 'picker' });
  const saved = settings?.appearance ?? DEFAULT_CURSOR_APPEARANCE;
  const current = themes.find((theme) => theme.id === saved);
  const selected = current ?? themes.find((theme) => theme.id === DEFAULT_CURSOR_APPEARANCE) ?? themes[0];
  const tintable = selected?.tintable ?? false;
  const color = isCursorColor(settings?.color) ? settings.color : undefined;
  const tint = color ? CURSOR_COLORS[color] : undefined;

  const play = (id: string, restart: boolean) => {
    if (disabled || prefersReducedMotion()) return;
    const row = [...(list.current?.querySelectorAll<HTMLElement>('[data-appearance]') ?? [])].find(
      (node) => node.dataset.appearance === id,
    );
    playCursorGlyph(row?.querySelector('.cursor-appearance-glyph'), restart);
  };

  return (
    <>
      <div className="cursor-motion cursor-appearance">
        <span id="cursor-appearance-label" className="cursor-motion-label">
          Appearance
        </span>
        <RadioGroup
          ref={list}
          aria-labelledby="cursor-appearance-label"
          className="cursor-motion-list"
          value={selected?.id}
          disabled={disabled}
          onValueChange={(value) => {
            if (typeof value !== 'string') return;
            update({ appearance: value });
            play(value, true);
          }}
        >
          {themes.map((theme, index) => (
            <Radio.Root
              key={theme.id}
              value={theme.id}
              className="cursor-motion-option"
              data-appearance={theme.id}
              aria-labelledby={`cursor-appearance-${index}`}
              aria-describedby={`cursor-appearance-${index}-description`}
              onPointerEnter={(event) => {
                if (event.pointerType === 'mouse') play(theme.id, false);
              }}
            >
              <ThemePreview theme={theme} color={tint} />
              <span className="cursor-motion-text">
                <span className="cursor-motion-name" id={`cursor-appearance-${index}`}>
                  {theme.label}
                  {theme.id === DEFAULT_CURSOR_APPEARANCE ? (
                    <>
                      {' '}
                      <span className="cursor-motion-tag">Default</span>
                    </>
                  ) : null}
                </span>
                <span className="cursor-motion-description" id={`cursor-appearance-${index}-description`}>
                  {theme.description}
                </span>
              </span>
            </Radio.Root>
          ))}
        </RadioGroup>
        {current ? null : <p className="cursor-appearance-note">The saved style isn’t installed here; showing Arrow.</p>}
      </div>
      <div className="cursor-swatches">
        <span id="cursor-color-label" className="cursor-motion-label">
          Colour
        </span>
        <RadioGroup
          aria-labelledby="cursor-color-label"
          aria-describedby={tintable ? undefined : 'cursor-color-note'}
          className="cursor-swatch-list"
          value={color ?? OWN}
          disabled={disabled || !tintable}
          onValueChange={(value) => {
            if (value === OWN) update({ color: undefined });
            else if (isCursorColor(value)) update({ color: value });
          }}
        >
          <Radio.Root value={OWN} className="cursor-swatch" data-swatch={OWN} aria-label="Style’s own colours">
            <span className="cursor-swatch-chip" />
          </Radio.Root>
          {CURSOR_COLOR_NAMES.map((name) => (
            <Radio.Root key={name} value={name} className="cursor-swatch" data-swatch={name} aria-label={COLOR_LABELS[name]}>
              <span className="cursor-swatch-chip" style={{ background: CURSOR_COLORS[name] }} />
            </Radio.Root>
          ))}
        </RadioGroup>
        {tintable ? null : (
          <p id="cursor-color-note" className="cursor-appearance-note">
            This style keeps its own colours.
          </p>
        )}
      </div>
    </>
  );
}
