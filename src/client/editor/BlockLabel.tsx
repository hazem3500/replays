import { AnimatedIcon, type AnimatedIconName } from '@/components/animated-icon.tsx';
import { type LabelRoom, wordsThatFit } from './block-label.ts';
import { measureLabel } from './label-measure.ts';
import type { EffectKind } from './state.ts';

/** Each effect lane's glyph, shared by its blocks' labels and the phone's lane blocks. */
export const LANE_GLYPHS: Record<EffectKind, AnimatedIconName> = {
  zoom: 'zoom-in',
  speed: 'fast-forward',
  blur: 'eye-off',
  caption: 'captions',
};

/**
 * A lane block's label on the desktop and the phone: its leading whole words (at least two), or nothing when they do
 * not fit, and the block is then drawn short (data-short). The block's own name and tooltip carry the full label.
 */
export function blockText(label: string, width: number, room: LabelRoom = {}) {
  return wordsThatFit(label, width, { measure: measureLabel, minWords: 2, ...room });
}

/** A clip step's words, or a wait's hourglass (the Waits tool's) and its length; decorative, as the dots name the steps. */
export function ClipStepLabel({ glyph, text }: { glyph: boolean; text: string }) {
  return (
    <>
      {glyph ? <AnimatedIcon name="hourglass" size={10} strokeWidth={2.25} className="clip-wait-glyph" aria-hidden="true" /> : null}
      {text}
    </>
  );
}
