import { clickEffectOf, type CursorClickEffect, type ReplayCursorSettings } from '../../shared/cursor.ts';

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
