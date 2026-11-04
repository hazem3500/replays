import { AnimatedIcon, type AnimatedIconName } from '@/components/animated-icon.tsx';
import { blockLabel, type LabelRoom } from './block-label.ts';
import { measureLabel } from './label-measure.ts';

const GLYPHS: Record<string, AnimatedIconName> = { zoom: 'zoom-in', speed: 'fast-forward', blur: 'eye-off', caption: 'captions' };

/**
 * A lane block's label, on the desktop and the phone: its leading whole words, or its lane's still glyph when no word
 * fits. Decorative: the block's own name and tooltip carry the full label.
 */
export function BlockLabel({
  label,
  width,
  kind,
  className,
  ...room
}: { label: string; width: number; kind: string; className?: string } & LabelRoom) {
  const fit = blockLabel(label, width, { measure: measureLabel, ...room });
  if (fit.text)
    return (
      <span className={className} aria-hidden="true">
        {fit.text}
      </span>
    );
  const glyph = GLYPHS[kind];
  if (!fit.glyph || !glyph) return null;
  return <AnimatedIcon name={glyph} size={10} strokeWidth={2.25} className="block-glyph" aria-hidden="true" data-testid="block-glyph" />;
}
