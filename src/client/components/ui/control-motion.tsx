import type { ComponentProps } from 'react';

import { useSliderMotion } from '../../hooks/use-slider-motion.ts';
import { useSwitchMotion } from '../../hooks/use-switch-motion.ts';

/** Slider motion changes its painted geometry without taking over Base UI's input handlers. */
export function SliderMotion({ kind, ref, ...props }: ComponentProps<'div'> & { kind: 'indicator' | 'thumb' }) {
  const element = useSliderMotion(ref, kind);
  return <div {...props} ref={element} />;
}

/** Ref forwarding preserves the primitive's measurement and focus contract. */
export function SwitchThumbMotion({ checked, ref, ...props }: ComponentProps<'span'> & { checked: boolean }) {
  const element = useSwitchMotion(ref, checked);
  return <span {...props} ref={element} />;
}
