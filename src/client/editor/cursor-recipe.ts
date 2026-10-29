import { clickEffectOf, type CursorClickEffect, type ReplayCursorSettings } from '../../shared/cursor.ts';
import { CURSOR_COLOR_LABELS, cursorTheme } from '../cursor-themes.ts';
import { CURSOR_MOTION_PREVIEWS } from './cursor-motion-previews.ts';

export type ClickChoice = 'off' | CursorClickEffect;

export const CLICK_COPY: Record<ClickChoice, { label: string; hint: string }> = {
  off: { label: 'Off', hint: 'Clicks show no effect' },
  press: { label: 'Press', hint: 'The cursor squishes on each click' },
  ripple: { label: 'Ripple', hint: 'A ring spreads from the point of each click' },
  pulse: { label: 'Pulse', hint: 'A soft halo swells at the point of each click' },
};

/** The click layer, chosen apart from the cursor's style: off, or one effect. */
export const clickChoiceOf = (settings: ReplayCursorSettings | undefined): ClickChoice =>
  settings?.clickFeedback === false ? 'off' : clickEffectOf(settings);

/** The cursor's layers as one line, e.g. "CUA arrow · Indigo · Signature arc · Ripple on click". */
export function cursorRecipe(settings: ReplayCursorSettings | undefined) {
  if (settings?.visible === false) return 'Hidden in this replay';
  const click = clickChoiceOf(settings);
  return [
    cursorTheme(settings?.appearance).label,
    settings?.color ? CURSOR_COLOR_LABELS[settings.color] : undefined,
    CURSOR_MOTION_PREVIEWS.find((preview) => preview.style === (settings?.motion ?? 'signature_arc'))?.label,
    click === 'off' ? 'no click effect' : `${CLICK_COPY[click].label} on click`,
  ]
    .filter(Boolean)
    .join(' · ');
}
